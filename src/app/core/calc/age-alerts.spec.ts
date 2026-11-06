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

  describe('エッジケース：年齢境界日での切り替え判定', () => {
    it('40歳の誕生日の前日に介護保険開始', () => {
      const alerts = ageAlerts([emp('a', '1986-05-15')], '2026-05');
      expect(alerts).toContainEqual(expect.objectContaining({ kind: 'careStart', date: '2026-05-14' }));
    });

    it('65歳の誕生日の前日に介護保険終了（第1号に切り替わり）', () => {
      const alerts = ageAlerts([emp('a', '1961-05-15')], '2026-05');
      expect(alerts).toContainEqual(expect.objectContaining({ kind: 'careEnd', date: '2026-05-14' }));
    });

    it('70歳の誕生日の前日に厚生年金終了', () => {
      const alerts = ageAlerts([emp('a', '1956-05-15')], '2026-05');
      expect(alerts).toContainEqual(expect.objectContaining({ kind: 'pensionEnd', date: '2026-05-14' }));
    });

    it('75歳の誕生日（月中日）に健康保険終了', () => {
      const alerts = ageAlerts([emp('a', '1951-05-15')], '2026-05');
      expect(alerts).toContainEqual(expect.objectContaining({ kind: 'healthEnd', date: '2026-05-15' }));
    });

    it('月初1日生まれは前月に切り替わる', () => {
      const alertsMay = ageAlerts([emp('a', '1986-06-01')], '2026-05');
      const alertsJune = ageAlerts([emp('a', '1986-06-01')], '2026-06');
      expect(alertsMay).toContainEqual(expect.objectContaining({ kind: 'careStart' }));
      expect(alertsJune).toEqual([]);
    });

    it('複数の従業員の年齢イベントを同時に出力', () => {
      const emps = [
        emp('a', '1986-05-15'), // 40歳になる
        emp('b', '1961-05-15'), // 65歳になる
        emp('c', '1956-05-15'), // 70歳になる
      ];
      const alerts = ageAlerts(emps, '2026-05');
      expect(alerts).toHaveLength(3);
      expect(alerts.map((a) => a.kind)).toEqual(['careStart', 'careEnd', 'pensionEnd']);
    });
  });
});
