import { detectFixedWageChanges, detectRetroactivePossibilities, payMonths, SalaryRecord, validateSalary } from './salary';

const s = (paidDate: string, fixed: number, nonFixed = 0, days = 30, retro: number | null = null): SalaryRecord => ({
  id: paidDate, employeeId: 'e1', paidDate, fixedWages: fixed, nonFixedWages: nonFixed,
  paymentBaseDays: days, retroactiveDiff: retro, inKindWages: null,
});

describe('payMonths・detectFixedWageChanges', () => {
  it('同じ月に2回払った給与は合算する', () => {
    const m = payMonths([s('2026-08-10', 100_000, 0, 15), s('2026-08-25', 100_000, 5_000, 16)]);
    expect(m).toEqual([{ yearMonth: '2026-08', fixed: 200_000, nonFixed: 5_000, retroactive: 0, days: 31, total: 205_000, inKind: 0, hourlyRate: null, excluded: 0 }]);
  });

  it('固定的賃金が前月から変わった月と向きを出す（遡及差額は除く）', () => {
    const m = payMonths([s('2026-07-25', 300_000), s('2026-08-25', 300_000, 50_000), s('2026-09-25', 380_000, 0, 30, 50_000), s('2026-10-25', 330_000)]);
    expect(detectFixedWageChanges(m)).toEqual([{ yearMonth: '2026-09', direction: 'up', before: 300_000, after: 330_000, basis: 'amount' }]);
  });

  it('前月の給与がない月は変動と判定しない', () => {
    expect(detectFixedWageChanges(payMonths([s('2026-07-25', 300_000), s('2026-09-25', 330_000)]))).toEqual([]);
  });
});

describe('時給単価・担当者が登録した変動・遡及の可能性', () => {
  const h = (paidDate: string, hours: number, rate: number): SalaryRecord => ({
    id: paidDate, employeeId: 'e1', paidDate, fixedWages: hours * rate, nonFixedWages: 0, paymentBaseDays: 20,
    retroactiveDiff: null, inKindWages: null, hourlyRate: rate,
  });

  it('時給の人は、労働時間で額が変わっただけの月は変動にせず、単価が変わった月を変動にする', () => {
    const m = payMonths([h('2026-07-25', 100, 1100), h('2026-08-25', 120, 1100), h('2026-09-25', 110, 1200)]);
    expect(detectFixedWageChanges(m)).toEqual([{ yearMonth: '2026-09', direction: 'up', before: 1100, after: 1200, basis: 'hourlyRate' }]);
  });

  it('担当者が登録した変動は、額が変わっていなくても変動月にする（同じ月の自動の判定より優先）', () => {
    const m = payMonths([h('2026-07-25', 100, 1100), h('2026-08-25', 100, 1100)]);
    expect(detectFixedWageChanges(m, [{ yearMonth: '2026-08', direction: 'down', note: '所定労働時間の短縮' }])).toEqual([
      { yearMonth: '2026-08', direction: 'down', before: 110_000, after: 110_000, basis: 'manual', note: '所定労働時間の短縮' },
    ]);
  });

  it('現物給与の価額を月ごとに合計する', () => {
    const m = payMonths([{ ...h('2026-07-25', 100, 1100), inKindWages: 20_000 }]);
    expect(m[0].inKind).toBe(20_000);
    expect(m[0].hourlyRate).toBe(1100);
  });

  it('遡及差額を入れずに、上がって翌月少し下がった月を「遡及の可能性」にする', () => {
    const s = (paidDate: string, fixed: number, retro: number | null = null): SalaryRecord => ({
      id: paidDate, employeeId: 'e1', paidDate, fixedWages: fixed, nonFixedWages: 0, paymentBaseDays: 30, retroactiveDiff: retro, inKindWages: null,
    });
    // 28万 → 43万（33万＋2か月分の差額）→ 33万
    const m = payMonths([s('2026-09-25', 280_000), s('2026-10-25', 430_000), s('2026-11-25', 330_000)]);
    expect(detectRetroactivePossibilities(m)).toEqual([{ yearMonth: '2026-10', before: 280_000, paid: 430_000, after: 330_000 }]);
    // 遡及差額を入れていれば出さない
    expect(detectRetroactivePossibilities(payMonths([s('2026-09-25', 280_000), s('2026-10-25', 430_000, 100_000), s('2026-11-25', 330_000)]))).toEqual([]);
    // 一時的に上がっただけ（翌月は元に戻った）は出さない
    expect(detectRetroactivePossibilities(payMonths([s('2026-09-25', 280_000), s('2026-10-25', 300_000), s('2026-11-25', 280_000)]))).toEqual([]);
  });
});

describe('validateSalary', () => {
  const ok = { paidDate: '2026-10-25', fixedWages: 300_000, nonFixedWages: 0, paymentBaseDays: 31, retroactiveDiff: null, inKindWages: null };
  it('正しい入力はエラーなし', () => expect(validateSalary(ok)).toEqual({}));
  it('必須・範囲・内数をチェックする', () => {
    const e = validateSalary({ paidDate: '2026-02-30', fixedWages: null, nonFixedWages: -1, paymentBaseDays: 32, retroactiveDiff: null, inKindWages: null });
    expect(Object.keys(e).sort()).toEqual(['fixedWages', 'nonFixedWages', 'paidDate', 'paymentBaseDays']);
    expect(validateSalary({ ...ok, retroactiveDiff: 400_000 }).retroactiveDiff).toContain('内数');
    expect(validateSalary({ ...ok, inKindWages: 400_000 }).inKindWages).toContain('内数');
  });
  it('時給単価は空欄か1円以上の円', () => {
    expect(validateSalary({ ...ok, hourlyRate: 1200 })).toEqual({});
    expect(validateSalary({ ...ok, hourlyRate: 0 }).hourlyRate).toBeDefined();
  });
  it('労働時間は空欄か0〜744時間（小数第1位まで）', () => {
    expect(validateSalary({ ...ok, workingHours: 86.5 })).toEqual({});
    expect(validateSalary({ ...ok, workingHours: null })).toEqual({});
    expect(validateSalary({ ...ok, workingHours: 745 }).workingHours).toBeDefined();
    expect(validateSalary({ ...ok, workingHours: 86.25 }).workingHours).toBeDefined();
  });
});
