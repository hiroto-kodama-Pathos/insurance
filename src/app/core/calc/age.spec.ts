import { ageReachedDate, careStatus, isHealthAge, isPensionAge } from './age';

describe('年齢による対象判定', () => {
  it('年齢到達日は誕生日の前日', () => {
    expect(ageReachedDate('1986-04-02', 40)).toBe('2026-04-01');
  });

  it('4月1日生まれは3月31日に到達し、3月分から介護保険の第2号', () => {
    expect(ageReachedDate('1986-04-01', 40)).toBe('2026-03-31');
    expect(careStatus('1986-04-01', '2026-02')).toBe('none');
    expect(careStatus('1986-04-01', '2026-03')).toBe('second');
  });

  it('1月1日生まれは前年の12月31日に到達する', () => {
    expect(ageReachedDate('1987-01-01', 40)).toBe('2026-12-31');
  });

  it('2月29日生まれは、うるう年でない年は2月28日に到達する', () => {
    expect(ageReachedDate('1960-02-29', 65)).toBe('2025-02-28');
  });

  it('65歳到達月から介護保険の第1号', () => {
    expect(careStatus('1961-04-10', '2026-03')).toBe('second');
    expect(careStatus('1961-04-10', '2026-04')).toBe('first');
  });

  it('70歳到達月から厚生年金の対象外（1日生まれは前月から）', () => {
    expect(isPensionAge('1956-11-01', '2026-09')).toBe(true);
    expect(isPensionAge('1956-11-01', '2026-10')).toBe(false);
  });

  it('75歳の誕生月から健康保険の対象外（75歳は誕生日当日で判定）', () => {
    expect(isHealthAge('1951-11-01', '2026-10')).toBe(true);
    expect(isHealthAge('1951-11-01', '2026-11')).toBe(false);
  });
});