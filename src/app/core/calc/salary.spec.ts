import { detectFixedWageChanges, payMonths, SalaryRecord, validateSalary } from './salary';

const s = (paidDate: string, fixed: number, nonFixed = 0, days = 30, retro: number | null = null): SalaryRecord => ({
  id: paidDate, employeeId: 'e1', paidDate, fixedWages: fixed, nonFixedWages: nonFixed,
  paymentBaseDays: days, retroactiveDiff: retro, inKindWages: null,
});

describe('payMonths・detectFixedWageChanges', () => {
  it('同じ月に2回払った給与は合算する', () => {
    const m = payMonths([s('2026-08-10', 100_000, 0, 15), s('2026-08-25', 100_000, 5_000, 16)]);
    expect(m).toEqual([{ yearMonth: '2026-08', fixed: 200_000, nonFixed: 5_000, retroactive: 0, days: 31, total: 205_000 }]);
  });

  it('固定的賃金が前月から変わった月と向きを出す（遡及差額は除く）', () => {
    const m = payMonths([s('2026-07-25', 300_000), s('2026-08-25', 300_000, 50_000), s('2026-09-25', 380_000, 0, 30, 50_000), s('2026-10-25', 330_000)]);
    expect(detectFixedWageChanges(m)).toEqual([{ yearMonth: '2026-09', direction: 'up', before: 300_000, after: 330_000 }]);
  });

  it('前月の給与がない月は変動と判定しない', () => {
    expect(detectFixedWageChanges(payMonths([s('2026-07-25', 300_000), s('2026-09-25', 330_000)]))).toEqual([]);
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
});
