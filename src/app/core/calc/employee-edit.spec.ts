import {
  checkLeave,
  checkLoss,
  checkReacquire,
  checkRetirement,
  checkStandard,
  checkTransfer,
  isValidMonth,
} from './employee-edit';

const open = [{ acquiredDate: '2024-04-01', lostDate: null }];
const closed = [{ acquiredDate: '2024-04-01', lostDate: '2026-05-01' }];

describe('退職・喪失・再加入', () => {
  it('退職日の翌日を資格喪失日にする（月末退職は翌月1日）', () => {
    expect(checkRetirement(open, '2026-10-31').lostDate).toBe('2026-11-01');
    expect(checkRetirement(open, '2026-10-15').lostDate).toBe('2026-10-16');
  });

  it('加入中の資格がない人は退職を登録できない', () => {
    expect(checkRetirement(closed, '2026-10-31').errors['retirementDate']).toBeDefined();
  });

  it('退職日が資格取得日より前ならエラー', () => {
    expect(checkRetirement(open, '2024-03-31').errors['retirementDate']).toBeDefined();
  });

  it('退職以外の喪失は、理由が必須', () => {
    expect(checkLoss(open, '2026-10-01', '')['reason']).toBeDefined();
    expect(checkLoss(open, '2026-10-01', 'conditions')).toEqual({});
  });

  it('再加入は、加入中なら不可・前の喪失日以降なら可', () => {
    expect(checkReacquire(open, '2026-10-01')['acquiredDate']).toBeDefined();
    expect(checkReacquire(closed, '2026-04-30')['acquiredDate']).toBeDefined();
    expect(checkReacquire(closed, '2026-10-01')).toEqual({});
  });
});

describe('異動', () => {
  const a = [{ validFrom: '2024-04-01', officeId: 'honsha' }];
  it('今と同じ事業所や、今の所属の開始日以前は不可', () => {
    expect(checkTransfer(a, '2026-10-15', 'honsha')['officeId']).toBeDefined();
    expect(checkTransfer(a, '2024-04-01', 'osaka')['transferDate']).toBeDefined();
    expect(checkTransfer(a, '2026-10-15', 'osaka')).toEqual({});
  });
});

describe('標準報酬月額の履歴の追加', () => {
  it('同じ適用開始月の二重登録は不可', () => {
    const e = checkStandard(['2026-09'], {
      validFrom: '2026-09',
      reason: 'regular',
      healthStandard: 340_000,
      pensionStandard: 340_000,
    });
    expect(e['validFrom']).toBeDefined();
  });

  it('適用開始月の形', () => {
    expect(isValidMonth('2026-09')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
  });
});

describe('休業', () => {
  it('終了日は空でもよいが、開始日より前は不可', () => {
    expect(checkLeave({ type: 'childcare', startDate: '2026-10-01', endDate: '', workedDays: null })).toEqual({});
    expect(
      checkLeave({ type: 'childcare', startDate: '2026-10-01', endDate: '2026-09-30', workedDays: null })['endDate'],
    ).toBeDefined();
  });

  it('就業した日数は育休だけ', () => {
    expect(
      checkLeave({ type: 'maternity', startDate: '2026-10-01', endDate: '', workedDays: 2 })['workedDays'],
    ).toBeDefined();
  });
});
