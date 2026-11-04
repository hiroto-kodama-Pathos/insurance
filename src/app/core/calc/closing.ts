// 月次確定（設計書 3.2・4章 closings）
// 適用事業所ごとに、その月の計算結果と根拠（標準報酬月額・料率・介護の区分・免除）を保存する。
// 確定した月は保存した結果を表示し、後からマスタや従業員データを直しても金額は変わらない。
// Firestore には bigint を保存できないので、銭・円の値は number で持つ（最大でも数千万銭で、安全に表せる範囲）。
import { BonusResult } from './bonus-premium';
import { EmployeeMonthResult } from './employee-month';
import { MonthlyPremium } from './monthly-premium';
import { summarizeMonth, PaymentLine } from './monthly-summary';
import { PremiumResult } from './premium-calculator';
import { dateLabel } from './year-month';

/** 保存する1つの保険の結果 */
export type StoredPremium = { fullSen: number; employeeYen: number; employerSen: number };

type PremiumKey = 'health' | 'care' | 'childSupport' | 'pension';
const KEYS: PremiumKey[] = ['health', 'care', 'childSupport', 'pension'];

/** 確定した1人分 */
export type ClosedRow = {
  employeeId: string;
  employeeNumber: string;
  name: string;
  insurerId: string;
  standard: { health: number; pension: number };
  rates: EmployeeMonthResult['rates'];
  careLabel: MonthlyPremium['careLabel'];
  exempt: boolean;
  premiums: Record<PremiumKey, StoredPremium | null>;
};

/** 確定した賞与1件分 */
export type ClosedBonusRow = {
  bonusId: string;
  employeeId: string;
  employeeNumber: string;
  name: string;
  paidDate: string;
  amount: number;
  insurerId: string;
  target: BonusResult['target'];
  standardBonus: number;
  base: BonusResult['base'];
  capped: BonusResult['capped'];
  exemption: BonusResult['exemption'];
  rates: BonusResult['rates'];
  careLabel: MonthlyPremium['careLabel'] | null;
  exempt: boolean;
  premiums: Record<PremiumKey, StoredPremium | null> | null;
};

/** 賞与の一覧の1行 */
export type BonusRowInput = {
  employee: { id: string; employeeNumber: string; name: string };
  result: BonusResult;
};

/** 適用事業所1つ・1か月分の確定 */
export type OfficeClosing = {
  yearMonth: string;
  officeId: string;
  closedBy: string;
  /** 保存した日時（読み込み時に ISO 形式の文字列にする。保存前は null） */
  closedAt: string | null;
  rows: ClosedRow[];
  /** 納付書の欄ごとの合計（円）。月額の分 */
  totals: Record<PaymentLine, { paymentYen: number; employeeTotal: number; employerTotal: number }>;
  /** その月に支給した賞与（保険料がかからない免除・喪失月の賞与も、届出と累計のため残す） */
  bonusRows: ClosedBonusRow[];
  /** 納付書の欄ごとの合計（円）。賞与の分 */
  bonusTotals: Record<PaymentLine, { paymentYen: number; employeeTotal: number; employerTotal: number }>;
};

/** 一覧の1行（従業員の表示用の項目と計算結果） */
export type RowInput = {
  employee: { id: string; employeeNumber: string; name: string };
  result: EmployeeMonthResult;
};

const toStored = (p: PremiumResult | null): StoredPremium | null =>
  p ? { fullSen: Number(p.fullSen), employeeYen: Number(p.employeeYen), employerSen: Number(p.employerSen) } : null;

const fromStored = (p: StoredPremium | null): PremiumResult | null =>
  p ? { fullSen: BigInt(p.fullSen), employeeYen: BigInt(p.employeeYen), employerSen: BigInt(p.employerSen) } : null;

/**
 * 確定できない理由。料率の未登録・標準報酬月額の未登録の人がいる事業所は確定させない
 * @returns 理由の一覧（空なら確定できる）
 */
