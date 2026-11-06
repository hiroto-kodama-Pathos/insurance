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

  it('その月の等級表がなければ確かめない。適用開始月で表を選ぶ', () => {
    expect(standardGradeError([], '2026-10', 'health', 299_000)).toBeNull();
    expect(standardGradeError(grades, '2019-10', 'health', 299_000)).toBeNull();
    expect(gradeTableAt(grades, '2026-10').length).toBe(50);
  });
});
