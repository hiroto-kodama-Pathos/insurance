// 1人・1か月分の月額保険料（設計書 2.3・2.5・5.2）
// 料率の選び方（対象月・保険者・都道府県）は呼び出す側で済ませ、ここには選んだ料率を渡す。
// ここでは「どの保険がかかるか」の判定と、端数処理のまとめ方だけを行う。
import { careStatus, isHealthAge, isPensionAge } from './age';
import { calcPremium, PremiumResult } from './premium-calculator';

/** 料率と本人負担割合（どちらも整数。料率は10万分率、割合は千分率） */
export type RateShare = { rate: number; share: number };

/** 子ども・子育て支援金の本人負担の端数処理 */
export type ChildSupportRounding = 'combined' | 'separate';

export type MonthlyPremiumInput = {
  /** 対象月 'YYYY-MM' */
  yearMonth: string;
  /** 生年月日 'YYYY-MM-DD' */
  birthDate: string;
  /** 対象月に資格があるか（資格の期間から呼び出す側で判定） */
  insured: boolean;
  /** 産休・育休で免除される月か */
  leaveExempt: boolean;
  /** 対象月の標準報酬月額（円）。70歳以上の厚生年金は相当額が入っていても計算には使わない */
  standard: { health: number; pension: number };
  /** 対象月に有効な料率。null は「未登録」 */
  rates: {
    health: RateShare | null;
    care: RateShare | null;
    childSupport: RateShare | null;
    pension: RateShare | null;
  };
  /** 適用除外（その保険だけ0円にする） */
  exclusions?: { health?: boolean; care?: boolean; pension?: boolean };
  /** 特定被保険者として介護保険料をかけるか（組合健保の判定結果） */
  specialInsured?: boolean;
  /** 二以上事業所勤務の自社の報酬・合計の報酬（通常は省略） */
  multiOffice?: { own: number; total: number };
  /** 支援金の端数処理（会社の設定）。省略時は合算 */
  childSupportRounding?: ChildSupportRounding;
};

/** 保険ごとの結果。かからない保険は null */
export type MonthlyPremium = {
  health: PremiumResult | null;
  care: PremiumResult | null;
  childSupport: PremiumResult | null;
  pension: PremiumResult | null;
  /** 一覧に出す状態 */
  careLabel: 'second' | 'special' | 'first' | 'none';
  exempt: boolean;
  /** 料率が未登録で計算できなかった保険 */
  missingRates: ('health' | 'care' | 'childSupport' | 'pension')[];
};

/** 子ども・子育て支援金を計算し始める月（2026年4月分から） */
export const CHILD_SUPPORT_START = '2026-04';

const ZERO: PremiumResult = { fullSen: 0n, employeeYen: 0n, employerSen: 0n };

/**
 * 1人・1か月分の月額保険料を計算する
 *
 * 端数処理のまとめ方
 * - 健康保険と介護保険は、本人負担割合が同じなら合算して1回で処理し、
 *   介護保険の本人負担は「合算した額 − 健康保険だけの額」とする（合計は変わらない）
 * - 支援金は、設定が 'combined' なら健康保険（介護保険を含む）と合算して1回で処理し、
 *   支援金の本人負担は「支援金を含めた額 − 含めない額」とする
 * - 厚生年金は常に別に処理する
 */
