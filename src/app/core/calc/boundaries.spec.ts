// 境界値のテスト（標準報酬月額の等級・随時改定の等級差・保険料の端数処理）
//
// 正解は、アプリの等級表（grade-suggest.ts の KYOKAI_GRADE_BOUNDS）から作らず、
// 協会けんぽの保険料額表の「報酬月額」の欄をこのファイルに書き写したもの（OFFICIAL）を使う。
// 等級表の入力の誤り（1つの等級の下限の打ち間違いなど）も、ここで見つけられるようにするため。
//   健康保険：50等級（平成28年4月から）／厚生年金：32等級（令和2年9月から。健康保険の4〜35等級に当たる）
import { describe, expect, it } from 'vitest';
import { buildKyokaiGrades, buildKyokaiThresholds, suggestStandards } from './grade-suggest';
import { calcPremium } from './premium-calculator';
import { findRevisionCandidates, RevisionEmployee } from './revision';
import { SalaryRecord } from './salary';
import { careStatus } from './age';
import { Bonus } from './bonus';

/** 保険料額表の [健康保険の等級, 標準報酬月額, 報酬月額の下限（以上）, 報酬月額の上限（未満。最上位は null）, 厚生年金の等級] */
const OFFICIAL: [number, number, number, number | null, number | null][] = [
  [1, 58_000, 0, 63_000, null],
  [2, 68_000, 63_000, 73_000, null],
  [3, 78_000, 73_000, 83_000, null],
  [4, 88_000, 83_000, 93_000, 1],
  [5, 98_000, 93_000, 101_000, 2],
  [6, 104_000, 101_000, 107_000, 3],
  [7, 110_000, 107_000, 114_000, 4],
  [8, 118_000, 114_000, 122_000, 5],
  [9, 126_000, 122_000, 130_000, 6],
  [10, 134_000, 130_000, 138_000, 7],
  [11, 142_000, 138_000, 146_000, 8],
  [12, 150_000, 146_000, 155_000, 9],
  [13, 160_000, 155_000, 165_000, 10],
  [14, 170_000, 165_000, 175_000, 11],
  [15, 180_000, 175_000, 185_000, 12],
  [16, 190_000, 185_000, 195_000, 13],
  [17, 200_000, 195_000, 210_000, 14],
  [18, 220_000, 210_000, 230_000, 15],
  [19, 240_000, 230_000, 250_000, 16],
  [20, 260_000, 250_000, 270_000, 17],
  [21, 280_000, 270_000, 290_000, 18],
  [22, 300_000, 290_000, 310_000, 19],
  [23, 320_000, 310_000, 330_000, 20],
  [24, 340_000, 330_000, 350_000, 21],
  [25, 360_000, 350_000, 370_000, 22],
  [26, 380_000, 370_000, 395_000, 23],
  [27, 410_000, 395_000, 425_000, 24],
  [28, 440_000, 425_000, 455_000, 25],
  [29, 470_000, 455_000, 485_000, 26],
  [30, 500_000, 485_000, 515_000, 27],
  [31, 530_000, 515_000, 545_000, 28],
  [32, 560_000, 545_000, 575_000, 29],
  [33, 590_000, 575_000, 605_000, 30],
  [34, 620_000, 605_000, 635_000, 31],
  [35, 650_000, 635_000, 665_000, 32],
  [36, 680_000, 665_000, 695_000, null],
  [37, 710_000, 695_000, 730_000, null],
  [38, 750_000, 730_000, 770_000, null],
  [39, 790_000, 770_000, 810_000, null],
  [40, 830_000, 810_000, 855_000, null],
  [41, 880_000, 855_000, 905_000, null],
  [42, 930_000, 905_000, 955_000, null],
  [43, 980_000, 955_000, 1_005_000, null],
  [44, 1_030_000, 1_005_000, 1_055_000, null],
  [45, 1_090_000, 1_055_000, 1_115_000, null],
  [46, 1_150_000, 1_115_000, 1_175_000, null],
  [47, 1_210_000, 1_175_000, 1_235_000, null],
  [48, 1_270_000, 1_235_000, 1_295_000, null],
  [49, 1_330_000, 1_295_000, 1_355_000, null],
  [50, 1_390_000, 1_355_000, null, null],
];

