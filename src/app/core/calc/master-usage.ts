// 適用事業所・給与の支払区分の削除の前に、使われているかを数える（設計書 3.10）
// 1件でも使われていれば「使用中」として削除させない。今の所属だけでなく、過去の所属（履歴）も数える
// （過去の保険料・確定・照合の記録が、その事業所・区分を指しているため）
import { Assignment } from './office';
import { PayrollAssignment } from './payroll-group';
import { yearMonthLabel } from './year-month';

type UsageEmployee = { assignments: Assignment[]; payrollAssignments?: PayrollAssignment[] };

/** その適用事業所に所属した（している）従業員の数 */
export function officeUsage(employees: UsageEmployee[], officeId: string): number {
  return employees.filter((e) => e.assignments.some((a) => a.officeId === officeId)).length;
}

/** その支払区分に属した（している）従業員の数 */
export function payrollGroupUsage(employees: UsageEmployee[], groupId: string): number {
  return employees.filter((e) => (e.payrollAssignments ?? []).some((a) => a.payrollGroupId === groupId)).length;
}

/**
 * その健康保険組合を使っているもの：保険者として登録した適用事業所の数と、
 * 二以上事業所勤務で本人が選んだ保険者としている従業員の数（過去の標準報酬月額の履歴を含む）
 */
export function insurerUsage(
  offices: { insurerId: string }[],
  employees: { standardHistory: { selectedInsurerId?: string | null }[] }[],
  insurerId: string,
): { offices: number; employees: number } {
  return {
    offices: offices.filter((o) => o.insurerId === insurerId).length,
    employees: employees.filter((e) => e.standardHistory.some((s) => s.selectedInsurerId === insurerId)).length,
  };
}

/** 削除できないときの知らせ（使用中）。削除できるなら null */
export function inUseMessage(
  label: string,
  name: string,
  reason: { isDefault: boolean; employees?: number; bonuses?: boolean; offices?: number; closedMonths?: number },
): string | null {
  if (reason.offices && reason.offices > 0) return `${label}「${name}」は使用中なので、削除できません（適用事業所${reason.offices}件の保険者になっています）。`;
  if (reason.isDefault) return `${label}「${name}」は新規登録の初期値として使用中なので、削除できません（先に別の${label}を初期値にしてください）。`;
  if (reason.employees && reason.employees > 0)
    return label === '健康保険組合'
      ? `${label}「${name}」は使用中なので、削除できません（従業員${reason.employees}人が、二以上事業所勤務の保険者として選んでいます。過去の履歴を含みます）。`
      : `${label}「${name}」は使用中なので、削除できません（従業員${reason.employees}人が所属しています。過去の所属を含みます）。`;
  if (reason.bonuses) return `${label}「${name}」は使用中なので、削除できません（この種類の賞与が登録されています）。`;
  if (reason.closedMonths && reason.closedMonths > 0)
    return `${label}「${name}」は使用中なので、削除できません（確定済みの月（${reason.closedMonths}か月）の結果に使われています）。`;
  return null;
}

/** 適用事業所が使われているか（従業員が一度でも所属した・確定済みの月がある） */
export type OfficeUse = { employees: number; closedMonths: number };

export function officeInUse(u: OfficeUse): boolean {
  return u.employees > 0 || u.closedMonths > 0;
}

/** 使われている理由（「従業員3人が所属・確定済みの月2か月」） */
export function officeUseLabel(u: OfficeUse): string {
  return [
    u.employees > 0 ? `従業員${u.employees}人が所属（過去の所属を含む）` : '',
    u.closedMonths > 0 ? `確定済みの月${u.closedMonths}か月` : '',
  ].filter((x) => x).join('・');
}

/**
 * 適用事業所の変更：使われている事業所は、保険者・都道府県を変えない（設計書 3.10）。
 * 過去の所属・確定済みの月がこの事業所を指しているので、変えると過去の月の保険者・料率まで変わってしまう。
 * 事業所名・新規登録の初期値は変えてよい。使われていなければ、入力の誤りとして直せる
 * @returns 変えられないときの文（変えられるなら null）
 */
