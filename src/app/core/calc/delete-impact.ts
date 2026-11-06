// 登録した履歴を削除したときの影響（設計書 3.1「登録した情報の訂正・削除」）
// 削除の前と後で月ごとの保険料を計算し直し、変わる月・変わる保険料・確定済みの月・削除後の今月の状態を求める。
// 履歴の種類（休業・適用除外・被扶養者・区分など）ごとに考え方を書き分けず、計算の結果で比べるので、どの履歴でも同じ基準になる。
import { calcEmployeeMonth, EmployeeData, EmployeeMonthResult, Masters } from './employee-month';
import { ChildSupportRounding } from './monthly-premium';
import { premiumTotals } from './monthly-filter';
import { addMonths } from './salary';
import { yearMonthLabel } from './year-month';

/** 保険の種類（変わった保険料を名前で出す） */
const LINES = [
  ['health', '健康保険'],
  ['care', '介護保険'],
  ['childSupport', '子ども・子育て支援金'],
  ['pension', '厚生年金'],
] as const;

export type MonthChange = {
  yearMonth: string;
  /** 変わる保険（「健康保険」など） */
  lines: string[];
  /** 本人負担の差（削除後 − 削除前。円） */
  employeeDiff: number;
  /** その月の所属事業所（確定済みかを見る） */
  officeId: string | null;
};

export type DeleteImpact = {
  /** 保険料が変わる月（古い順） */
  months: MonthChange[];
  /** 変わる保険（重なりを除く） */
  lines: string[];
  /** 本人負担の差の合計（円） */
  employeeDiff: number;
  /** そのうち確定済みの月 */
  closedMonths: string[];
  /** 削除後の今月の状態（「健康保険・厚生年金がかかる（本人 42,570円）」など） */
  afterNow: string;
};

const STATUS_LABEL: Record<EmployeeMonthResult['status'], string> = {
  ok: '',
  notInsured: '資格なし（保険料はかからない）',
  noOffice: '所属事業所が未登録で、計算できない',
  noStandard: '標準報酬月額が未登録で、計算できない',
  missingRate: '料率が未登録で、計算できない',
};

/** 1か月の結果を短い文にする（削除後の今月の状態） */
function describe(r: EmployeeMonthResult): string {
  if (r.status !== 'ok') return STATUS_LABEL[r.status];
  const p = r.premium!;
  if (p.exempt) return '休業中の免除（保険料はかからない）';
  const on = LINES.filter(([k]) => p[k]).map(([, label]) => label);
  if (on.length === 0) return '保険料はかからない';
  return `${on.join('・')}がかかる（本人 ${premiumTotals(p).employee.toLocaleString('ja-JP')}円）`;
}

/** 2つの結果で、変わった保険の名前 */
function changedLines(a: EmployeeMonthResult, b: EmployeeMonthResult): string[] {
  if (a.status !== b.status && (a.status !== 'ok' || b.status !== 'ok')) {
    // 計算できる・できないが変わったときは、かかっていた保険とかかる保険を合わせて出す
    const on = (r: EmployeeMonthResult) => (r.premium ? LINES.filter(([k]) => r.premium![k]).map(([, l]) => l) : []);
    const set = new Set([...on(a), ...on(b)]);
    return set.size > 0 ? LINES.map(([, l]) => l).filter((l) => set.has(l)) : ['保険料の計算'];
  }
  const pa = a.premium;
  const pb = b.premium;
  if (!pa || !pb) return [];
  return LINES.filter(([k]) => (pa[k]?.employeeYen ?? null) !== (pb[k]?.employeeYen ?? null) || (pa[k]?.employerSen ?? null) !== (pb[k]?.employerSen ?? null)).map(
    ([, l]) => l,
  );
}

/**
 * 削除の前と後で、from〜to の月の保険料を比べる
 * @param closedByOffice 事業所ごとの確定済みの月
 */
export function deleteImpact(
  before: EmployeeData,
  after: EmployeeData,
  masters: Masters,
  from: string,
  to: string,
  thisMonth: string,
  rounding: ChildSupportRounding,
  closedByOffice: Record<string, string[]>,
): DeleteImpact {
  const months: MonthChange[] = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) {
    const a = calcEmployeeMonth(before, masters, ym, rounding);
    const b = calcEmployeeMonth(after, masters, ym, rounding);
    const lines = changedLines(a, b);
    if (lines.length === 0) continue;
    months.push({
      yearMonth: ym,
      lines,
      employeeDiff: premiumTotals(b.premium).employee - premiumTotals(a.premium).employee,
      officeId: a.officeId ?? b.officeId,
    });
  }
  const lineSet = new Set(months.flatMap((m) => m.lines));
  return {
    months,
    lines: [...LINES.map(([, l]) => l as string), '保険料の計算'].filter((l) => lineSet.has(l)),
    employeeDiff: months.reduce((t, m) => t + m.employeeDiff, 0),
    closedMonths: months.filter((m) => m.officeId && (closedByOffice[m.officeId] ?? []).includes(m.yearMonth)).map((m) => m.yearMonth),
    afterNow: describe(calcEmployeeMonth(after, masters, thisMonth, rounding)),
  };
}

/** 月の並びを「2026年6月分〜8月分・10月分」のようにまとめる */
export function monthRanges(months: string[]): string {
  const sorted = [...months].sort();
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = () => {
    if (!start) return;
    parts.push(start === prev ? `${yearMonthLabel(start)}分` : `${yearMonthLabel(start)}分〜${yearMonthLabel(prev)}分`);
  };
  for (const ym of sorted.slice(1)) {
    if (ym === addMonths(prev, 1)) {
      prev = ym;
      continue;
    }
    flush();
    start = ym;
    prev = ym;
  }
  flush();
  return parts.join('・');
}

/**
 * 削除の確認に出す文（保険料が変わる月・変わる保険料・確定済みの月・届出・削除後の今月の状態）
 * @param noPremiumNote 保険料が変わらないときに、何に効くかの説明（区分・支払区分・休職など）
 * @param filingNote 届出についての文（届出済みなら訂正・取消が要る、など）
 */
export function deleteImpactMessage(i: DeleteImpact, thisMonth: string, noPremiumNote: string, filingNote: string): string {
  const head =
    i.months.length === 0
      ? `保険料は変わりません。${noPremiumNote}`
      : `影響する月：${monthRanges(i.months.map((m) => m.yearMonth))}（${i.months.length}か月）。変わる保険料：${i.lines.join('・')}` +
        `（本人負担の合計 ${i.employeeDiff >= 0 ? '+' : ''}${i.employeeDiff.toLocaleString('ja-JP')}円）。`;
  const closed =
    i.closedMonths.length > 0
      ? `そのうち確定済みの月は${i.closedMonths.length}か月（${monthRanges(i.closedMonths)}）で、確定した金額は変わらず、差額の画面に差額が出ます。`
      : i.months.length > 0
        ? '確定済みの月はありません。'
        : '';
  return [head, closed, filingNote, `削除後の${yearMonthLabel(thisMonth)}分：${i.afterNow}。`].filter((x) => x).join('');
}