export function calcMonthlyPremium(input: MonthlyPremiumInput): MonthlyPremium {
  const { yearMonth, birthDate, rates } = input;
  const ex = input.exclusions ?? {};
  const own = input.multiOffice?.own ?? 1;
  const total = input.multiOffice?.total ?? 1;
  const missing: MonthlyPremium['missingRates'] = [];

  const ageCare = careStatus(birthDate, yearMonth);
  const careLabel: MonthlyPremium['careLabel'] =
    ageCare === 'second' ? 'second' : input.specialInsured ? 'special' : ageCare;

  const result: MonthlyPremium = {
    health: null,
    care: null,
    childSupport: null,
    pension: null,
    careLabel,
    exempt: false,
    missingRates: missing,
  };
  if (!input.insured) return result;

  if (input.leaveExempt) {
    // 免除の月も、かからない保険（75歳以上の健康保険・70歳以上の厚生年金・適用除外）は「0円」ではなく対象外（null）にする
    result.exempt = true;
    const healthAge = isHealthAge(birthDate, yearMonth) && !ex.health;
    result.health = healthAge ? ZERO : null;
    result.childSupport = healthAge && yearMonth >= CHILD_SUPPORT_START ? ZERO : null;
    result.pension = isPensionAge(birthDate, yearMonth) && !ex.pension ? ZERO : null;
    result.care = healthAge && (careLabel === 'second' || careLabel === 'special') && !ex.care ? ZERO : null;
    return result;
  }

  // ---- 健康保険・介護保険・支援金 ----
  const healthOn = isHealthAge(birthDate, yearMonth) && !ex.health;
  const careOn = healthOn && (careLabel === 'second' || careLabel === 'special') && !ex.care;
  const supportOn = healthOn && yearMonth >= CHILD_SUPPORT_START;

  if (healthOn) {
    const h = rates.health;
    const c = careOn ? rates.care : null;
    const s = supportOn ? rates.childSupport : null;
    if (!h) missing.push('health');
    if (careOn && !c) missing.push('care');
    if (supportOn && !s) missing.push('childSupport');

    if (h && (!careOn || c) && (!supportOn || s)) {
      const std = input.standard.health;
      const calc = (r: number, sh: number) => calcPremium(std, r, sh, own, total);

      // 健康保険＋介護保険
      const hcCombined = c !== null && c.share === h.share;
      const healthOnly = calc(h.rate, h.share);
      let careRes: PremiumResult | null = null;
      let hcEmployee: bigint;
      if (c && hcCombined) {
        const hc = calc(h.rate + c.rate, h.share);
        const careFull = hc.fullSen - healthOnly.fullSen;
        const careEmp = hc.employeeYen - healthOnly.employeeYen;
        careRes = { fullSen: careFull, employeeYen: careEmp, employerSen: careFull - careEmp * 100n };
        hcEmployee = hc.employeeYen;
      } else {
        if (c) careRes = calc(c.rate, c.share);
        hcEmployee = healthOnly.employeeYen + (careRes?.employeeYen ?? 0n);
      }
      result.health = healthOnly;
      result.care = careRes;

      // 支援金
      if (s) {
        const mode = input.childSupportRounding ?? 'combined';
        const canCombine = mode === 'combined' && s.share === h.share && (c === null || hcCombined);
        if (canCombine) {
          const withS = calc(h.rate + (c?.rate ?? 0) + s.rate, h.share);
          const supportFull = calc(s.rate, s.share).fullSen;
          const supportEmp = withS.employeeYen - hcEmployee;
          result.childSupport = {
            fullSen: supportFull,
            employeeYen: supportEmp,
            employerSen: supportFull - supportEmp * 100n,
          };
        } else {
          result.childSupport = calc(s.rate, s.share);
        }
      }
    }
  }

  // ---- 厚生年金 ----
  if (isPensionAge(birthDate, yearMonth) && !ex.pension) {
    const p = rates.pension;
    if (!p) missing.push('pension');
    else result.pension = calcPremium(input.standard.pension, p.rate, p.share, own, total);
  }

  return result;
}

/**
 * 介護保険の欄に出す、かからない理由（月次の一覧・賞与の一覧で同じ表示にする）
 * 介護保険料がかかる人・計算していない人は空
 */
export function careNote(p: Pick<MonthlyPremium, 'care' | 'careLabel'> | null | undefined): string {
  if (!p || p.care) return '';
  if (p.careLabel === 'first') return '第1号（65歳以上）';
  if (p.careLabel === 'none') return '対象外（40歳未満）';
  return '';
}