export function officeChangeError(
  before: { insurerId: string; prefecture: string },
  after: { insurerId: string; prefecture: string },
  use: OfficeUse,
): string | null {
  if (before.insurerId === after.insurerId && before.prefecture === after.prefecture) return null;
  if (!officeInUse(use)) return null;
  return `この事業所は使用中（${officeUseLabel(use)}）なので、保険者・都道府県は変えられません。保険者や所在地が変わったときは、新しい適用事業所を追加し、従業員の詳細で異動を登録してください（過去の月は、この事業所の保険者・料率のまま計算します）。`;
}

// ---- 組合健保の料率の削除の影響（設計書 3.4） ----

type RateRow = { id: string; insurerId: string; rateType: string; validFrom: string; rate: number };

/** 'YYYY-MM' の前の月 */
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 料率の行を削除したときに影響する範囲 */
export type RateDeleteImpact = {
  /** その行で計算している期間（from〜to。to が null なら今後ずっと） */
  from: string;
  to: string | null;
  /** 削除したあと、その期間に使う料率（前の適用開始月の行）。なければ null（料率が未登録になる） */
  fallback: RateRow | null;
  /** この組合を保険者にしている適用事業所の名前 */
  officeNames: string[];
  /** 二以上事業所勤務で、この組合を選んでいる従業員の数（過去の履歴を含む） */
  selectingEmployees: number;
  /** その期間の確定済みの月の数（事業所ごとに数えた月の重なりは1つ） */
  closedMonths: number;
};

/**
 * 組合健保の料率の行を削除したときの影響を求める（どの月の計算に、どの事業所で効くか）
 * @param closedByOffice 事業所ごとの確定済みの月
 */
export function rateDeleteImpact(
  target: RateRow,
  rates: RateRow[],
  offices: { id: string; name: string; insurerId: string }[],
  selectingEmployees: number,
  closedByOffice: Record<string, string[]>,
): RateDeleteImpact {
  const same = rates
    .filter((r) => r.insurerId === target.insurerId && r.rateType === target.rateType && r.id !== target.id)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const next = same.find((r) => r.validFrom > target.validFrom) ?? null;
  const fallback = same.filter((r) => r.validFrom < target.validFrom).at(-1) ?? null;
  const to = next ? prevMonth(next.validFrom) : null;
  const users = offices.filter((o) => o.insurerId === target.insurerId);
  const closed = new Set(
    users.flatMap((o) => (closedByOffice[o.id] ?? []).filter((ym) => ym >= target.validFrom && (to === null || ym <= to))),
  );
  return { from: target.validFrom, to, fallback, officeNames: users.map((o) => o.name), selectingEmployees, closedMonths: closed.size };
}

/** 料率の削除の確認に出す文（影響する期間・事業所・削除したあとの計算・確定済みの月） */
export function rateDeleteMessage(i: RateDeleteImpact, percent: (rate: number) => string): string {
  const period = i.to ? `${yearMonthLabel(i.from)}分から${yearMonthLabel(i.to)}分まで` : `${yearMonthLabel(i.from)}分から今後ずっと`;
  const who =
    i.officeNames.length > 0 || i.selectingEmployees > 0
      ? [
          i.officeNames.length > 0 ? `適用事業所「${i.officeNames.join('」「')}」` : '',
          i.selectingEmployees > 0 ? `二以上事業所勤務でこの組合を選んでいる従業員${i.selectingEmployees}人` : '',
        ].filter((x) => x).join('と')
      : '';
  const after = i.fallback
    ? `前の料率（${percent(i.fallback.rate)}%・${yearMonthLabel(i.fallback.validFrom)}から）で計算し直します`
    : '「料率が未登録」になり、保険料を計算できなくなります';
  return [
    `影響する期間：${period}。`,
    who ? `影響する人：${who}の保険料。` : 'この組合を保険者にしている適用事業所はないので、保険料の計算は変わりません。',
    who ? `削除すると、この期間は${after}。` : '',
    i.closedMonths > 0 ? `この期間の確定済みの月（${i.closedMonths}か月）は確定した金額のままで、差額の画面に差額が出ます。` : '',
    '料率が変わったときは削除せず、新しい適用開始月で追加してください（削除は、誤って追加した行を消すためのものです）。',
  ].filter((x) => x).join('');
}
