import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import { checkDependent, checkDependentCareExemption, checkRemoval, dependentOut, dependentReportDeadline, isDependentInMonth, isSpecialInsuredMonth, isValidDependent } from './dependent';

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

  it('75歳の誕生日に扶養から外れる（外れた日を登録していなくても、誕生日の月から外れる）', () => {
    const mother = { name: '山田 キヨ', birthDate: '1951-11-15', certifiedDate: '2020-04-01', removedDate: null };
    expect(dependentOut(mother)).toEqual({ date: '2026-11-15', reason: 'age75' });
    expect(isDependentInMonth(mother, '2026-10')).toBe(true);
    expect(isDependentInMonth(mother, '2026-11')).toBe(false);
    // 75歳より前に外れた日を登録していれば、その日
    expect(dependentOut({ ...mother, removedDate: '2026-06-30' })).toEqual({ date: '2026-06-30', reason: 'removed' });
    // 75歳より後の日を登録していても、75歳の誕生日に外れる
    expect(dependentOut({ ...mother, removedDate: '2027-01-01' })).toEqual({ date: '2026-11-15', reason: 'age75' });
    expect(isDependentInMonth({ ...mother, removedDate: '2027-01-01' }, '2026-12')).toBe(false);
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

describe('被扶養者の入力チェック：75歳以上', () => {
  it('扶養に入る日に75歳以上なら登録できない（75歳の誕生日の前日までは登録できる）', () => {
    expect(checkDependent({ name: '父', birthDate: '1951-11-02', certifiedDate: '2026-11-02' }).birthDate).toContain('75歳以上');
    expect(checkDependent({ name: '父', birthDate: '1951-11-02', certifiedDate: '2026-11-01' })).toEqual({});
  });
});

describe('被扶養者のありえない入力・壊れたデータ', () => {
  const T = '2026-11-06';
  const D = (name: string, birthDate: string, certifiedDate: string) => ({ name, birthDate, certifiedDate });
  const ctx = {
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    self: { name: '山田 太郎', birthDate: '1980-05-10' },
    others: [{ name: '山田 花子', birthDate: '1990-01-01' }],
  };
  const dep = { name: '山田 花子', birthDate: '1990-01-01', certifiedDate: '2024-04-01', removedDate: null };

  it('扶養に入った日に本人の資格がない・本人と同じ人・二重登録・1年以上先は止める', () => {
    expect(checkDependent(D('a', '2010-01-01', '2020-04-01'), T, ctx).certifiedDate).toContain('本人の社会保険の資格がありません');
    expect(checkDependent(D('山田太郎', '1980-05-10', '2024-04-01'), T, ctx).name).toContain('本人を被扶養者にはできません');
    expect(checkDependent(D('山田　花子', '1990-01-01', '2025-04-01'), T, ctx).name).toContain('すでに被扶養者として登録されています');
    expect(checkDependent(D('a', '2010-01-01', '2028-04-01'), T, ctx).certifiedDate).toContain('1年以上先');
    // 2099年は75歳の文ではなく、年の誤りとして出す
    const far = checkDependent(D('a', '2010-01-01', '2099-04-01'), T, ctx);
    expect(far.certifiedDate).toContain('1年以上先');
    expect(far.birthDate).toBeUndefined();
    expect(checkDependent(D('山田 一郎', '2015-01-01', '2024-04-01'), T, ctx)).toEqual({});
  });

  it('外れた日：1年以上先・75歳の誕生日より後は止める（誕生日ちょうどは入れられる）', () => {
    expect(checkRemoval(dep, '2030-04-01', T).removedDate).toContain('1年以上先');
    const old = { ...dep, birthDate: '1950-01-01' };
    expect(checkRemoval(old, '2026-01-01', T).removedDate).toContain('75歳の誕生日（2025年1月1日）に扶養から外れています');
    expect(checkRemoval(old, '2025-01-01', T)).toEqual({});
  });

  it('介護保険の適用除外：扶養の期間の中・40〜64歳の月だけ。1年以上先は止める', () => {
    expect(checkDependentCareExemption(dep, { startDate: '2020-01-01', endDate: '' }, null, T).startDate).toContain('扶養に入った日');
    expect(checkDependentCareExemption({ ...dep, removedDate: '2025-04-01' }, { startDate: '2026-01-01', endDate: '' }, null, T).startDate).toContain('扶養から外れた日');
    expect(checkDependentCareExemption({ ...dep, birthDate: '2015-01-01' }, { startDate: '2026-01-01', endDate: '' }, null, T).startDate).toContain('40歳になっていない');
    expect(checkDependentCareExemption({ ...dep, birthDate: '1955-01-01' }, { startDate: '2026-01-01', endDate: '' }, null, T).startDate).toContain('65歳以上');
    expect(checkDependentCareExemption({ ...dep, birthDate: '1980-01-01' }, { startDate: '2099-01-01', endDate: '' }, null, T).startDate).toContain('1年以上先');
    expect(checkDependentCareExemption({ ...dep, birthDate: '1980-01-01' }, { startDate: '2026-01-01', endDate: '' }, null, T)).toEqual({});
  });

  it('壊れたデータは計算に使うデータとしない。特定被保険者の判定も止まらない', () => {
    expect(isValidDependent(dep)).toBe(true);
    expect(isValidDependent({ ...dep, removedDate: '2024-04-01' })).toBe(true); // 資格を失った日に一緒に外れる
    expect(isValidDependent({ ...dep, certifiedDate: undefined })).toBe(false);
    expect(isValidDependent({ ...dep, birthDate: undefined })).toBe(false);
    expect(isValidDependent({ ...dep, name: ' ' })).toBe(false);
    expect(isValidDependent({ ...dep, removedDate: '2024-01-01' })).toBe(false);
    expect(isValidDependent({ ...dep, careExemptions: 'x' })).toBe(false);
    expect(isValidDependent({ ...dep, careExemptions: [{ startDate: '2026-02-30', endDate: null }] })).toBe(false);
    expect(isSpecialInsuredMonth(kumiai, [{ ...dep, birthDate: undefined as unknown as string }], '2026-05')).toBe(false);
  });
});
