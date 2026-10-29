// 賞与の保険料（設計書 2.4・2.16）
// 保険料の計算と端数処理は月額と同じ calcMonthlyPremium を使い、標準報酬月額の代わりに標準賞与額を渡す。
// 上限は、健康保険・介護保険・支援金が「同じ保険者での年度（4月〜翌3月）の累計573万円」、
// 厚生年金が「同じ月に払った賞与の合計150万円」。
import { isSpecialInsuredMonth } from './dependent';
import { daysInMonth, formatDate, monthEnd, monthOf, parseDate } from './date';
import { exemptedInsurances, Leave, nextDay, Qualification } from './eligibility';
import { EmployeeData, findEffective, Masters } from './employee-month';
import { calcMonthlyPremium, ChildSupportRounding, MonthlyPremium, MonthlyPremiumInput, RateShare } from './monthly-premium';
import { findOffice } from './office';
import type { Insurer, InsurerRate } from './rate';

export const HEALTH_BONUS_CAP = 5_730_000;
export const PENSION_BONUS_CAP = 1_500_000;

/** 登録した賞与 */
export type BonusRecord = {
  id: string;
  employeeId: string;
  paidDate: string;
  /** 賞与額（現物を含む合計、円） */
  amount: number;
  /**
   * 二以上事業所勤務：同じ月に全事業所で支払った賞与額の合計（円）。
   * 支給日には他社の額が分からないので、決定通知や他社との情報共有で分かってから登録する
   */
  totalAmount?: number | null;
};

/**
 * 支給日に資格があるか
 * - outside：資格取得日より前、または資格喪失日以降の支給（保険料なし・累計にも含めない）
 * - lostMonth：資格喪失月に喪失日の前日までに支給（保険料なし・累計には含める）。同月得喪の月は除く
 * - charged：保険料がかかる
 */
export type BonusTarget = 'outside' | 'lostMonth' | 'charged';

export type BonusResult = {
  bonus: BonusRecord;
  yearMonth: string;
  status: 'ok' | 'outside' | 'noOffice' | 'missingRate';
  target: BonusTarget;
  officeId: string | null;
  insurerId: string | null;
  /** 1,000円未満を切り捨てた標準賞与額 */
  standardBonus: number;
  /** 上限を当てたあとの、保険料の計算に使う額 */
  base: { health: number; pension: number };
  /** 上限で減った分があるか */
  capped: { health: boolean; pension: boolean };
  /** 産休・育休の免除 */
  exemption: 'none' | 'maternity' | 'childcare';
  premium: MonthlyPremium | null;
  rates: MonthlyPremiumInput['rates'] | null;
  /**
   * 二以上事業所勤務で、他社の賞与と合わせると上限にかかるおそれがある（設計書 2.12）
   * 支給日には他社の金額が分からないので、自社の賞与額で計算し「要確認」とする
   */
  multiOfficeReview?: boolean;
  /** 支給月に二以上事業所勤務か（自社の報酬 ＜ 合計の報酬の標準報酬月額の履歴がある） */
  multiOffice?: boolean;
  /**
   * 二以上事業所勤務で、全事業所の賞与額の合計を登録したあとの決定（合算した標準賞与額の保険料を、賞与額の割合で按分）
   * premium（自社の賞与額で計算して控除した額）との差が、精算する過不足になる
   */
  decided?: { totalAmount: number; standardTotal: number; base: { health: number; pension: number }; premium: MonthlyPremium };
  /** 決定後の本人負担の過不足（円。正は追加で控除、負は返金） */
  decidedDiff?: number;
};

/** 年度（4月〜翌3月）。'2026-05-10' → '2026'、'2027-02-01' → '2026' */
export function fiscalYearOf(date: string): string {
  const { y, m } = parseDate(date);
  return String(m >= 4 ? y : y - 1);
}

/** 標準賞与額（1,000円未満を切り捨て） */
export function standardBonusOf(amount: number): number {
  return Math.floor(amount / 1000) * 1000;
}

/** n日後 */
export function addDays(date: string, n: number): string {
  let d = date;
  for (let i = 0; i < n; i++) d = nextDay(d);
  return d;
}

