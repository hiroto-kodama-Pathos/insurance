import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import { checkDependent, checkRemoval, dependentReportDeadline, isDependentInMonth, isSpecialInsuredMonth } from './dependent';

const kumiai = { id: 'k1', type: 'kumiai' as const, name: '〇〇健康保険組合', specialInsuredEnabled: true };
// 妻：1980年5月10日生まれ（2020年5月に40歳、2045年5月に65歳）
const wife = { name: '山田 花子', birthDate: '1980-05-10', certifiedDate: '2024-04-01', removedDate: null };

describe('被扶養者', () => {
  it('認定日の月から扶養に入り、外れた日の月から外れる', () => {
    const d = { ...wife, certifiedDate: '2026-04-15', removedDate: '2026-09-10' };
    expect(isDependentInMonth(d, '2026-03')).toBe(false);
    expect(isDependentInMonth(d, '2026-04')).toBe(true);
    expect(isDependentInMonth(d, '2026-08')).toBe(true);
    expect(isDependentInMonth(d, '2026-09')).toBe(false);
  });

  it('特定被保険者：制度のある組合健保で、40〜64歳の被扶養者がいる月だけ', () => {
    expect(isSpecialInsuredMonth(kumiai, [wife], '2026-10')).toBe(true);
    expect(isSpecialInsuredMonth({ ...kumiai, specialInsuredEnabled: false }, [wife], '2026-10')).toBe(false);
    expect(isSpecialInsuredMonth({ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }, [wife], '2026-10')).toBe(false);
    // 39歳の被扶養者は対象外。40歳になる月（年齢到達日の月）から対象
    const young = { ...wife, birthDate: '1986-11-01' }; // 年齢到達日は 2026-10-31
    expect(isSpecialInsuredMonth(kumiai, [young], '2026-09')).toBe(false);
    expect(isSpecialInsuredMonth(kumiai, [young], '2026-10')).toBe(true);
  });

  it('入力チェックと被扶養者異動届の期限（5日以内）', () => {
    expect(checkDependent({ name: '', birthDate: '2026-02-30', certifiedDate: '' })).toEqual({
      name: '氏名を入力してください',
      birthDate: '生年月日を正しく入力してください',
      certifiedDate: '扶養に入った日を正しく入力してください',
    });
    expect(checkRemoval(wife, '2024-04-01').removedDate).toContain('より後');
    expect(dependentReportDeadline('2026-10-29')).toBe('2026-11-03');
  });
});

describe('特定被保険者の介護保険料（月額の計算）', () => {
  const masters: Masters = {
    offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'k1' }],
    insurers: [kumiai],
    insurerRates: [
      { insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9000, employeeShare: 450 },
      { insurerId: 'k1', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1600, employeeShare: 500 },
      { insurerId: 'k1', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
    ],
    pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
  };
  // 本人は35歳（介護保険の第2号ではない）
  const me = (dependents = [wife]): EmployeeData => ({
    id: 'e1', birthDate: '1991-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [], exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
    dependents,
  });

  it('40〜64歳の被扶養者がいれば、本人が40歳未満でも介護保険料がかかる', () => {
    const r = calcEmployeeMonth(me(), masters, '2026-10');
    expect(r.premium!.careLabel).toBe('special');
    expect(r.premium!.care!.employeeYen).toBe(2_400n); // 300,000 × 1.6% × 50%
    const none = calcEmployeeMonth(me([]), masters, '2026-10');
    expect(none.premium!.care).toBeNull();
  });
});
