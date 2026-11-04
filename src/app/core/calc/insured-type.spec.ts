import { insuredTypeAt, minBaseDays, payPeriodEnd, typeForPayMonth } from './insured-type';

describe('被保険者区分', () => {
  const history = [
    { validFrom: '2024-04-01', type: 'general' as const },
    { validFrom: '2026-05-21', type: 'shortTime' as const },
  ];

  it('その日の区分（履歴がなければ一般被保険者）', () => {
    expect(insuredTypeAt([], '2026-05-01')).toBe('general');
    expect(insuredTypeAt(history, '2026-05-20')).toBe('general');
    expect(insuredTypeAt(history, '2026-05-21')).toBe('shortTime');
  });

  it('支払月の給与の締め日（当月払・翌月払、末日・25日締め）', () => {
    expect(payPeriodEnd('2026-05', { day: 25, paidIn: 'sameMonth' })).toBe('2026-05-25');
    expect(payPeriodEnd('2026-05', { day: 'end', paidIn: 'nextMonth' })).toBe('2026-04-30');
    expect(payPeriodEnd('2026-03', { day: 30, paidIn: 'nextMonth' })).toBe('2026-02-28');
  });

  it('設計書の例：25日締め・当月末日払で、5月の締め日までに短時間労働者に変われば、5月は短時間労働者（11日以上）で判定', () => {
    expect(typeForPayMonth(history, '2026-05', { day: 25, paidIn: 'sameMonth' })).toBe('shortTime');
    // 翌月払なら、5月に払う給与の締め日は4月末なので一般被保険者
    expect(typeForPayMonth(history, '2026-05', { day: 'end', paidIn: 'nextMonth' })).toBe('general');
    expect(minBaseDays('shortTime')).toBe(11);
    expect(minBaseDays('partTime')).toBe(17);
    // 特定減額特例対象者は短時間労働者のうちの区分なので11日
    expect(minBaseDays('specialReduction')).toBe(11);
    expect(minBaseDays('general')).toBe(17);
  });
});
