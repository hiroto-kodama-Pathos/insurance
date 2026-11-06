import { exemptedInsurances, exemptingLeave, isInsuredInMonth, isLeaveExemptMonth, isValidLeave, leaveExemptLabel, leaveFilingId, nextDay } from './eligibility';

describe('翌日', () => {
  it('月末・年末・うるう年をまたぐ', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('資格のある月', () => {
  it('月末退職（10月31日退職・11月1日喪失）は10月分までかかる', () => {
    const q = [{ acquiredDate: '2024-04-01', lostDate: '2026-11-01' }];
    expect(isInsuredInMonth(q, '2026-10')).toBe(true);
    expect(isInsuredInMonth(q, '2026-11')).toBe(false);
  });

  it('月の途中の退職（10月15日退職・10月16日喪失）は9月分まで', () => {
    const q = [{ acquiredDate: '2024-04-01', lostDate: '2026-10-16' }];
    expect(isInsuredInMonth(q, '2026-09')).toBe(true);
    expect(isInsuredInMonth(q, '2026-10')).toBe(false);
  });

  it('入社月からかかる', () => {
    const q = [{ acquiredDate: '2026-10-20', lostDate: null }];
    expect(isInsuredInMonth(q, '2026-09')).toBe(false);
    expect(isInsuredInMonth(q, '2026-10')).toBe(true);
  });

  it('同月得喪（10月5日入社・10月20日退職）は10月分がかかる', () => {
    const q = [{ acquiredDate: '2026-10-05', lostDate: '2026-10-21' }];
    expect(isInsuredInMonth(q, '2026-10')).toBe(true);
    expect(isInsuredInMonth(q, '2026-11')).toBe(false);
  });

  it('いったん抜けて再加入した人は、抜けていた月はかからない', () => {
    const q = [
      { acquiredDate: '2024-04-01', lostDate: '2026-05-01' },
      { acquiredDate: '2026-10-01', lostDate: null },
    ];
    expect(isInsuredInMonth(q, '2026-04')).toBe(true);
    expect(isInsuredInMonth(q, '2026-07')).toBe(false);
    expect(isInsuredInMonth(q, '2026-10')).toBe(true);
  });
});

describe('産休・育休の免除', () => {
  it('産休9月10日〜12月5日は、9〜11月分が免除で12月分からかかる', () => {
    const l = [{ type: 'maternity' as const, startDate: '2026-09-10', endDate: '2026-12-05' }];
    expect(isLeaveExemptMonth(l, '2026-08')).toBe(false);
    expect(isLeaveExemptMonth(l, '2026-09')).toBe(true);
    expect(isLeaveExemptMonth(l, '2026-11')).toBe(true);
    expect(isLeaveExemptMonth(l, '2026-12')).toBe(false);
  });

  it('月末に終わる休業は、その月も免除（終了日の翌日が翌月）', () => {
    const l = [{ type: 'childcare' as const, startDate: '2026-11-20', endDate: '2026-12-31' }];
    expect(isLeaveExemptMonth(l, '2026-12')).toBe(true);
    expect(isLeaveExemptMonth(l, '2027-01')).toBe(false);
  });

  it('終了日が未定なら、開始月から免除が続く', () => {
    const l = [{ type: 'childcare' as const, startDate: '2026-10-01', endDate: null }];
    expect(isLeaveExemptMonth(l, '2027-06')).toBe(true);
  });

  it('同じ月の中の育休は14日以上で免除、13日なら免除しない', () => {
    const l14 = [{ type: 'childcare' as const, startDate: '2026-10-01', endDate: '2026-10-14' }];
    const l13 = [{ type: 'childcare' as const, startDate: '2026-10-01', endDate: '2026-10-13' }];
    expect(isLeaveExemptMonth(l14, '2026-10')).toBe(true);
    expect(isLeaveExemptMonth(l13, '2026-10')).toBe(false);
  });

  it('同じ月に分けて取った育休は合計する（7日＋7日で免除）', () => {
    const l = [
      { type: 'childcare' as const, startDate: '2026-10-03', endDate: '2026-10-09' },
      { type: 'childcare' as const, startDate: '2026-10-20', endDate: '2026-10-26' },
    ];
    expect(isLeaveExemptMonth(l, '2026-10')).toBe(true);
  });

  it('産後パパ育休で働いた日は引く（14日−2日＝12日で免除しない）', () => {
    const l = [
      { type: 'childcare' as const, startDate: '2026-10-01', endDate: '2026-10-14', workedDays: 2 },
    ];
    expect(isLeaveExemptMonth(l, '2026-10')).toBe(false);
  });

  it('産休は同じ月の中で終わっても14日の判定はしない', () => {
    const l = [{ type: 'maternity' as const, startDate: '2026-10-01', endDate: '2026-10-20' }];
    expect(isLeaveExemptMonth(l, '2026-10')).toBe(false);
  });
});

describe('適用除外', () => {
  it('該当年月日の月から非該当年月日の前月まで', () => {
    const e = [{ type: 'care' as const, startDate: '2026-10-16', endDate: '2027-04-01' }];
    expect(exemptedInsurances(e, '2026-09').care).toBe(false);
    expect(exemptedInsurances(e, '2026-10').care).toBe(true);
    expect(exemptedInsurances(e, '2027-03').care).toBe(true);
    expect(exemptedInsurances(e, '2027-04').care).toBe(false);
  });

  it('国保組合は健康保険、社会保障協定（年金）は厚生年金だけを外す', () => {
    const e = [
      { type: 'healthNhiUnion' as const, startDate: '2026-04-01', endDate: null },
      { type: 'pensionAgreement' as const, startDate: '2026-04-01', endDate: null },
    ];
    expect(exemptedInsurances(e, '2026-10')).toEqual({ health: true, care: false, pension: true });
  });
});

describe('産休・育休の申出待ちの表示', () => {
  const maternity = { type: 'maternity' as const, startDate: '2026-08-10', endDate: '2026-11-05', workedDays: null };
  const short1 = { type: 'childcare' as const, startDate: '2026-12-01', endDate: '2026-12-07', workedDays: null };
  const short2 = { type: 'childcare' as const, startDate: '2026-12-15', endDate: '2026-12-22', workedDays: null };

  it('免除にしている休業', () => {
    expect(exemptingLeave([maternity], '2026-10')).toBe(maternity);
    expect(exemptingLeave([maternity], '2026-11')).toBeNull();
    // 同じ月の短い育休は合計14日以上で免除。その月の最初の休業を返す
    expect(exemptingLeave([short1, short2], '2026-12')).toBe(short1);
    expect(exemptingLeave([short1], '2026-12')).toBeNull();
  });

  it('取得者申出書を届出済みにするまで「申出待ち」と添える', () => {
    expect(leaveFilingId('e1', maternity)).toBe('e1_leave_2026-08-10');
    expect(leaveExemptLabel('e1', maternity, new Set())).toBe('産休免除（申出待ち）');
    expect(leaveExemptLabel('e1', maternity, new Set(['e1_leave_2026-08-10']))).toBe('産休免除');
    expect(leaveExemptLabel('e1', short1, new Set())).toBe('育休免除（申出待ち）');
  });
});

describe('壊れた休業・ありえない就業日数', () => {
  it('就業した日数が休業の日数より多くても、同じ月のほかの育休の日数を減らさない', () => {
    const leaves = [
      { type: 'childcare' as const, startDate: '2026-05-01', endDate: '2026-05-05', workedDays: 10 },
      { type: 'childcare' as const, startDate: '2026-05-10', endDate: '2026-05-25', workedDays: null },
    ];
    expect(isLeaveExemptMonth(leaves, '2026-05')).toBe(true);
  });

  it('種類・開始日・終了日・就業日数の形が正しい休業だけを、計算に使うデータとする', () => {
    expect(isValidLeave({ type: 'childcare', startDate: '2026-05-01', endDate: null })).toBe(true);
    expect(isValidLeave({ type: 'maternity', startDate: '2026-05-01', endDate: '2026-08-01', workedDays: null })).toBe(true);
    expect(isValidLeave({ type: 'xxx', startDate: '2026-05-01', endDate: null })).toBe(false);
    expect(isValidLeave({ type: 'childcare', endDate: null })).toBe(false);
    expect(isValidLeave({ type: 'childcare', startDate: '2026-02-30', endDate: null })).toBe(false);
    expect(isValidLeave({ type: 'childcare', startDate: '2026/05/01', endDate: null })).toBe(false);
    expect(isValidLeave({ type: 'childcare', startDate: '2026-07-10', endDate: '2026-05-01' })).toBe(false);
    expect(isValidLeave({ type: 'childcare', startDate: '2026-05-01', endDate: null, workedDays: -1 })).toBe(false);
    expect(isValidLeave(null)).toBe(false);
  });
});
