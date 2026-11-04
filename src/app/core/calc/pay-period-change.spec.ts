import { PayrollCutoff } from './insured-type';
import { isMonthlyPaid, needsExclusion, periodCalendarDays, periodChange, periodChangeNote } from './pay-period-change';

/** 変更月（5月）から区分が変わる */
const change = (before: PayrollCutoff, after: PayrollCutoff) => (ym: string) => (ym >= '2026-05' ? after : before);

describe('支払月・締め日を変えた月', () => {
  it('変更月でなければ null', () => {
    expect(periodChange('2026-05', () => ({ day: 'end', paidIn: 'nextMonth' }))).toBeNull();
  });

  it('締め日を遅らせた（20日締め→25日締め）：暦日を超えた月。超えた分の額を入れる', () => {
    const c = periodChange('2026-05', change({ day: 20, paidIn: 'nextMonth' }, { day: 25, paidIn: 'nextMonth' }))!;
    expect(c).toMatchObject({ kind: 'longer', periodStart: '2026-03-21', periodEnd: '2026-04-25', actualDays: 36, normalDays: 31 });
    expect(needsExclusion(c)).toBe(true);
    expect(periodChangeNote(c, 0)).toContain('超えた5日分の額を、給与の画面の「算定から除く額」に入れる');
    expect(periodChangeNote(c, 50_000)).toContain('50,000円を除いて平均');
  });

  it('締め日を早めた（末日締め→20日締め）：期間が短い月。支払基礎日数で判定する', () => {
    const c = periodChange('2026-05', change({ day: 'end', paidIn: 'nextMonth' }, { day: 20, paidIn: 'nextMonth' }))!;
    expect(c).toMatchObject({ kind: 'shorter', periodStart: '2026-04-01', periodEnd: '2026-04-20', actualDays: 20 });
    expect(needsExclusion(c)).toBe(false);
    expect(periodChangeNote(c, 0)).toContain('支払基礎日数が17日以上なら平均に使う');
  });

  it('翌月払い→当月払い：2か月分を払った月。変更前の給与の額を入れる', () => {
    const c = periodChange('2026-05', change({ day: 'end', paidIn: 'nextMonth' }, { day: 'end', paidIn: 'sameMonth' }))!;
    expect(c).toMatchObject({ kind: 'twoPeriods', periodStart: '2026-04-01', periodEnd: '2026-05-31', actualDays: 61, normalDays: 31 });
    expect(periodChangeNote(c, 300_000)).toContain('変更前の給与300,000円を除いて平均');
  });

  it('当月払い→翌月払い：給与のない月。平均から除く', () => {
    const c = periodChange('2026-05', change({ day: 'end', paidIn: 'sameMonth' }, { day: 'end', paidIn: 'nextMonth' }))!;
    expect(c.kind).toBe('noPay');
    expect(needsExclusion(c)).toBe(false);
  });
});

describe('支払基礎日数の初期値（月給制の暦日数）', () => {
  const fixed = (c: PayrollCutoff) => () => c;

  it.each([
    ['末締め翌月払いの10月支払：9月の30日', '2026-10', { day: 'end', paidIn: 'nextMonth' }, 30],
    ['末締め翌月払いの3月支払：2月の28日', '2026-03', { day: 'end', paidIn: 'nextMonth' }, 28],
    ['末締め翌月払いの3月支払（うるう年）：2月の29日', '2028-03', { day: 'end', paidIn: 'nextMonth' }, 29],
    ['末締め当月払いの10月支払：10月の31日', '2026-10', { day: 'end', paidIn: 'sameMonth' }, 31],
    ['15日締め翌月払いの10月支払：8/16〜9/15の31日', '2026-10', { day: 15, paidIn: 'nextMonth' }, 31],
    ['15日締め翌月払いの4月支払：2/16〜3/15の28日', '2026-04', { day: 15, paidIn: 'nextMonth' }, 28],
    ['20日締め当月払いの3月支払：2/21〜3/20の28日', '2026-03', { day: 20, paidIn: 'sameMonth' }, 28],
  ] as [string, string, PayrollCutoff, number][])('%s', (_label, ym, cutoff, days) => {
    expect(periodCalendarDays(ym, fixed(cutoff))).toBe(days);
  });

  it('当月払い→翌月払いに変えた月（給与のない月）は null', () => {
    const cutoffOf = (ym: string): PayrollCutoff => (ym < '2026-10' ? { day: 'end', paidIn: 'sameMonth' } : { day: 'end', paidIn: 'nextMonth' });
    expect(periodCalendarDays('2026-10', cutoffOf)).toBeNull();
  });

  it('月給制とみなす人：正社員・役員。雇用区分のない人は、前月の支払基礎日数が暦日数で時給単価がないとき', () => {
    expect(isMonthlyPaid('regular', null, null)).toBe(true);
    expect(isMonthlyPaid('officer', null, null)).toBe(true);
    expect(isMonthlyPaid('partTime', { paymentBaseDays: 30 }, 30)).toBe(false); // パートは前月から決めない
    expect(isMonthlyPaid('contract', { paymentBaseDays: 30 }, 30)).toBe(false);
    expect(isMonthlyPaid(undefined, { paymentBaseDays: 30 }, 30)).toBe(true);
    expect(isMonthlyPaid(undefined, { paymentBaseDays: 21 }, 30)).toBe(false); // 出勤日数を入れている人
    expect(isMonthlyPaid(undefined, { paymentBaseDays: 30, hourlyRate: 1200 }, 30)).toBe(false); // 時給の人
    expect(isMonthlyPaid(undefined, null, 30)).toBe(false); // 前月の給与がない
  });
});