const grades = buildKyokaiGrades('2020-09');
const thresholds = buildKyokaiThresholds('2020-09');
const suggest = (remuneration: number) => suggestStandards(remuneration, grades, '2026-10', '1980-05-10')!;

describe('境界値：アプリの等級表が保険料額表と一致する', () => {
  it('健康保険50等級・厚生年金32等級の、標準報酬月額・下限・上限・厚生年金の等級がすべて一致する', () => {
    expect(grades.map((g) => [g.healthGrade, g.standardAmount, g.lowerLimit, g.upperLimit, g.pensionGrade])).toEqual(OFFICIAL);
  });
});

describe('境界値：報酬月額から健康保険の等級を決める（下限ちょうどは上の等級、1円手前は下の等級）', () => {
  it.each(OFFICIAL.filter(([grade]) => grade > 1))('%i等級（%i円）：下限ちょうどでこの等級、1円手前で1つ下の等級', (grade, standard, lower) => {
    expect(suggest(lower).healthGrade).toBe(grade);
    expect(suggest(lower).healthStandard).toBe(standard);
    expect(suggest(lower - 1).healthGrade).toBe(grade - 1);
  });

  it('最低・最高等級の外側：0円・1円は1等級（5.8万円）、上限のない最高等級は1,000万円でも50等級（139万円）', () => {
    expect(suggest(0).healthStandard).toBe(58_000);
    expect(suggest(1).healthStandard).toBe(58_000);
    expect(suggest(1_354_999).healthGrade).toBe(49);
    expect(suggest(1_355_000).healthStandard).toBe(1_390_000);
    expect(suggest(10_000_000).healthStandard).toBe(1_390_000);
  });
});

describe('境界値：厚生年金の等級（8.8万円〜65万円の32等級）', () => {
  it.each(OFFICIAL.filter(([, , , , p]) => p !== null && p > 1))(
    '健康保険%i等級（%i円）の下限ちょうどで、厚生年金も1つ上の等級になる',
    (_grade, standard, lower, _upper, pension) => {
      expect(suggest(lower).pensionGrade).toBe(pension);
      expect(suggest(lower).pensionStandard).toBe(standard);
      expect(suggest(lower - 1).pensionGrade).toBe(pension! - 1);
    },
  );

  it('最低等級より下（9.3万円未満）は、厚生年金だけ1等級（8.8万円）', () => {
    expect(suggest(0).pensionStandard).toBe(88_000);
    expect(suggest(62_999).pensionStandard).toBe(88_000); // 健康保険は1等級（5.8万円）
    expect(suggest(92_999).pensionStandard).toBe(88_000);
    expect(suggest(93_000).pensionStandard).toBe(98_000);
  });

  it('最高等級より上（63.5万円以上）は、厚生年金だけ32等級（65万円）', () => {
    expect(suggest(634_999).pensionStandard).toBe(620_000);
    expect(suggest(635_000).pensionStandard).toBe(650_000);
    expect(suggest(665_000).pensionStandard).toBe(650_000); // 健康保険は36等級（68万円）
    expect(suggest(10_000_000).pensionStandard).toBe(650_000);
  });
});

// ---- 随時改定：2等級以上の差の境界と、最高・最低等級付近の特例 ----

function employee(health: number, pension = health, remuneration?: number): RevisionEmployee {
  return {
    id: 'e1',
    birthDate: '1980-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: health, pensionStandard: pension, remuneration }],
  };
}

/** 7月は before、8〜10月は after の固定的賃金（変動月は8月。3か月の平均は after そのもの） */
function pay(before: number, after: number): SalaryRecord[] {
  return ['2026-07', '2026-08', '2026-09', '2026-10'].map((ym, i) => ({
    id: `s${i}`, employeeId: 'e1', paidDate: `${ym}-25`,
    fixedWages: i === 0 ? before : after, nonFixedWages: 0, paymentBaseDays: 30,
    retroactiveDiff: null, inKindWages: null,
  }));
}

const revise = (e: RevisionEmployee, before: number, after: number) => findRevisionCandidates(e, pay(before, after), grades, thresholds);

