// 保険料の計算（設計書 2.5・5.3）
// 料率と負担割合を整数で持ち、割り算の前に掛け算をすべて終えてから、余りで50銭超かを判定する。

/** 1人分・1つの保険の保険料計算結果 */
export type PremiumResult = {
  /** 全額（銭） */
  fullSen: bigint;
  /** 本人負担（円）。50銭以下切り捨て・50銭超切り上げ */
  employeeYen: bigint;
  /** 会社負担（銭）。全額 − 本人負担 */
  employerSen: bigint;
};

/** 会社全体の保険料合計 */
export type CompanyTotals = {
  /** 納付見込額（円）。全額の合計の円未満を切り捨てた額 */
  paymentYen: bigint;
  /** 本人負担合計（円） */
  employeeTotal: bigint;
  /** 会社負担合計（円）。納付見込額 − 本人負担合計 */
  employerTotal: bigint;
};

/**
 * 1人分・1つの保険の保険料を計算する
 *
 * 呼び出す側の決まり
 * - 40〜64歳（と特定被保険者）は、rate に健康保険料率＋介護保険料率の合計を渡す（例：東京 9850＋1620＝11470）
 * - 厚生年金保険料は、別に呼び出す
 * - 引数はすべて整数で渡す（小数を渡すと BigInt がエラーになる）
 *
 * @param standard 標準報酬月額または標準賞与額（円）
 * @param rate 料率（10万分率の整数。例：9.85% → 9850）
 * @param share 本人負担割合（千分率の整数。例：折半 → 500）
 * @param own 二以上事業所勤務の場合の自社の報酬（円）。通常は1
 * @param total 二以上事業所勤務の場合の合計の報酬（円）。通常は1
 */
export function calcPremium(
  standard: number,
  rate: number,
  share: number,
  own: number = 1,
  total: number = 1,
): PremiumResult {
  if (total <= 0 || own < 0 || own > total) {
    throw new Error('自社の報酬・合計の報酬が不正です');
  }

  const fullNum = BigInt(standard) * BigInt(rate) * BigInt(own);
  const fullDen = 1_000n * BigInt(total);
  const fullSen = fullNum / fullDen;

  const numerator = fullNum * BigInt(share);
  const denominator = 100_000n * 1_000n * BigInt(total);
  const base = numerator / denominator;
  const remainder = numerator % denominator;
  const employeeYen = remainder * 2n > denominator ? base + 1n : base;

  const employerSen = fullSen - employeeYen * 100n;
  return { fullSen, employeeYen, employerSen };
}

/**
 * 納付見込額・本人負担合計・会社負担合計を計算する
 *
 * 適用事業所ごと・保険者ごと・保険の種類ごとに呼び出す。
 * 会社全体の合計は、この結果を足し上げるだけにし、切り捨て直さない。
 *
 * @param results その単位に含まれる個人別の計算結果
 */
export function calcCompanyTotals(
  results: Pick<PremiumResult, 'fullSen' | 'employeeYen'>[],
): CompanyTotals {
  const paymentYen = results.reduce((sum, r) => sum + r.fullSen, 0n) / 100n;
  const employeeTotal = results.reduce((sum, r) => sum + r.employeeYen, 0n);
  return { paymentYen, employeeTotal, employerTotal: paymentYen - employeeTotal };
}

/** 会社負担（銭）を、画面・CSVに表示する円単位に直す（円未満切り捨て） */
export function senToDisplayYen(sen: bigint): bigint {
  return sen / 100n;
}