import {
  checkPayrollAssignment, checkPayrollGroup, cutoffOf, cutoffResolver, defaultGroup, groupLabel,
  legacyGroup, PayrollGroup, payDateOf, payrollGroupAt,
} from './payroll-group';
import { DEFAULT_SETTINGS } from './settings';

const monthly: PayrollGroup = { id: 'g1', name: '月給者', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: true };
const part: PayrollGroup = { id: 'g2', name: 'パート', cutoffDay: 15, paidIn: 'sameMonth', deductionTiming: 'sameMonth', payDay: 'end' };
const groups = [part, monthly];

describe('支払区分', () => {
  it('区分を登録していない会社は、会社の設定を既定の区分として使う', () => {
    const g = legacyGroup(DEFAULT_SETTINGS);
    expect(g.isDefault).toBe(true);
    expect(cutoffOf(g)).toEqual(DEFAULT_SETTINGS.payrollCutoff);
    expect(g.deductionTiming).toBe(DEFAULT_SETTINGS.deductionTiming);
  });

  it('既定の区分は isDefault の区分（なければ最初の区分）', () => {
    expect(defaultGroup(groups).id).toBe('g1');
    expect(defaultGroup([part]).id).toBe('g2');
  });

  it('その日の区分は、その日までに始まった最新の履歴で決まる（履歴がなければ既定の区分）', () => {
    const history = [{ validFrom: '2026-10-01', payrollGroupId: 'g2' }];
    expect(payrollGroupAt(groups, undefined, '2026-10-15').id).toBe('g1');
    expect(payrollGroupAt(groups, history, '2026-09-30').id).toBe('g1');
    expect(payrollGroupAt(groups, history, '2026-10-01').id).toBe('g2');
    expect(payrollGroupAt(groups, [{ validFrom: '2026-01-01', payrollGroupId: 'deleted' }], '2026-10-01').id).toBe('g1');
  });

  it('支払日は支払月の支払日（末日・月の日数を超える日は月末）', () => {
    expect(payDateOf(monthly, '2026-10')).toBe('2026-10-25');
    expect(payDateOf(part, '2026-02')).toBe('2026-02-28');
    expect(payDateOf({ ...monthly, payDay: 30 }, '2026-02')).toBe('2026-02-28');
  });

  it('人と支払月ごとに締め日を返す', () => {
    const resolve = cutoffResolver(groups, [{ id: 'e1', payrollAssignments: [{ validFrom: '2026-10-01', payrollGroupId: 'g2' }] }, { id: 'e2' }]);
    expect(resolve('e1', '2026-09')).toEqual({ day: 'end', paidIn: 'nextMonth' });
    expect(resolve('e1', '2026-10')).toEqual({ day: 15, paidIn: 'sameMonth' });
    expect(resolve('e2', '2026-10')).toEqual({ day: 'end', paidIn: 'nextMonth' });
  });

  it('表示用の説明', () => {
    expect(groupLabel(monthly)).toBe('末日締め・翌月25日払・翌月控除');
    expect(groupLabel(part)).toBe('15日締め・当月末日払・当月控除');
  });

  it('区分の入力チェック', () => {
    const { id: _, ...input } = monthly;
    expect(checkPayrollGroup(input, [])).toEqual({});
    expect(checkPayrollGroup({ ...input, name: ' ' }, []).name).toBeTruthy();
    expect(checkPayrollGroup(input, ['月給者']).name).toBeTruthy();
    expect(checkPayrollGroup({ ...input, cutoffDay: 31 }, []).cutoffDay).toBeTruthy();
    expect(checkPayrollGroup({ ...input, payDay: 0 }, []).payDay).toBeTruthy();
  });

  it('区分の変更の入力チェック', () => {
    const existing = [{ validFrom: '2026-10-01', payrollGroupId: 'g2' }];
    expect(checkPayrollAssignment(existing, '2026-11-01', 'g1', 'g2')).toEqual({});
    expect(checkPayrollAssignment(existing, '2026-13-01', 'g1', 'g2')['payrollDate']).toBeTruthy();
    expect(checkPayrollAssignment(existing, '2026-10-01', 'g1', 'g2')['payrollDate']).toBeTruthy();
    expect(checkPayrollAssignment(existing, '2026-11-01', 'g2', 'g2')['payrollDate']).toBeTruthy();
  });
});