export function closeBlockers(
  yearMonth: string,
  officeId: string,
  rows: RowInput[],
  bonuses: BonusRowInput[] = [],
): string[] {
  const label: Partial<Record<EmployeeMonthResult['status'], string>> = {
    noStandard: '標準報酬月額が未登録',
    missingRate: '料率が未登録',
  };
  const mine = rows.filter((r) => r.result.yearMonth === yearMonth && r.result.officeId === officeId);
  const problems = mine
    .filter((r) => label[r.result.status])
    .map((r) => `${r.employee.employeeNumber} ${r.employee.name}：${label[r.result.status]}`);
  const myBonuses = bonuses.filter((b) => b.result.yearMonth === yearMonth && b.result.officeId === officeId);
  for (const b of myBonuses) {
    if (b.result.status === 'missingRate')
      problems.push(`${b.employee.employeeNumber} ${b.employee.name}：賞与（${dateLabel(b.result.bonus.paidDate)}）の料率が未登録`);
  }
  if (mine.filter((r) => r.result.status === 'ok').length === 0 && myBonuses.length === 0 && problems.length === 0) {
    problems.push('この月に保険料がかかる従業員がいません');
  }
  return problems;
}

/** 事業所1つ分の確定の内容を作る（保存はしない） */
export function buildOfficeClosing(
  yearMonth: string,
  officeId: string,
  rows: RowInput[],
  closedBy: string,
  bonuses: BonusRowInput[] = [],
): OfficeClosing {
  const mine = rows.filter(
    (r) => r.result.yearMonth === yearMonth && r.result.officeId === officeId && r.result.status === 'ok',
  );
  const closedRows: ClosedRow[] = mine.map(({ employee, result }) => ({
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    insurerId: result.insurerId!,
    standard: result.standard!,
    rates: result.rates,
    careLabel: result.premium!.careLabel,
    exempt: result.premium!.exempt,
    premiums: Object.fromEntries(KEYS.map((k) => [k, toStored(result.premium![k])])) as ClosedRow['premiums'],
  }));
  const summary = summarizeMonth(
    yearMonth,
    mine.map((r) => r.result),
  );
  const myBonuses = bonuses.filter(
    (b) =>
      b.result.yearMonth === yearMonth &&
      b.result.officeId === officeId &&
      b.result.status === 'ok' &&
      b.result.target !== 'outside',
  );
  const bonusRows: ClosedBonusRow[] = myBonuses.map(({ employee, result }) => ({
    bonusId: result.bonus.id,
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    paidDate: result.bonus.paidDate,
    amount: result.bonus.amount,
    insurerId: result.insurerId!,
    target: result.target,
    standardBonus: result.standardBonus,
    base: result.base,
    capped: result.capped,
    exemption: result.exemption,
    rates: result.rates,
    careLabel: result.premium?.careLabel ?? null,
    exempt: result.premium?.exempt ?? false,
    premiums: result.premium
      ? (Object.fromEntries(KEYS.map((k) => [k, toStored(result.premium![k])])) as ClosedBonusRow['premiums'])
      : null,
  }));
  const bonusSummary = summarizeMonth(
    yearMonth,
    myBonuses.map((b) => bonusAsMonthResult(b.result)),
  );
  return {
    yearMonth,
    officeId,
    closedBy,
    closedAt: null,
    rows: closedRows,
    totals: totalsOf(summary),
    bonusRows,
    bonusTotals: totalsOf(bonusSummary),
  };
}

/** 賞与の結果を、小計の集計（summarizeMonth）に渡せる形にする */
export function bonusAsMonthResult(r: BonusResult): EmployeeMonthResult {
  return {
    employeeId: r.bonus.employeeId,
    yearMonth: r.yearMonth,
    status: r.status === 'ok' ? 'ok' : 'missingRate',
    officeId: r.officeId,
    insurerId: r.insurerId,
    standard: null,
    premium: r.premium,
    rates: r.rates,
  };
}

function totalsOf(summary: ReturnType<typeof summarizeMonth>): OfficeClosing['totals'] {
  const totals = {} as OfficeClosing['totals'];
  for (const line of ['healthCare', 'childSupport', 'pension'] as PaymentLine[]) {
    const t = summary.offices.reduce(
      (s, o) => ({
        paymentYen: s.paymentYen + o.lines[line].paymentYen,
        employeeTotal: s.employeeTotal + o.lines[line].employeeTotal,
        employerTotal: s.employerTotal + o.lines[line].employerTotal,
      }),
      { paymentYen: 0n, employeeTotal: 0n, employerTotal: 0n },
    );
    totals[line] = {
      paymentYen: Number(t.paymentYen),
      employeeTotal: Number(t.employeeTotal),
      employerTotal: Number(t.employerTotal),
    };
  }
  return totals;
}

