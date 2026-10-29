// 被保険者区分（設計書 2.13）
// 雇用形態（正社員かどうか）ではなく、届出上の区分で、随時改定・定時決定の支払基礎日数の基準を選ぶ。
import { daysInMonth, monthEnd } from './date';
import { CompanySettings } from './settings';
import { addMonths } from './salary';

/**
 * general：一般被保険者 / partTime：一般被保険者のうち短時間就労者（パート・アルバイトなど）
 * shortTime：短時間労働者（特定適用事業所等） / specialReduction：特定減額特例対象者
 */
export type InsuredType = 'general' | 'partTime' | 'shortTime' | 'specialReduction';

export const INSURED_TYPE_LABEL: Record<InsuredType, string> = {
  general: '一般被保険者',
  partTime: '一般被保険者（短時間就労者）',
  shortTime: '短時間労働者',
  specialReduction: '特定減額特例対象者',
};

/** 被保険者区分の履歴（働き方の変更で変わる） */
export type InsuredTypeHistory = { validFrom: string; type: InsuredType };

export type PayrollCutoff = CompanySettings['payrollCutoff'];
export const DEFAULT_CUTOFF: PayrollCutoff = { day: 'end', paidIn: 'nextMonth' };

/** その日の区分。履歴がなければ一般被保険者 */
export function insuredTypeAt(history: InsuredTypeHistory[] | undefined, date: string): InsuredType {
  const h = (history ?? []).filter((x) => x.validFrom <= date).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return h?.type ?? 'general';
}

/** 支払月の給与の計算期間の末日（締め日） */
export function payPeriodEnd(paidMonth: string, cutoff: PayrollCutoff): string {
  const ym = cutoff.paidIn === 'nextMonth' ? addMonths(paidMonth, -1) : paidMonth;
  if (cutoff.day === 'end') return monthEnd(ym);
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(Math.min(cutoff.day, daysInMonth(y, m))).padStart(2, '0')}`;
}

/** 支払月の給与に使う区分（締め日時点の区分。設計書 2.13） */
export function typeForPayMonth(history: InsuredTypeHistory[] | undefined, paidMonth: string, cutoff: PayrollCutoff): InsuredType {
  return insuredTypeAt(history, payPeriodEnd(paidMonth, cutoff));
}

/** 支払基礎日数の基準（短時間労働者は11日、それ以外は17日） */
export function minBaseDays(type: InsuredType): number {
  return type === 'shortTime' ? 11 : 17;
}