describe('境界値：随時改定の2等級以上の差', () => {
  it('上がるとき：30万円（22等級）の人は、平均33万円（24等級の下限）で候補、32万9,999円（23等級）では候補にならない', () => {
    expect(revise(employee(300_000), 300_000, 330_000)[0]?.health.diff).toBe(2);
    expect(revise(employee(300_000), 300_000, 329_999)).toEqual([]);
  });

  it('下がるとき：30万円（22等級）の人は、平均26万9,999円（20等級）で候補、27万円（21等級の下限）では候補にならない', () => {
    expect(revise(employee(300_000), 300_000, 269_999)[0]?.health.diff).toBe(-2);
    expect(revise(employee(300_000), 300_000, 270_000)).toEqual([]);
  });
});

describe('境界値：最高・最低等級付近の特例（1等級の差でも候補になる場合）', () => {
  it('健康保険の49等級（133万円）の人：平均141.5万円以上なら候補、141万4,999円なら候補にならない', () => {
    const at = revise(employee(1_330_000, 650_000), 1_330_000, 1_415_000);
    expect(at[0]?.health.special).toBe(true);
    expect(at[0]?.expectedHealth).toBe(1_390_000);
    expect(revise(employee(1_330_000, 650_000), 1_330_000, 1_414_999).filter((c) => c.health.qualifies)).toEqual([]);
  });

  it('厚生年金の31等級（62万円）の人：平均66.5万円以上なら候補、66万4,999円なら候補にならない', () => {
    expect(revise(employee(620_000), 620_000, 665_000)[0]?.pension?.special).toBe(true);
    expect(revise(employee(620_000), 620_000, 664_999).filter((c) => c.pension?.qualifies)).toEqual([]);
  });

  it('健康保険の1等級（5.8万円）の人：決めたときの報酬が5.3万円未満で、平均6.3万円以上なら候補', () => {
    expect(revise(employee(58_000, 88_000, 52_999), 52_999, 63_000)[0]?.health.special).toBe(true);
    expect(revise(employee(58_000, 88_000, 52_999), 52_999, 62_999).filter((c) => c.health.qualifies)).toEqual([]);
    // 決めたときの報酬が5.3万円ちょうど（5.3万円未満ではない）なら、特例に当たらない
    expect(revise(employee(58_000, 88_000, 53_000), 53_000, 63_000).filter((c) => c.health.qualifies)).toEqual([]);
  });

  it('健康保険の2等級（6.8万円）の人：平均5.3万円未満に下がれば候補、5.3万円ちょうどなら候補にならない', () => {
    expect(revise(employee(68_000, 88_000), 68_000, 52_999)[0]?.health.special).toBe(true);
    expect(revise(employee(68_000, 88_000), 68_000, 53_000).filter((c) => c.health.qualifies)).toEqual([]);
  });
});

// ---- 保険料の端数処理：本人負担は50銭以下切り捨て、50銭超切り上げ ----
// 端数だけを確かめるため、標準報酬月額と料率は、本人負担が0.4995円・0.5円・0.5005円になる数にしている
describe('境界値：本人負担の端数処理（50銭以下切り捨て・50銭超切り上げ）', () => {
  it('0.4995円 → 0円、0.5円ちょうど → 0円（切り捨て）、0.5005円 → 1円（切り上げ）', () => {
    expect(calcPremium(999, 100, 500).employeeYen).toBe(0n); // 999円 × 0.1% × 1/2 = 0.4995円
    expect(calcPremium(1_000, 100, 500).employeeYen).toBe(0n); // 0.5円ちょうど
    expect(calcPremium(1_001, 100, 500).employeeYen).toBe(1n); // 0.5005円
  });

  it('会社負担は、全額から本人負担を引いた残り（50銭ちょうどなら会社が50銭多く負担する）', () => {
    const p = calcPremium(1_000, 100, 500); // 全額1円 = 100銭
    expect(p.fullSen).toBe(100n);
    expect(p.employerSen).toBe(100n);
  });
});

// ---- 追加テスト：健康保険と厚生年金の等級が切り替わる・上限に達する節目 ----

