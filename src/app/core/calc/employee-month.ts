// 従業員1人・1か月分の保険料を、従業員のデータとマスタから求める（設計書 5.4 月次計算の流れ）
// 画面や Firestore には依存しない。読み込んだデータを渡して呼び出す。
import {
  Exemption,
  exemptedInsurances,
  isInsuredInMonth,
  isLeaveExemptMonth,
  Leave,
  Qualification,
} from './eligibility';
import { isSpecialInsuredMonth } from './dependent';
import { calcMonthlyPremium, ChildSupportRounding, MonthlyPremium, MonthlyPremiumInput, RateShare } from './monthly-premium';
import { Assignment, findOffice, monthlyBaseDate, Office } from './office';
import type { Insurer, InsurerRate, PensionRate } from './rate';

/** 標準報酬月額の履歴（計算に使う項目だけ） */
export type StandardHistory = {
  validFrom: string;
  healthStandard: number;
  pensionStandard: number;
  /** 決めたときの報酬月額（参考。最高・最低等級付近の特例の判定に使う） */
  remuneration?: number | null;
  /** 二以上事業所勤務：自社の報酬・全事業所の合計の報酬・本人が選んだ保険者 */
  ownRemuneration?: number | null;
  totalRemuneration?: number | null;
  selectedInsurerId?: string | null;
};

/** 計算に使う従業員1人分のデータ */
export type EmployeeData = {
  id: string;
  birthDate: string;
  qualifications: Qualification[];
  leaves: Leave[];
  exemptions: Exemption[];
  assignments: Assignment[];
  standardHistory: StandardHistory[];
  /** 被扶養者（特定被保険者の判定に使う） */
  dependents?: import('./dependent').Dependent[];
  /** 被保険者区分の履歴（なければ一般被保険者） */
  insuredTypes?: import('./insured-type').InsuredTypeHistory[];
  /** 特定被保険者として介護保険料をかける月か（組合健保の判定結果。月ごとに呼び出す側で求める） */
  specialInsured?: boolean;
};

export type Masters = {
  offices: Office[];
  insurers: Insurer[];
  insurerRates: InsurerRate[];
  pensionRates: PensionRate[];
};

export type EmployeeMonthResult = {
  employeeId: string;
  yearMonth: string;
  /**
   * ok：計算できた / notInsured：資格のない月 / noOffice：所属事業所がない
   * noStandard：標準報酬月額の履歴がない / missingRate：料率が未登録の保険がある
   */
  status: 'ok' | 'notInsured' | 'noOffice' | 'noStandard' | 'missingRate';
  officeId: string | null;
  insurerId: string | null;
  standard: { health: number; pension: number } | null;
  premium: MonthlyPremium | null;
  /** 計算に使った料率と本人負担割合（月次確定で根拠として保存する） */
  rates: MonthlyPremiumInput['rates'] | null;
};

/** 適用開始年月つきの一覧から、対象月に有効なもの（対象月以前で最も新しいもの）を選ぶ */
export function findEffective<T extends { validFrom: string }>(items: T[], yearMonth: string): T | null {
  let found: T | null = null;
  for (const item of items) {
    if (item.validFrom <= yearMonth && (found === null || item.validFrom > found.validFrom)) {
      found = item;
    }
  }
  return found;
}

/** 保険者・種類・都道府県の料率から、対象月に有効なものを選ぶ */
function findInsurerRate(
  rates: InsurerRate[],
  insurer: Insurer,
  rateType: InsurerRate['rateType'],
  prefecture: string,
  yearMonth: string,
): RateShare | null {
  // 都道府県別なのは、協会けんぽの健康保険料率だけ
  const byPrefecture = insurer.type === 'kyokai' && rateType === 'health';
  const candidates = rates.filter(
    (r) =>
      r.insurerId === insurer.id &&
      r.rateType === rateType &&
      r.prefecture === (byPrefecture ? prefecture : null),
  );
  const found = findEffective(candidates, yearMonth);
  return found ? { rate: found.rate, share: found.employeeShare } : null;
}

/**
 * 従業員1人・1か月分の保険料を求める
 *
 * @param employee 従業員のデータ
 * @param masters 事業所・保険者・料率
 * @param yearMonth 対象月 'YYYY-MM'
 * @param childSupportRounding 支援金の端数処理（会社の設定）
 * @param basis 確定時の根拠（さかのぼる差額の計算で、確定時と同じ事業所なら料率を確定時のものにする）
 */
export function calcEmployeeMonth(
  employee: EmployeeData,
  masters: Masters,
  yearMonth: string,
  childSupportRounding: ChildSupportRounding = 'combined',
  basis?: { officeId: string; rates: MonthlyPremiumInput['rates'] | null },
): EmployeeMonthResult {
  const base: EmployeeMonthResult = {
    employeeId: employee.id,
    yearMonth,
    status: 'ok',
    officeId: null,
    insurerId: null,
    standard: null,
    premium: null,
    rates: null,
  };

  if (!isInsuredInMonth(employee.qualifications, yearMonth)) {
    return { ...base, status: 'notInsured' };
  }

  // 異動した月は、月末に所属する事業所で1か月分を計算する
  let office: Office;
  try {
    office = findOffice(employee.assignments, masters.offices, monthlyBaseDate(yearMonth));
  } catch {
    return { ...base, status: 'noOffice' };
  }
  const std = findEffective(employee.standardHistory, yearMonth);
  // 二以上事業所勤務の人は、本人が選んだ保険者の料率を使う（設計書 2.12）
  const insurerId = std?.selectedInsurerId || office.insurerId;
  const insurer = masters.insurers.find((i) => i.id === insurerId);
  if (!insurer) {
    return { ...base, status: 'noOffice', officeId: office.id };
  }
  if (!std) {
    return { ...base, status: 'noStandard', officeId: office.id, insurerId: insurer.id };
  }

  const pension = findEffective(masters.pensionRates, yearMonth);
  const multiOffice =
    std.ownRemuneration && std.totalRemuneration
      ? { own: std.ownRemuneration, total: std.totalRemuneration }
      : undefined;

  const liveRates: MonthlyPremiumInput['rates'] = {
    health: findInsurerRate(masters.insurerRates, insurer, 'health', office.prefecture, yearMonth),
    care: findInsurerRate(masters.insurerRates, insurer, 'care', office.prefecture, yearMonth),
    childSupport: findInsurerRate(masters.insurerRates, insurer, 'childSupport', office.prefecture, yearMonth),
    pension: pension ? { rate: pension.rate, share: pension.employeeShare } : null,
  };
  // さかのぼる改定の差額では、確定時と同じ事業所なら確定時の料率を使う（設計書 2.20）
  const rates = basis?.rates && basis.officeId === office.id ? basis.rates : liveRates;
  const premium = calcMonthlyPremium({
    yearMonth,
    birthDate: employee.birthDate,
    insured: true,
    leaveExempt: isLeaveExemptMonth(employee.leaves, yearMonth),
    standard: { health: std.healthStandard, pension: std.pensionStandard },
    rates,
    exclusions: exemptedInsurances(employee.exemptions, yearMonth),
    specialInsured: employee.specialInsured ?? isSpecialInsuredMonth(insurer, employee.dependents, yearMonth),
    multiOffice,
    childSupportRounding,
  });

  return {
    ...base,
    status: premium.missingRates.length > 0 ? 'missingRate' : 'ok',
    officeId: office.id,
    insurerId: insurer.id,
    standard: { health: std.healthStandard, pension: std.pensionStandard },
    premium,
    rates,
  };
}
