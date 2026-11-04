import { describe, expect, it } from 'vitest';
import { bonusReportAmounts, validateBonus } from './bonus-input';

describe('validateBonus', () => {
  it('正しい入力', () => {
    expect(validateBonus({ employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000 })).toEqual({});
  });
  it('未入力・形の誤り', () => {
    expect(Object.keys(validateBonus({ employeeId: '', paidDate: '2026-13-01', amount: null })).sort()).toEqual([
      'amount',
      'employeeId',
      'paidDate',
    ]);
    expect(validateBonus({ employeeId: 'e1', paidDate: '2026-12-10', amount: 1.5 })).toHaveProperty('amount');
  });
});

describe('うち現物と届け出る賞与額', () => {
  it('うち現物は0円以上で、賞与額の内数', () => {
    expect(validateBonus({ employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000, inKindAmount: 50_000 })).toEqual({});
    expect(validateBonus({ employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000, inKindAmount: 600_000 }).inKindAmount).toContain('内数');
    expect(validateBonus({ employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000, inKindAmount: -1 })).toHaveProperty('inKindAmount');
  });

  it('同じ月に同じ人へ2回以上支払った賞与は合算し、1,000円未満を切り捨てる（通貨・現物を分けて出す）', () => {
    const a = bonusReportAmounts([
      { employeeId: 'e1', paidDate: '2026-12-25', amount: 200_500, inKindAmount: 20_000 },
      { employeeId: 'e1', paidDate: '2026-12-10', amount: 300_300 },
      { employeeId: 'e2', paidDate: '2026-12-10', amount: 400_999 },
      { employeeId: 'e1', paidDate: '2027-01-10', amount: 100_000 },
    ]);
    expect(a).toEqual([
      { employeeId: 'e1', yearMonth: '2026-12', paidDates: ['2026-12-10', '2026-12-25'], cash: 480_800, inKind: 20_000, total: 500_000 },
      { employeeId: 'e2', yearMonth: '2026-12', paidDates: ['2026-12-10'], cash: 400_999, inKind: 0, total: 400_000 },
      { employeeId: 'e1', yearMonth: '2027-01', paidDates: ['2027-01-10'], cash: 100_000, inKind: 0, total: 100_000 },
    ]);
  });
});
