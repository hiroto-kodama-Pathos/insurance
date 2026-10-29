// 給与から控除できない月の検知（設計書 2.10・2.21）
// 保険料は標準報酬月額で計算するため、休職中で無給の月なども保険料がかかる。
// 入力した給与と、その給与から控除する本人負担を比べ、本人から別に集める必要に、給与を払う前に気づけるようにする。
import { Qualification } from './eligibility';
import { CompanySettings } from './settings';
import { addMonths, SalaryRecord } from './salary';

export type DeductionTiming = CompanySettings['deductionTiming'];

/** 保険料が給与のこの割合を超えたら「注意」（所得税・住民税などと合わせて足りなくなるおそれ） */
export const CAUTION_RATIO = 0.6;

/** 月末に退職する人の資格喪失日（翌月1日）か */
function lostAtMonthEnd(qualifications: Qualification[], ym: string): boolean {
  const next1 = `${addMonths(ym, 1)}-01`;
  return qualifications.some((q) => q.lostDate === next1);
}

/**
 * 保険料の月の分を、どの月に支払う給与から控除するか
 * - 当月控除：その月の給与
 * - 翌月控除：翌月の給与。ただし月末に退職する人の退職月の分は、退職月の最終給与から控除する
 */
export function payMonthFor(premiumYm: string, timing: DeductionTiming, qualifications: Qualification[]): string {
  if (timing === 'sameMonth') return premiumYm;
  return lostAtMonthEnd(qualifications, premiumYm) ? premiumYm : addMonths(premiumYm, 1);
}

/**
 * その月に支払う給与から控除する保険料の月
 * 翌月控除で月末に退職する人の最終給与は、前月分と退職月分の2か月分になる
 */
export function premiumMonthsFor(payYm: string, timing: DeductionTiming, qualifications: Qualification[]): string[] {
  if (timing === 'sameMonth') return [payYm];
  return lostAtMonthEnd(qualifications, payYm) ? [addMonths(payYm, -1), payYm] : [addMonths(payYm, -1)];
}

/** その月に支払った給与のうち、お金で払った額（現物給与を除く）。給与がなければ null */
export function cashPaid(salaries: SalaryRecord[], employeeId: string, payYm: string): number | null {
  const list = salaries.filter((s) => s.employeeId === employeeId && s.paidDate.startsWith(payYm));
  if (list.length === 0) return null;
  return list.reduce((t, s) => t + s.fixedWages + s.nonFixedWages - (s.inKindWages ?? 0), 0);
}

export type DeductionStatus = 'ok' | 'caution' | 'shortage' | 'notEntered' | 'none';

export type DeductionCheck = {
  payMonth: string;
  premiumMonths: string[];
  /** 控除する本人負担の合計（円）。精算する差額を含む */
  premium: number;
  /** お金で払う給与（円）。給与未入力は null */
  cash: number | null;
  status: DeductionStatus;
  /** 控除不足の額（保険料 − 給与） */
  shortage: number;
};

/**
 * その月に支払う給与で、本人負担を控除しきれるかを判定する
 *
 * @param premiumOf 保険料の月の本人負担の合計（円。かからない月は 0）
 * @param settled この給与で精算する、さかのぼる改定の差額（円。追加で控除するなら正）
 */
export function checkDeduction(
  employeeId: string,
  qualifications: Qualification[],
  payYm: string,
  timing: DeductionTiming,
  salaries: SalaryRecord[],
  premiumOf: (ym: string) => number,
  settled = 0,
): DeductionCheck {
  const premiumMonths = premiumMonthsFor(payYm, timing, qualifications);
  const premium = premiumMonths.reduce((t, ym) => t + premiumOf(ym), 0) + settled;
  const cash = cashPaid(salaries, employeeId, payYm);
  const base = { payMonth: payYm, premiumMonths, premium, cash, shortage: 0 };
  if (premium === 0) return { ...base, status: 'none' };
  if (cash === null) return { ...base, status: 'notEntered' };
  if (cash < premium) return { ...base, status: 'shortage', shortage: premium - cash };
  if (premium > cash * CAUTION_RATIO) return { ...base, status: 'caution' };
  return { ...base, status: 'ok' };
}
