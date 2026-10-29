import { cashPaid, checkDeduction, payMonthFor, premiumMonthsFor } from './deduction';
import { SalaryRecord } from './salary';

const active = [{ acquiredDate: '2024-04-01', lostDate: null }];
// 10月31日に退職（資格喪失日は11月1日）
const retireOct = [{ acquiredDate: '2024-04-01', lostDate: '2026-11-01' }];
const pay = (paidDate: string, fixed: number, nonFixed = 0, inKind: number | null = null): SalaryRecord => ({
  id: paidDate, employeeId: 'e1', paidDate, fixedWages: fixed, nonFixedWages: nonFixed,
  paymentBaseDays: 30, retroactiveDiff: null, inKindWages: inKind,
});

describe('控除する給与の月', () => {
  it('翌月控除は翌月の給与、当月控除はその月の給与から控除する', () => {
    expect(payMonthFor('2026-10', 'nextMonth', active)).toBe('2026-11');
    expect(payMonthFor('2026-10', 'sameMonth', active)).toBe('2026-10');
    expect(premiumMonthsFor('2026-11', 'nextMonth', active)).toEqual(['2026-10']);
  });

  it('翌月控除で月末に退職する人は、退職月の最終給与で前月分と退職月分の2か月分を控除する', () => {
    expect(payMonthFor('2026-09', 'nextMonth', retireOct)).toBe('2026-10');
    expect(payMonthFor('2026-10', 'nextMonth', retireOct)).toBe('2026-10');
    expect(premiumMonthsFor('2026-10', 'nextMonth', retireOct)).toEqual(['2026-09', '2026-10']);
  });
});

describe('checkDeduction', () => {
  const premium = () => 40_000;

  it('同じ月の支払いを合計し、現物給与を除いた額と比べる', () => {
    expect(cashPaid([pay('2026-11-10', 100_000), pay('2026-11-25', 100_000, 10_000, 30_000)], 'e1', '2026-11')).toBe(180_000);
    expect(checkDeduction('e1', active, '2026-11', 'nextMonth', [pay('2026-11-25', 300_000)], premium).status).toBe('ok');
  });

  it('設計書の例：10月から無給の休職。11月の給与0円で「控除不足：4万円」', () => {
    const c = checkDeduction('e1', active, '2026-11', 'nextMonth', [pay('2026-11-25', 0)], premium);
    expect(c.status).toBe('shortage');
    expect(c.shortage).toBe(40_000);
  });

  it('保険料が給与の60%を超えると注意、給与がなければ給与未入力、保険料がなければ判定しない', () => {
    expect(checkDeduction('e1', active, '2026-11', 'nextMonth', [pay('2026-11-25', 60_000)], premium).status).toBe('caution');
    expect(checkDeduction('e1', active, '2026-11', 'nextMonth', [], premium).status).toBe('notEntered');
    expect(checkDeduction('e1', active, '2026-11', 'nextMonth', [], () => 0).status).toBe('none');
  });

  it('月末退職の最終給与は2か月分の保険料と比べる', () => {
    const c = checkDeduction('e1', retireOct, '2026-10', 'nextMonth', [pay('2026-10-25', 70_000)], premium);
    expect(c.premium).toBe(80_000);
    expect(c.status).toBe('shortage');
    expect(c.shortage).toBe(10_000);
  });

  it('さかのぼる差額を精算する給与では、その差額も含めて比べる', () => {
    const c = checkDeduction('e1', active, '2026-11', 'nextMonth', [pay('2026-11-25', 50_000)], premium, 15_000);
    expect(c.premium).toBe(55_000);
    expect(c.status).toBe('shortage');
  });
});
