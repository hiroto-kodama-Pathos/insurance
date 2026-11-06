import { buildKyokaiGrades, gradeTableAt, standardGradeError, suggestStandards } from './grade-suggest';

const grades = buildKyokaiGrades('2020-09');

describe('報酬月額からの標準報酬月額の提案', () => {
  it('等級表は健康保険50等級・厚生年金32等級', () => {
    expect(grades.length).toBe(50);
    expect(grades.filter((g) => g.pensionGrade !== null).length).toBe(32);
  });

  it('下限ちょうどは上の等級（29万円 → 30万円・22等級）', () => {
    const s = suggestStandards(290_000, grades, '2026-10', '1990-01-01');
    expect(s?.healthGrade).toBe(22);
    expect(s?.healthStandard).toBe(300_000);
    expect(s?.pensionGrade).toBe(19);
    expect(s?.pensionStandard).toBe(300_000);
  });

  it('上限の1円手前は下の等級（28万9,999円 → 28万円）', () => {
    expect(suggestStandards(289_999, grades, '2026-10', '1990-01-01')?.healthStandard).toBe(280_000);
  });

  it('厚生年金の範囲より低い人は、厚生年金だけ最下位の8.8万円', () => {
    const s = suggestStandards(80_000, grades, '2026-10', '1990-01-01');
    expect(s?.healthStandard).toBe(78_000);
    expect(s?.pensionStandard).toBe(88_000);
    expect(s?.pensionGrade).toBe(1);
  });

  it('厚生年金の範囲より高い人は、厚生年金だけ最上位の65万円', () => {
    const s = suggestStandards(700_000, grades, '2026-10', '1990-01-01');
    expect(s?.healthStandard).toBe(710_000);
    expect(s?.pensionStandard).toBe(650_000);
    expect(s?.pensionGrade).toBe(32);
  });

  it('70歳以上は、厚生年金の欄を相当額として提案する', () => {
    expect(suggestStandards(300_000, grades, '2026-10', '1955-01-10')?.pensionIsEquivalent).toBe(true);
    expect(suggestStandards(300_000, grades, '2026-10', '1990-01-10')?.pensionIsEquivalent).toBe(false);
  });

  it('対象月に有効な等級表がなければ null', () => {
    expect(suggestStandards(300_000, grades, '2019-01', '1990-01-01')).toBeNull();
  });

  it('等級表が改定されたら、新しい表を使う', () => {
    const newer = buildKyokaiGrades('2027-09').map((g) =>
      g.healthGrade === 22 ? { ...g, standardAmount: 999_000 } : g,
    );
    expect(suggestStandards(300_000, [...grades, ...newer], '2027-08', '1990-01-01')?.healthStandard).toBe(300_000);
    expect(suggestStandards(300_000, [...grades, ...newer], '2027-09', '1990-01-01')?.healthStandard).toBe(999_000);
  });
});

describe('標準報酬月額が等級の額かのチェック', () => {
  it('健康保険：等級表にない額（299,000円など）は、近い等級を添えてエラー', () => {
    const e = standardGradeError(grades, '2026-10', 'health', 299_000);
    expect(e).toContain('299,000円は健康保険の等級の額ではありません');
    expect(e).toContain('28万円（21等級）・30万円（22等級）');
    expect(standardGradeError(grades, '2026-10', 'health', 300_000)).toBeNull();
    // 健康保険の上限・下限（139万円・5.8万円）は等級の額
    expect(standardGradeError(grades, '2026-10', 'health', 1_390_000)).toBeNull();
    expect(standardGradeError(grades, '2026-10', 'health', 58_000)).toBeNull();
    expect(standardGradeError(grades, '2026-10', 'health', 1_400_000)).toContain('139万円（50等級）');
  });

  it('厚生年金：等級の範囲（8.8万円〜65万円）の外の額はエラー', () => {
    expect(standardGradeError(grades, '2026-10', 'pension', 650_000)).toBeNull();
    expect(standardGradeError(grades, '2026-10', 'pension', 88_000)).toBeNull();
    expect(standardGradeError(grades, '2026-10', 'pension', 1_390_000)).toContain('厚生年金');
    expect(standardGradeError(grades, '2026-10', 'pension', 58_000)).toContain('8.8万円（1等級）');
  });

  it('その月に使える等級表がない（マスタの不足・読み込めなかった）ときは、確かめずに通さず、登録できない文を返す。適用開始月で表を選ぶ', () => {
    // 等級表を読み込めなかった（空）：等級の額でも通さない
    expect(standardGradeError([], '2026-10', 'health', 300_000)).toContain('2026年10月に使える等級表が登録されていないため、登録できません');
    // 等級表より前の月（等級表は2020年9月から）
    expect(standardGradeError(grades, '2019-10', 'health', 300_000)).toContain('2019年10月に使える等級表が登録されていない');
    // null は確かめない（等級表を使わない呼び出し）
    expect(standardGradeError(null, '2026-10', 'health', 299_000)).toBeNull();
    expect(gradeTableAt(grades, '2026-10').length).toBe(50);
  });

  describe('エッジケース：標準報酬月額が等級表に存在しない', () => {
    it('等級表に存在しない金額は登録を拒否し、近い等級を提案', () => {
      const error = standardGradeError(grades, '2026-10', 'health', 299_000);
      expect(error).toContain('299,000円は健康保険の等級の額ではありません');
      expect(error).toContain('28万円（21等級）');
      expect(error).toContain('30万円（22等級）');
    });

    it('等級の下限ちょうどは許可される', () => {
      // 健康保険の下限は5.8万円
      expect(standardGradeError(grades, '2026-10', 'health', 58_000)).toBeNull();
    });

    it('等級の上限を超える金額は拒否される', () => {
      // 健康保険の上限は139万円
      const error = standardGradeError(grades, '2026-10', 'health', 1_400_000);
      expect(error).toContain('139万円（50等級）');
    });

    it('厚生年金の範囲外は拒否される', () => {
      // 厚生年金：8.8万円〜65万円
      const errorLow = standardGradeError(grades, '2026-10', 'pension', 80_000);
      const errorHigh = standardGradeError(grades, '2026-10', 'pension', 660_000);
      expect(errorLow).toContain('8.8万円');
      expect(errorHigh).toContain('65万円');
    });

    it('等級表改定後は新しい等級で提案', () => {
      const newGrades = buildKyokaiGrades('2027-09');
      expect(newGrades.length).toBeGreaterThan(0);
      // 適用開始月が異なる等級表を使う
      const suggestion = suggestStandards(300_000, newGrades, '2027-09', '1990-01-01');
      expect(suggestion?.healthStandard).toBe(300_000);
    });

    it('適用開始月より前の等級表は使わない', () => {
      // 2020年9月の等級表で2019年10月の計算をしてはいけない
      const result = suggestStandards(300_000, grades, '2019-10', '1990-01-01');
      expect(result).toBeNull();
    });

    it('計算に必要な等級表が欠落していると、誤った金額で確定させない', () => {
      const emptyGrades: typeof grades = [];
      const error = standardGradeError(emptyGrades, '2026-10', 'health', 300_000);
      expect(error).toContain('登録されていないため、登録できません');
    });
  });
});
