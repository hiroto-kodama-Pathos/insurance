// 報酬月額から標準報酬月額を提案する（設計書 2.6・3.1）
// 等級は、組合健保の会社でも協会けんぽの保険料額表で判定する。
import { isPensionAge } from './age';
import type { GradeThreshold } from './revision';

/** 協会けんぽの保険料額表の1行（健康保険の等級ごと） */
export type GradeRow = {
  validFrom: string;
  /** 健康保険の等級（1〜50） */
  healthGrade: number;
  /** 厚生年金の等級（1〜32）。厚生年金の範囲外の行は null */
  pensionGrade: number | null;
  /** 報酬月額の下限（円、以上） */
  lowerLimit: number;
  /** 報酬月額の上限（円、未満）。最上位は null */
  upperLimit: number | null;
  /** 標準報酬月額（円） */
  standardAmount: number;
};

export type GradeSuggestion = {
  healthGrade: number;
  healthStandard: number;
  pensionGrade: number;
  pensionStandard: number;
  /** 70歳以上で、厚生年金の欄は相当額（保険料の計算には使わない） */
  pensionIsEquivalent: boolean;
};

/**
 * 報酬月額から、健康保険・厚生年金の標準報酬月額を提案する
 *
 * - 対象月に有効な等級表（適用開始月が対象月以前で最も新しいもの）を使う
 * - 厚生年金は等級の範囲が狭いので、範囲より低ければ最下位、高ければ最上位の等級にする
 *
 * @param remuneration 報酬月額（円）
 * @param grades 等級表（複数の適用開始月を含んでよい）
 * @param yearMonth 適用開始月 'YYYY-MM'
 * @param birthDate 生年月日（70歳以上かの判定に使う）
 * @returns 提案。等級表がなければ null
 */
export function suggestStandards(
  remuneration: number,
  grades: GradeRow[],
  yearMonth: string,
  birthDate: string,
): GradeSuggestion | null {
  const validFrom = grades
    .map((g) => g.validFrom)
    .filter((v) => v <= yearMonth)
    .sort()
    .at(-1);
  if (!validFrom) return null;
  const table = grades.filter((g) => g.validFrom === validFrom);

  const health = table.find(
    (g) => g.lowerLimit <= remuneration && (g.upperLimit === null || remuneration < g.upperLimit),
  );
  if (!health) return null;

  const pensionRows = table
    .filter((g) => g.pensionGrade !== null)
    .sort((a, b) => a.lowerLimit - b.lowerLimit);
  if (pensionRows.length === 0) return null;
  let pension = health.pensionGrade !== null ? health : null;
  if (!pension) {
    pension = remuneration < pensionRows[0].lowerLimit ? pensionRows[0] : pensionRows[pensionRows.length - 1];
  }

  return {
    healthGrade: health.healthGrade,
    healthStandard: health.standardAmount,
    pensionGrade: pension.pensionGrade!,
    pensionStandard: pension.standardAmount,
    pensionIsEquivalent: birthDate !== '' && !isPensionAge(birthDate, yearMonth),
  };
}

/**
 * 協会けんぽの保険料額表の等級（健康保険50等級・厚生年金32等級）
 * エミュレータのシードとテストで使う。本番のマスタは運営者が公表資料から投入する。
 */
export const KYOKAI_GRADE_BOUNDS: [standard: number, lower: number][] = [
  [58_000, 0], [68_000, 63_000], [78_000, 73_000], [88_000, 83_000], [98_000, 93_000],
  [104_000, 101_000], [110_000, 107_000], [118_000, 114_000], [126_000, 122_000], [134_000, 130_000],
  [142_000, 138_000], [150_000, 146_000], [160_000, 155_000], [170_000, 165_000], [180_000, 175_000],
  [190_000, 185_000], [200_000, 195_000], [220_000, 210_000], [240_000, 230_000], [260_000, 250_000],
  [280_000, 270_000], [300_000, 290_000], [320_000, 310_000], [340_000, 330_000], [360_000, 350_000],
  [380_000, 370_000], [410_000, 395_000], [440_000, 425_000], [470_000, 455_000], [500_000, 485_000],
  [530_000, 515_000], [560_000, 545_000], [590_000, 575_000], [620_000, 605_000], [650_000, 635_000],
  [680_000, 665_000], [710_000, 695_000], [750_000, 730_000], [790_000, 770_000], [830_000, 810_000],
  [880_000, 855_000], [930_000, 905_000], [980_000, 955_000], [1_030_000, 1_005_000], [1_090_000, 1_055_000],
  [1_150_000, 1_115_000], [1_210_000, 1_175_000], [1_270_000, 1_235_000], [1_330_000, 1_295_000], [1_390_000, 1_355_000],
];

