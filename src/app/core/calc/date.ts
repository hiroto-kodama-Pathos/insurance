// 日付の共通関数（設計書 5.5）
// 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱い、Date オブジェクトは使わない。

export type Ymd = { y: number; m: number; d: number };

export function parseDate(date: string): Ymd {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function formatDate({ y, m, d }: Ymd): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function previousDay({ y, m, d }: Ymd): Ymd {
  if (d > 1) return { y, m, d: d - 1 };
  if (m > 1) return { y, m: m - 1, d: daysInMonth(y, m - 1) };
  return { y: y - 1, m: 12, d: 31 };
}

/** 'YYYY-MM-DD' から 'YYYY-MM' を取り出す */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 対象月の末日（'2026-02' → '2026-02-28'） */
export function monthEnd(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return formatDate({ y, m, d: daysInMonth(y, m) });
}