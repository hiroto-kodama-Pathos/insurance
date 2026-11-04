// 期間ごとの会社負担の集計（設計書 2.29・3.14）
// 月ごとに、月額と賞与の会社負担を保険別に出し、期間の合計を出す。決算の未払金や年度の人件費の集計に使う。
// 会社負担は、納付書の欄（適用事業所・保険者ごと）で「納付見込額 − 本人負担合計」として求めた額を足し上げる（2.5）。
import { EmployeeMonthResult } from './employee-month';
import { summarizeMonth } from './monthly-summary';
import { senToDisplayYen } from './premium-calculator';

export type InsuranceKey = 'health' | 'care' | 'childSupport' | 'pension';

export const INSURANCE_LABEL: Record<InsuranceKey, string> = {
  health: '健康保険',
  care: '介護保険',
  childSupport: '子ども・子育て支援金',
  pension: '厚生年金保険',
};

export type EmployerAmounts = Record<InsuranceKey, number> & { total: number };

export type PeriodMonthInput = {
  yearMonth: string;
  monthly: EmployeeMonthResult[];
  bonus: EmployeeMonthResult[];
  /** 未確定の事業所の分を含む（その場で計算した結果） */
  includesUnclosed: boolean;
};

export type PeriodRow = { yearMonth: string; monthly: EmployerAmounts; bonus: EmployerAmounts; total: EmployerAmounts; includesUnclosed: boolean };

const zero = (): EmployerAmounts => ({ health: 0, care: 0, childSupport: 0, pension: 0, total: 0 });

function add(a: EmployerAmounts, b: EmployerAmounts): EmployerAmounts {
  const r = zero();
  for (const k of ['health', 'care', 'childSupport', 'pension', 'total'] as const) r[k] = a[k] + b[k];
  return r;
}

/**
 * 1か月分の会社負担（保険別）
 * 介護保険は健康保険と同じ納付書の欄なので、欄の会社負担合計のうち、1人ずつの介護保険の会社負担（円未満切り捨て）の合計を介護保険とし、
 * 残りを健康保険とする（合計は欄の会社負担合計と一致する）
 */
export function employerAmounts(yearMonth: string, results: EmployeeMonthResult[]): EmployerAmounts {
  const s = summarizeMonth(yearMonth, results);
  const ok = results.filter((r) => r.status === 'ok' && r.officeId && r.insurerId);
  const care = ok.reduce((t, r) => t + Number(r.premium?.care ? senToDisplayYen(r.premium.care.employerSen) : 0n), 0);
  const healthCare = Number(s.company.healthCare.employerTotal);
  const r: EmployerAmounts = {
    health: healthCare - care,
    care,
    childSupport: Number(s.company.childSupport.employerTotal),
    pension: Number(s.company.pension.employerTotal),
    total: 0,
  };
  r.total = r.health + r.care + r.childSupport + r.pension;
  return r;
}

/** 月ごとの行と、期間の合計 */
export function periodTotals(months: PeriodMonthInput[], officeId = ''): { rows: PeriodRow[]; total: PeriodRow } {
  const pick = (list: EmployeeMonthResult[]) => (officeId ? list.filter((r) => r.officeId === officeId) : list);
  const rows = months.map((m) => {
    const monthly = employerAmounts(m.yearMonth, pick(m.monthly));
    const bonus = employerAmounts(m.yearMonth, pick(m.bonus));
    return { yearMonth: m.yearMonth, monthly, bonus, total: add(monthly, bonus), includesUnclosed: m.includesUnclosed };
  });
  const total = rows.reduce(
    (t, r) => ({ ...t, monthly: add(t.monthly, r.monthly), bonus: add(t.bonus, r.bonus), total: add(t.total, r.total), includesUnclosed: t.includesUnclosed || r.includesUnclosed }),
    { yearMonth: '合計', monthly: zero(), bonus: zero(), total: zero(), includesUnclosed: false } as PeriodRow,
  );
  return { rows, total };
}

/** 'YYYY-MM' の範囲（両端を含む） */
export function monthRange(from: string, to: string): string[] {
  const list: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    list.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (list.length > 120) break;
  }
  return list;
}

/** CSV（Excelで開けるよう BOM つき）。月・区分・保険別の会社負担 */
export function periodCsv(result: { rows: PeriodRow[]; total: PeriodRow }): string {
  const head = ['月', '区分', ...Object.values(INSURANCE_LABEL), '合計', '状態'];
  const line = (r: PeriodRow, kind: 'monthly' | 'bonus' | 'total') => {
    const a = r[kind];
    return [r.yearMonth, { monthly: '月額', bonus: '賞与', total: '計' }[kind], a.health, a.care, a.childSupport, a.pension, a.total, r.includesUnclosed ? '未確定を含む' : '確定'].join(',');
  };
  const body = [...result.rows, result.total].flatMap((r) => [line(r, 'monthly'), line(r, 'bonus'), line(r, 'total')]);
  return '﻿' + [head.join(','), ...body].join('\r\n') + '\r\n';
}