describe('境界値：健康保険と厚生年金の等級のズレや上限到達の節目', () => {
  it('厚生年金が適用され始める節目の境界（健康保険3等級と4等級の境目）', () => {
    // 8.3万円未満は健康保険のみ等級が上がり、厚生年金は1等級のまま[cite: 1]
    expect(suggest(82_999).healthGrade).toBe(3);
    expect(suggest(82_999).pensionGrade).toBe(1);
    
    // 8.3万円以上で健康保険は4等級、厚生年金も下限に達して1等級の範囲に入る[cite: 1]
    expect(suggest(83_000).healthGrade).toBe(4);
    expect(suggest(83_000).pensionGrade).toBe(1);
  });

  it('厚生年金が上限に達する節目の境界（健康保険35等級と36等級の境目）', () => {
    // 63.5万円以上で厚生年金は最高等級（32等級）に達する[cite: 1]
    expect(suggest(634_999).healthGrade).toBe(34);
    expect(suggest(634_999).pensionGrade).toBe(31);
    
    expect(suggest(635_000).healthGrade).toBe(35);
    expect(suggest(635_000).pensionGrade).toBe(32);
    
    // 66.5万円以上になっても、厚生年金は32等級で固定され、健康保険のみ36等級に上がる[cite: 1]
    expect(suggest(664_999).healthGrade).toBe(35);
    expect(suggest(664_999).pensionGrade).toBe(32);
    
    expect(suggest(665_000).healthGrade).toBe(36);
    expect(suggest(665_000).pensionGrade).toBe(32);
  });
});

// ---- 追加テスト：随時改定における1等級差（対象外）と3等級差以上 ----

describe('境界値：随時改定の1等級差（対象外）と3等級以上の差', () => {
  it('1等級しか変わらない場合は、改定の候補にならない', () => {
    // 30万円（22等級）の人[cite: 1] が、平均31万円（23等級の下限）になった場合（+1等級）
    expect(revise(employee(300_000), 300_000, 310_000)).toEqual([]);
    
    // 30万円（22等級）の人[cite: 1] が、平均28万円（21等級の範囲内）になった場合（-1等級）
    expect(revise(employee(300_000), 300_000, 280_000)).toEqual([]);
  });

  it('3等級以上の差がある場合は、正しく改定の候補になる', () => {
    // 30万円（22等級）の人が、平均35万円（25等級の下限）に上がった場合（+3等級）
    const up = revise(employee(300_000), 300_000, 350_000);
    expect(up[0]?.health.diff).toBe(3);
    
    // 30万円（22等級）の人が、平均24万9,999円（19等級の範囲内）に下がった場合（-3等級）
    // ※25万円ちょうどだと20等級の下限になり-2等級になってしまうため、24万9,999円以下にする
    const down = revise(employee(300_000), 300_000, 249_999);
    expect(down[0]?.health.diff).toBe(-3);
  });
});

// ---- 追加テスト：高額な報酬や極端な数値における端数処理 ----

describe('境界値：より大きな金額での保険料の端数処理', () => {
  it('100.5円ちょうど → 100円（切り捨て）、100.501円 → 101円（切り上げ）', () => {
    // 201,000円 × 0.1% × 1/2 = 100.5円（50銭以下切り捨て）[cite: 1]
    expect(calcPremium(201_000, 100, 500).employeeYen).toBe(100n);
    
    // 201,001円 × 0.1% × 1/2 = 100.5005円（50銭超切り上げ）[cite: 1]
    expect(calcPremium(201_001, 100, 500).employeeYen).toBe(101n);
  });

  it('会社負担は全額から本人負担を引いた残りになることの再確認（高額時）', () => {
    // 全額201円 = 20,100銭。本人負担100円（10,000銭）のため、会社負担は101円（10,100銭）になる[cite: 1]
    const p = calcPremium(201_000, 100, 500);
    expect(p.fullSen).toBe(20_100n);
    expect(p.employeeYen).toBe(100n);
    expect(p.employerSen).toBe(10_100n); 
  });
});

