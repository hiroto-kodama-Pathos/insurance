import { calcEmployeeMonth, Masters } from './employee-month';
import { isSameMonth, pendingRefunds, sameMonthCases } from './same-month';

describe('同月得喪', () => {
  it('資格取得日と資格喪失日が同じ月なら同月得喪', () => {
    // 10月5日入社、10月20日退職（10月21日喪失）
    const q = { acquiredDate: '2026-10-05', lostDate: '2026-10-21' };
    expect(isSameMonth(q, [q])).toBe(true);
    // 10月31日退職（11月1日喪失）は同月得喪ではない
    const end = { acquiredDate: '2026-10-05', lostDate: '2026-11-01' };
    expect(isSameMonth(end, [end])).toBe(false);
    const active = { acquiredDate: '2026-10-05', lostDate: null };
    expect(isSameMonth(active, [active])).toBe(false);
  });

  it('継続再雇用（同日得喪）は対象にしない', () => {
    const before = { acquiredDate: '2026-10-01', lostDate: '2026-10-16', lostReason: 'reemployment' };
    const after = { acquiredDate: '2026-10-16', lostDate: null };
    expect(isSameMonth(before, [before, after])).toBe(false);
    // 理由を登録していなくても、喪失日に次の資格を取っていれば資格は途切れない
    const noReason = { acquiredDate: '2026-10-01', lostDate: '2026-10-16' };
    expect(isSameMonth(noReason, [noReason, after])).toBe(false);
  });

  it('還付の状態は、未設定なら還付待ち', () => {
    const list = sameMonthCases([
      { acquiredDate: '2025-04-10', lostDate: '2025-04-16', refundStatus: 'returned' as const },
      { acquiredDate: '2026-10-05', lostDate: '2026-10-21' },
    ]);
    expect(list.map((c) => [c.yearMonth, c.status])).toEqual([['2026-10', 'pending'], ['2025-04', 'returned']]);
  });

  it('要確認には還付待ちだけを出す', () => {
    const employees = [
      { id: 'b', employeeNumber: '0002', qualifications: [{ acquiredDate: '2026-10-05', lostDate: '2026-10-21' }] },
      { id: 'a', employeeNumber: '0001', qualifications: [{ acquiredDate: '2026-09-01', lostDate: '2026-09-11', refundStatus: 'none' as const }] },
      { id: 'c', employeeNumber: '0003', qualifications: [{ acquiredDate: '2026-08-03', lostDate: '2026-08-29' }] },
    ];
    expect(pendingRefunds(employees).map((x) => x.employee.id)).toEqual(['b', 'c']);
  });

  it('同月得喪の月は、その月の保険料がかかる', () => {
    const masters: Masters = {
      offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
      insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
      insurerRates: [
        { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
        { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
      ],
      pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
    };
    const e = {
      id: 'e1',
      birthDate: '1990-01-01',
      qualifications: [{ acquiredDate: '2026-10-05', lostDate: '2026-10-21' }],
      leaves: [], exemptions: [],
      assignments: [{ validFrom: '2026-10-05', officeId: 'honsha' }],
      standardHistory: [{ validFrom: '2026-10', healthStandard: 300_000, pensionStandard: 300_000 }],
    };
    expect(calcEmployeeMonth(e, masters, '2026-10', 'combined').status).toBe('ok');
    expect(calcEmployeeMonth(e, masters, '2026-11', 'combined').status).toBe('notInsured');
  });
});