/** 1か月後の同じ日（その日がない月は末日） */
function oneMonthLater(date: string): string {
  const { y, m, d } = parseDate(date);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return formatDate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

/** 支給日に資格があるか */
export function bonusTarget(qualifications: Qualification[], paidDate: string): BonusTarget {
  const q = qualifications.find((x) => x.acquiredDate <= paidDate && (x.lostDate === null || paidDate < x.lostDate));
  if (!q) return 'outside';
  if (q.lostDate && monthOf(paidDate) === monthOf(q.lostDate) && monthOf(q.acquiredDate) !== monthOf(q.lostDate)) {
    return 'lostMonth';
  }
  return 'charged';
}

/**
 * 産休・育休で賞与の保険料が免除されるか
 * - 産前産後休業：支払月が、月額の免除月（開始月〜終了日の翌日の月の前月）に当たる
 * - 育児休業：支払月の末日を含んで、連続して1か月を超える休業をしている
 */
export function bonusExemption(leaves: Leave[], paidDate: string): BonusResult['exemption'] {
  const ym = monthOf(paidDate);
  const end = monthEnd(ym);
  for (const l of leaves) {
    if (l.type === 'maternity') {
      const until = l.endDate ? monthOf(nextDay(l.endDate)) : null;
      if (monthOf(l.startDate) <= ym && (until === null || ym < until)) return 'maternity';
    } else {
      const coversMonthEnd = l.startDate <= end && (l.endDate === null || l.endDate >= end);
      const overOneMonth = l.endDate === null || l.endDate >= oneMonthLater(l.startDate);
      if (coversMonthEnd && overOneMonth) return 'childcare';
    }
  }
  return 'none';
}

function findRate(
  rates: InsurerRate[],
  insurer: Insurer,
  rateType: InsurerRate['rateType'],
  prefecture: string,
  yearMonth: string,
): RateShare | null {
  const byPrefecture = insurer.type === 'kyokai' && rateType === 'health';
  const found = findEffective(
    rates.filter(
      (r) => r.insurerId === insurer.id && r.rateType === rateType && r.prefecture === (byPrefecture ? prefecture : null),
    ),
    yearMonth,
  );
  return found ? { rate: found.rate, share: found.employeeShare } : null;
}

/**
 * 1人分の、ある年度の賞与をまとめて計算する
 * 上限は前の賞与から順に積み上げるので、同じ年度の賞与をすべて渡す（支給日の順に並べ替える）
 */
export function calcEmployeeBonuses(
  employee: EmployeeData,
  bonuses: BonusRecord[],
  masters: Masters,
  childSupportRounding: ChildSupportRounding = 'combined',
): BonusResult[] {
  const sorted = [...bonuses]
    .filter((b) => b.employeeId === employee.id)
    .sort((a, b) => a.paidDate.localeCompare(b.paidDate) || a.id.localeCompare(b.id));
  // 健康保険の累計は「保険者 × 年度」、厚生年金は「月」ごとに積み上げる
  const healthTotal = new Map<string, number>();
  const pensionTotal = new Map<string, number>();
  // 二以上事業所勤務の決定（全事業所の合算）の上限の累計。合計を登録していない賞与は自社の額で数える
  const healthTotalC = new Map<string, number>();
  const pensionTotalC = new Map<string, number>();

  return sorted.map((bonus) => {
    const yearMonth = monthOf(bonus.paidDate);
    const standardBonus = standardBonusOf(bonus.amount);
    const base: BonusResult = {
      bonus,
      yearMonth,
      status: 'ok',
      target: bonusTarget(employee.qualifications, bonus.paidDate),
      officeId: null,
      insurerId: null,
      standardBonus,
      base: { health: 0, pension: 0 },
      capped: { health: false, pension: false },
      exemption: 'none',
      premium: null,
      rates: null,
    };
    if (base.target === 'outside') return { ...base, status: 'outside' };

    let office;
    try {
      office = findOffice(employee.assignments, masters.offices, bonus.paidDate);
    } catch {
      return { ...base, status: 'noOffice' };
    }
    const std = findEffective(employee.standardHistory, yearMonth);
    const insurer = masters.insurers.find((i) => i.id === (std?.selectedInsurerId || office.insurerId));
    if (!insurer) return { ...base, status: 'noOffice', officeId: office.id };
    const multi = !!(std?.ownRemuneration && std?.totalRemuneration && std.ownRemuneration < std.totalRemuneration);

    // 上限（免除・喪失月の賞与も累計には含める）
    const hKey = `${insurer.id}|${fiscalYearOf(bonus.paidDate)}`;
    const hBefore = healthTotal.get(hKey) ?? 0;
    const health = Math.max(0, Math.min(standardBonus, HEALTH_BONUS_CAP - hBefore));
    healthTotal.set(hKey, hBefore + health);
    const pBefore = pensionTotal.get(yearMonth) ?? 0;
    const pension = Math.max(0, Math.min(standardBonus, PENSION_BONUS_CAP - pBefore));
    pensionTotal.set(yearMonth, pBefore + pension);

    // 全事業所の合計を登録した賞与は、合算した標準賞与額で上限を当てる
    const total = multi && bonus.totalAmount && bonus.totalAmount > bonus.amount ? bonus.totalAmount : null;
    const standardTotal = standardBonusOf(total ?? bonus.amount);
    const hcBefore = healthTotalC.get(hKey) ?? 0;
    const healthC = Math.max(0, Math.min(standardTotal, HEALTH_BONUS_CAP - hcBefore));
    healthTotalC.set(hKey, hcBefore + healthC);
    const pcBefore = pensionTotalC.get(yearMonth) ?? 0;
    const pensionC = Math.max(0, Math.min(standardTotal, PENSION_BONUS_CAP - pcBefore));
    pensionTotalC.set(yearMonth, pcBefore + pensionC);

    const exemption = bonusExemption(employee.leaves, bonus.paidDate);
    const common = {
      ...base,
      officeId: office.id,
      insurerId: insurer.id,
      base: { health, pension },
      capped: { health: health < standardBonus, pension: pension < standardBonus },
      exemption,
      multiOffice: multi,
      // 自社の賞与だけで、同月150万円・年度573万円の上限の半分を超える
      multiOfficeReview: multi && (pBefore + pension > PENSION_BONUS_CAP / 2 || hBefore + health > HEALTH_BONUS_CAP / 2),
    };
    if (base.target === 'lostMonth') return common;

    const pensionRate = findEffective(masters.pensionRates, yearMonth);
    const rates: MonthlyPremiumInput['rates'] = {
      health: findRate(masters.insurerRates, insurer, 'health', office.prefecture, yearMonth),
      care: findRate(masters.insurerRates, insurer, 'care', office.prefecture, yearMonth),
      childSupport: findRate(masters.insurerRates, insurer, 'childSupport', office.prefecture, yearMonth),
      pension: pensionRate ? { rate: pensionRate.rate, share: pensionRate.employeeShare } : null,
    };
    const input = {
      yearMonth,
      birthDate: employee.birthDate,
      insured: true,
      leaveExempt: exemption !== 'none',
      rates,
      exclusions: exemptedInsurances(employee.exemptions, yearMonth),
      specialInsured: employee.specialInsured ?? isSpecialInsuredMonth(insurer, employee.dependents, yearMonth),
      childSupportRounding,
    };
    const premium = calcMonthlyPremium({ ...input, standard: { health, pension } });
    const result: BonusResult = { ...common, status: premium.missingRates.length > 0 ? 'missingRate' : 'ok', premium, rates };
    if (total !== null) {
      // 合算した標準賞与額の保険料を、賞与額の割合（自社 ÷ 合計）で按分する（月額と同じく割り算は最後）
      const decidedPremium = calcMonthlyPremium({
        ...input,
        standard: { health: healthC, pension: pensionC },
        multiOffice: { own: bonus.amount, total },
      });
      const sum = (p: MonthlyPremium) =>
        Number([p.health, p.care, p.childSupport, p.pension].reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n));
      result.decided = { totalAmount: total, standardTotal, base: { health: healthC, pension: pensionC }, premium: decidedPremium };
      result.decidedDiff = sum(decidedPremium) - sum(premium);
      result.multiOfficeReview = false;
    }
    return result;
  });
}

/** 賞与支払届の期限（支給日から5日以内） */
export function bonusReportDeadline(paidDate: string): string {
  return addDays(paidDate, 5);
}
