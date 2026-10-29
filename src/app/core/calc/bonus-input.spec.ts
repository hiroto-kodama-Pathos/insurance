import { describe, expect, it } from 'vitest';
import { validateBonus } from './bonus-input';

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
