import { describe, expect, it } from 'vitest';
import { ageAlerts } from './age-alerts';
import { Qualification } from './eligibility';

const insured: Qualification[] = [{ acquiredDate: '2020-04-01', lostDate: null }];
const emp = (id: string, birthDate: string, qualifications: Qualification[] = insured) => ({ id, birthDate, qualifications });

describe('ageAlerts', () => {
  it('40歳：年齢到達日（誕生日の前日）の月から介護保険がかかる', () => {
    expect(ageAlerts([emp('a', '1986-11-10')], '2026-11').map((x) => [x.kind, x.date])).toEqual([['careStart', '2026-11-09']]);
  });
  it('1日生まれは前の月に切り替わる', () => {
    expect(ageAlerts([emp('a', '1986-12-01')], '2026-11').map((x) => x.kind)).toEqual(['careStart']);
    expect(ageAlerts([emp('a', '1986-12-01')], '2026-12')).toEqual([]);
  });
  it('65歳・70歳', () => {
    expect(ageAlerts([emp('a', '1961-11-10')], '2026-11').map((x) => x.kind)).toEqual(['careEnd']);
    expect(ageAlerts([emp('a', '1956-11-10')], '2026-11').map((x) => x.kind)).toEqual(['pensionEnd']);
  });
  it('75歳は誕生日の月（1日生まれでも前の月にならない）', () => {
    expect(ageAlerts([emp('a', '1951-12-01')], '2026-12').map((x) => [x.kind, x.date])).toEqual([['healthEnd', '2026-12-01']]);
    expect(ageAlerts([emp('a', '1951-12-01')], '2026-11')).toEqual([]);
  });
  it('その月に資格がない人は出さない', () => {
    expect(ageAlerts([emp('a', '1986-11-10', [{ acquiredDate: '2020-04-01', lostDate: '2026-10-01' }])], '2026-11')).toEqual([]);
  });
});