// ---- 追加テスト：介護保険料の対象年齢（40歳到達〜65歳到達）の境界 ----
// 公式ルール：
// ・「到達日」は誕生日の前日（年齢計算ニ関スル法律）。
// ・徴収開始：40歳到達日が属する月分から開始。
// ・徴収終了：65歳到達日が属する月の「前月」分まで（65歳到達月からは第1号被保険者となるため徴収しない）。

describe('境界値：介護保険の年齢判定（40歳〜65歳）', () => {
  it('40歳の徴収開始：1日生まれと2日生まれで、開始月が1ヶ月ずれる', () => {
    // 1986年5月2日生まれ（40歳到達日は 2026年5月1日）
    // -> 5月分から徴収開始
    expect(careStatus('1986-05-02', '2026-04')).toBe('none');
    expect(careStatus('1986-05-02', '2026-05')).toBe('second');

    // 1986年5月1日生まれ（40歳到達日は 2026年4月30日）
    // -> 4月分から前倒しで徴収開始
    expect(careStatus('1986-05-01', '2026-03')).toBe('none');
    expect(careStatus('1986-05-01', '2026-04')).toBe('second');
  });

  it('65歳の徴収終了：1日生まれと2日生まれで、終了月が1ヶ月ずれる', () => {
    // 1961年5月2日生まれ（65歳到達日は 2026年5月1日）
    // -> 5月分から第1号（介護保険料徴収なし）になる
    expect(careStatus('1961-05-02', '2026-04')).toBe('second');
    expect(careStatus('1961-05-02', '2026-05')).toBe('first');

    // 1961年5月1日生まれ（65歳到達日は 2026年4月30日）
    // -> 4月分から第1号（介護保険料徴収なし）になる
    expect(careStatus('1961-05-01', '2026-03')).toBe('second');
    expect(careStatus('1961-05-01', '2026-04')).toBe('first');
  });
});

// ---- 追加テスト：標準賞与額の端数処理と上限 ----
// 公式ルール：
// ・端数処理：1,000円未満切り捨て。
// ・厚生年金：1ヶ月あたり150万円が上限。
// ・健康保険：年度（4月1日〜翌年3月31日）累計で573万円が上限。

describe('境界値：標準賞与額（ボーナス）の端数処理と上限', () => {
  const bonus = new Bonus();

  it('端数処理：1,000円未満の端数は切り捨てる', () => {
    expect(bonus.calcStandardBonus(300_999)).toBe(300_000);
    expect(bonus.calcStandardBonus(301_000)).toBe(301_000);
  });

  it('厚生年金の上限：1ヶ月あたり150万円（支給月ごとの判定）', () => {
    // 150万999円（切り捨てで150万円）の場合は上限に引っかからずそのまま
    expect(bonus.adjustPensionMonthCap(1_500_999, 0)).toBe(1_500_000);
    
    // 150万1,000円からは150万円に丸められる
    expect(bonus.adjustPensionMonthCap(1_501_000, 0)).toBe(1_500_000);
    
    // いくら高くても150万円
    expect(bonus.adjustPensionMonthCap(10_000_000, 0)).toBe(1_500_000);
  });

  it('健康保険の上限：同一年度（4月〜翌3月）の累計573万円', () => {
    // 例：夏の賞与で 300万円 支給
    const summerBonus = 3_000_000;
    // これまでの累計が0円なので、そのまま300万円が標準賞与額
    expect(bonus.adjustHealthInsuranceCap(summerBonus, 0)).toBe(3_000_000);

    // 例：冬の賞与で さらに300万円 支給
    const winterBonus = 3_000_000;
    const accumulated = 3_000_000; // 夏の時点の累計額

    // 累計600万円になるが、上限573万円のため、
    // 冬の標準賞与額は 573万 - 300万(累計済) = 273万円 に調整される
    expect(bonus.adjustHealthInsuranceCap(winterBonus, accumulated)).toBe(2_730_000);

    // 例：年度末の決算賞与で 10万円 支給
    const springBonus = 100_000;
    const accumulatedMax = 5_730_000; // 冬の時点で既に上限到達済み

    // 既に上限に達しているため、決算賞与の標準賞与額は 0円 となる
    expect(bonus.adjustHealthInsuranceCap(springBonus, accumulatedMax)).toBe(0);
  });
});