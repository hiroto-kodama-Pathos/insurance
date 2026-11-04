import { checkExemption, exemptionNote, exemptionNotice } from './exemption';

describe('適用除外の入力チェック', () => {
  const existing = [{ id: 'x1', type: 'care' as const, startDate: '2026-04-02', endDate: '2026-09-01' }];

  it('日付の正しさと、非該当年月日が該当年月日より後かを確かめる', () => {
    expect(checkExemption([], { type: 'care', startDate: '2026-02-30', endDate: '' }).startDate).toBeTruthy();
    expect(checkExemption([], { type: 'care', startDate: '2026-05-01', endDate: '2026-05-01' }).endDate).toContain('より後');
    expect(checkExemption([], { type: 'care', startDate: '2026-05-01', endDate: '' })).toEqual({});
  });

  it('同じ種類の期間は重ねない（ほかの種類なら重なってよい。自分自身の変更は除く）', () => {
    expect(checkExemption(existing, { type: 'care', startDate: '2026-08-01', endDate: '' }).startDate).toContain('重なって');
    expect(checkExemption(existing, { type: 'care', startDate: '2026-09-01', endDate: '' })).toEqual({});
    expect(checkExemption(existing, { type: 'pensionAgreement', startDate: '2026-05-01', endDate: '' })).toEqual({});
    expect(checkExemption(existing, { type: 'care', startDate: '2026-04-02', endDate: '2026-10-01' }, 'x1')).toEqual({});
  });

  it('届け出ることと期限', () => {
    expect(exemptionNotice('care', '2026-04-02').deadline).toBe('遅滞なく');
    expect(exemptionNotice('healthNhiUnion', '2026-04-01').deadline).toContain('2026年4月15日まで');
  });

  it('その月に0円にしている保険を表示する（非該当年月日の月から元に戻す）', () => {
    const list = [{ type: 'care' as const, startDate: '2026-04-02', endDate: '2026-09-01' }, { type: 'pensionAgreement' as const, startDate: '2026-06-01', endDate: null }];
    expect(exemptionNote(list, '2026-03')).toBe('');
    expect(exemptionNote(list, '2026-04')).toBe('適用除外（介護保険）');
    expect(exemptionNote(list, '2026-06')).toBe('適用除外（介護保険・厚生年金）');
    expect(exemptionNote(list, '2026-09')).toBe('適用除外（厚生年金）');
  });
});
