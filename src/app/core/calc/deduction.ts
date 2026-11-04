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
export function payMonthFor(
  premiumYm: string,
  timing: DeductionTiming,
  qualifications: Qualification[],
  finalPaidInRetireMonth = true,
): string {
  if (timing === 'sameMonth') return premiumYm;
  return finalPaidInRetireMonth && lostAtMonthEnd(qualifications, premiumYm) ? premiumYm : addMonths(premiumYm, 1);
}

/**
 * その月に支払う給与から控除する保険料の月
 * 翌月控除で、最終給与が退職した月に払われる区分（当月払）の人が月末に退職すると、最終給与は前月分と退職月分の2か月分になる
 * （翌月払の区分では、退職月分は翌月に払う最終給与から控除するので1か月分のまま）
 */
export function premiumMonthsFor(
  payYm: string,
  timing: DeductionTiming,
  qualifications: Qualification[],
  finalPaidInRetireMonth = true,
): string[] {
  if (timing === 'sameMonth') return [payYm];
  return finalPaidInRetireMonth && lostAtMonthEnd(qualifications, payYm) ? [addMonths(payYm, -1), payYm] : [addMonths(payYm, -1)];
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
  finalPaidInRetireMonth = true,
): DeductionCheck {
  const premiumMonths = premiumMonthsFor(payYm, timing, qualifications, finalPaidInRetireMonth);
  const premium = premiumMonths.reduce((t, ym) => t + premiumOf(ym), 0) + settled;
  const cash = cashPaid(salaries, employeeId, payYm);
  const base = { payMonth: payYm, premiumMonths, premium, cash, shortage: 0 };
  if (premium === 0) return { ...base, status: 'none' };
  if (cash === null) return { ...base, status: 'notEntered' };
  if (cash < premium) return { ...base, status: 'shortage', shortage: premium - cash };
  if (premium > cash * CAUTION_RATIO) return { ...base, status: 'caution' };
  return { ...base, status: 'ok' };
}

/** 退職を入力したときの見込み（設計書 2.9・2.10） */
export type RetirementPreview = {
  lostDate: string;
  /** 退職月の保険料がかかるか（月末退職ならかかる。月の途中の退職はかからない） */
  retireMonthCharged: boolean;
  /** 保険料がかかる最後の月 */
  lastPremiumMonth: string;
  /** 最後の月の分を控除する給与の月 */
  finalPayMonth: string;
  /** その給与で控除する保険料の月（月末退職で最終給与が退職月に払われる区分は2か月分） */
  finalPremiumMonths: string[];
};

/**
 * 退職日から、資格喪失日・退職月の保険料・最終給与で控除する月数を求める
 * @param qualifications 今の資格の期間（加入中の期間に、喪失日を入れて判定する）
 */
export function retirementPreview(
  qualifications: Qualification[],
  retirementDate: string,
  timing: DeductionTiming,
  finalPaidInRetireMonth: boolean,
): RetirementPreview {
  const [y, m, d] = retirementDate.split('-').map(Number);
  const lost = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const retireYm = retirementDate.slice(0, 7);
  const retireMonthCharged = lost.slice(0, 7) !== retireYm;
  const lastPremiumMonth = retireMonthCharged ? retireYm : addMonths(retireYm, -1);
  const after = qualifications.map((q) => (q.lostDate === null ? { ...q, lostDate: lost } : q));
  const finalPayMonth = payMonthFor(lastPremiumMonth, timing, after, finalPaidInRetireMonth);
  return {
    lostDate: lost,
    retireMonthCharged,
    lastPremiumMonth,
    finalPayMonth,
    finalPremiumMonths: premiumMonthsFor(finalPayMonth, timing, after, finalPaidInRetireMonth),
  };
}
