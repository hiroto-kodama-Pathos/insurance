import { dateLabel, yearMonthLabel } from './year-month';
import { DateLabelPipe, YearMonthPipe } from '../ui/year-month.pipe';

describe('年月の表示', () => {
  it("'2026-11' を「2026年11月」に。月の先頭の0は付けない", () => {
    expect(yearMonthLabel('2026-11')).toBe('2026年11月');
    expect(yearMonthLabel('2026-03')).toBe('2026年3月');
  });

  it('年月でない値（日付・空）はそのまま', () => {
    expect(yearMonthLabel('2026-10-25')).toBe('2026-10-25');
    expect(yearMonthLabel('')).toBe('');
    expect(yearMonthLabel(null)).toBe('');
  });

  it('テンプレートの ym：年月の並びは「・」でつなぐ', () => {
    const pipe = new YearMonthPipe();
    expect(pipe.transform('2026-09')).toBe('2026年9月');
    expect(pipe.transform(['2026-09', '2026-10'])).toBe('2026年9月・2026年10月');
  });
});

describe('日付の表示', () => {
  it('「2026年11月19日」の形にする（月・日の0は付けない）。日付でない値はそのまま、空は空', () => {
    expect(dateLabel('2026-11-19')).toBe('2026年11月19日');
    expect(dateLabel('2026-01-05')).toBe('2026年1月5日');
    expect(dateLabel('（加入中）')).toBe('（加入中）');
    expect(dateLabel('2026-11')).toBe('2026-11'); // 年月は yearMonthLabel で
    expect(dateLabel(null)).toBe('');
  });
  it('テンプレートの ymd：日付の並びは「・」でつなぐ', () => {
    const pipe = new DateLabelPipe();
    expect(pipe.transform('2026-12-10')).toBe('2026年12月10日');
    expect(pipe.transform(['2026-12-10', '2026-12-25'])).toBe('2026年12月10日・2026年12月25日');
  });
});