/** KYOKAI_GRADE_BOUNDS から等級表の行を作る（厚生年金は健康保険の4〜35等級に当たる） */
export function buildKyokaiGrades(validFrom: string): GradeRow[] {
  return KYOKAI_GRADE_BOUNDS.map(([standard, lower], i) => {
    const healthGrade = i + 1;
    const next = KYOKAI_GRADE_BOUNDS[i + 1];
    return {
      validFrom,
      healthGrade,
      pensionGrade: healthGrade >= 4 && healthGrade <= 35 ? healthGrade - 3 : null,
      lowerLimit: lower,
      upperLimit: next ? next[1] : null,
      standardAmount: standard,
    };
  });
}

/**
 * 最高等級・最低等級付近の特例の閾値（現行。設計書 2.14）
 * エミュレータのシードとテストで使う。本番は gradeThresholds に運営者が投入する。
 */
export function buildKyokaiThresholds(validFrom: string): GradeThreshold[] {
  return [
    { validFrom, insuranceType: 'health', maxGrade: 50, upper: 1_415_000, lower: 53_000, topLower: 1_355_000, secondLower: 63_000 },
    { validFrom, insuranceType: 'pension', maxGrade: 32, upper: 665_000, lower: 83_000, topLower: 635_000, secondLower: 93_000 },
  ];
}

/** その月に使う等級表（適用開始月が対象月以前で最も新しいもの）。なければ空 */
export function gradeTableAt(grades: GradeRow[], yearMonth: string): GradeRow[] {
  const from = [...new Set(grades.map((g) => g.validFrom))].filter((v) => v <= yearMonth).sort().at(-1);
  return from ? grades.filter((g) => g.validFrom === from) : [];
}

/**
 * 標準報酬月額が、その月の等級表の額か（設計書 2.6）。等級の額でなければ、近い等級を添えたエラーの文を返す
 * 健康保険は50等級、厚生年金は32等級（等級の範囲が狭い）で、どの保険者でも同じ（健康保険法40条・厚生年金保険法20条）。
 * 組合健保の会社・70歳以上の人の相当額も同じ等級の額を使う。等級表がない月は確かめない（null）
 * @param kind 'health'（健康保険）・'pension'（厚生年金）
 */
export function standardGradeError(grades: GradeRow[], yearMonth: string, kind: 'health' | 'pension', amount: number): string | null {
  const table = gradeTableAt(grades, yearMonth).filter((g) => kind === 'health' || g.pensionGrade !== null);
  if (table.length === 0) return null;
  if (table.some((g) => g.standardAmount === amount)) return null;
  const label = kind === 'health' ? '健康保険' : '厚生年金';
  const sorted = [...table].sort((a, b) => a.standardAmount - b.standardAmount);
  const lower = sorted.filter((g) => g.standardAmount < amount).at(-1);
  const upper = sorted.find((g) => g.standardAmount > amount);
  const show = (g: GradeRow) => `${(g.standardAmount / 10_000).toLocaleString('ja-JP')}万円（${kind === 'health' ? g.healthGrade : g.pensionGrade}等級）`;
  const near = [lower, upper].filter((g): g is GradeRow => !!g).map(show).join('・');
  return `${amount.toLocaleString('ja-JP')}円は${label}の等級の額ではありません。決定通知書の額を入れてください（近い等級：${near}）`;
}