/** 保存した賞与1件を、賞与一覧の形に戻す */
export function restoreBonus(closing: OfficeClosing, row: ClosedBonusRow): BonusRowInput {
  const premium: MonthlyPremium | null = row.premiums
    ? {
        health: fromStored(row.premiums.health),
        care: fromStored(row.premiums.care),
        childSupport: fromStored(row.premiums.childSupport),
        pension: fromStored(row.premiums.pension),
        careLabel: row.careLabel ?? 'none',
        exempt: row.exempt,
        missingRates: [],
      }
    : null;
  return {
    employee: { id: row.employeeId, employeeNumber: row.employeeNumber, name: row.name },
    result: {
      bonus: { id: row.bonusId, employeeId: row.employeeId, paidDate: row.paidDate, amount: row.amount },
      yearMonth: closing.yearMonth,
      status: 'ok',
      target: row.target,
      officeId: closing.officeId,
      insurerId: row.insurerId,
      standardBonus: row.standardBonus,
      base: row.base,
      capped: row.capped,
      exemption: row.exemption,
      premium,
      rates: row.rates,
    },
  };
}

/** 確定済みの事業所の賞与は保存した結果、それ以外はその場で計算した結果を使う */
export function mergeBonusesWithClosings(
  live: BonusRowInput[],
  closings: OfficeClosing[],
): (BonusRowInput & { closed: boolean })[] {
  const closedOffices = new Set(closings.map((c) => c.officeId));
  const closedIds = new Set(closings.flatMap((c) => (c.bonusRows ?? []).map((b) => b.bonusId)));
  const fromLive = live
    .filter((r) => !(r.result.officeId && closedOffices.has(r.result.officeId)))
    .filter((r) => !closedIds.has(r.result.bonus.id))
    .map((r) => ({ ...r, closed: false }));
  const fromClosed = closings.flatMap((c) => (c.bonusRows ?? []).map((b) => ({ ...restoreBonus(c, b), closed: true })));
  return [...fromLive, ...fromClosed];
}

/** 保存した1人分を、一覧の計算結果の形に戻す */
export function restoreRow(closing: OfficeClosing, row: ClosedRow): RowInput {
  const premium: MonthlyPremium = {
    health: fromStored(row.premiums.health),
    care: fromStored(row.premiums.care),
    childSupport: fromStored(row.premiums.childSupport),
    pension: fromStored(row.premiums.pension),
    careLabel: row.careLabel,
    exempt: row.exempt,
    missingRates: [],
  };
  return {
    employee: { id: row.employeeId, employeeNumber: row.employeeNumber, name: row.name },
    result: {
      employeeId: row.employeeId,
      yearMonth: closing.yearMonth,
      status: 'ok',
      officeId: closing.officeId,
      insurerId: row.insurerId,
      standard: row.standard,
      premium,
      rates: row.rates,
    },
  };
}

/**
 * 確定済みの事業所は保存した結果、それ以外はその場で計算した結果を使って、一覧の行を作る
 * 確定後に異動した人などが二重に出ないよう、確定済みの事業所に含まれる人は計算した行から除く。
 */
export function mergeWithClosings(live: RowInput[], closings: OfficeClosing[]): (RowInput & { closed: boolean })[] {
  const closedOffices = new Set(closings.map((c) => c.officeId));
  const closedEmployees = new Set(closings.flatMap((c) => c.rows.map((r) => r.employeeId)));
  const fromLive = live
    .filter((r) => !(r.result.officeId && closedOffices.has(r.result.officeId)))
    .filter((r) => !closedEmployees.has(r.employee.id))
    .map((r) => ({ ...r, closed: false }));
  const fromClosed = closings.flatMap((c) => c.rows.map((row) => ({ ...restoreRow(c, row), closed: true })));
  return [...fromLive, ...fromClosed];
}

/** 担当範囲（'all' または事業所ID）で、その事業所を確定・解除できるか */
export function canCloseOffice(scope: string | null, officeId: string): boolean {
  return scope === 'all' || scope === officeId;
}
