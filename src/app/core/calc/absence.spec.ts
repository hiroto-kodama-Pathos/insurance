import { absenceDeductionNote, absencePeriodLabel, absentInMonth, absentOn, checkAbsence } from './absence';

describe('休職', () => {
  const list = [
    { reason: 'sickness' as const, startDate: '2026-10-15', endDate: '2026-12-31' },
    { reason: 'personal' as const, startDate: '2027-03-01', endDate: null },
  ];

  it('その日・その月に休職中か', () => {
    expect(absentOn(list, '2026-10-14')).toBeNull();
    expect(absentOn(list, '2026-10-15')?.reason).toBe('sickness');
    expect(absentOn(list, '2030-01-01')?.reason).toBe('personal');
    expect(absentInMonth(list, '2026-10')).toBe(true);
    expect(absentInMonth(list, '2027-01')).toBe(false);
    expect(absentInMonth(undefined, '2026-10')).toBe(false);
  });

  it('期間の表示と控除不足の添え書き', () => {
    expect(absencePeriodLabel(list[1])).toBe('2027年3月1日〜（終了日未定）');
    expect(absenceDeductionNote(list, '2026-11')).toContain('休職中のため控除不足に注意');
    expect(absenceDeductionNote(list, '2027-02')).toBe('');
  });

  it('入力チェック（日付・期間の重なり）', () => {
    expect(checkAbsence({ reason: 'sickness', startDate: '', endDate: '' }, [])).toEqual({ startDate: '開始日を入力してください' });
    expect(checkAbsence({ reason: 'sickness', startDate: '2026-10-01', endDate: '2026-09-30' }, [])['endDate']).toContain('開始日以降');
    expect(checkAbsence({ reason: 'other', startDate: '2026-12-01', endDate: '2027-01-31' }, list)['startDate']).toContain('重なって');
    expect(checkAbsence({ reason: 'other', startDate: '2027-01-01', endDate: '2027-02-28' }, list)).toEqual({});
    // 終了日未定の休職とは、それより後の期間も重なる
    expect(checkAbsence({ reason: 'other', startDate: '2028-01-01', endDate: '' }, list)['startDate']).toContain('重なって');
  });
});
