// 給与（設計書 2.13・3.6・4章 salaries）
// 給与は保険料の計算には使わない。随時改定の候補・定時決定の見込みの判定にだけ使う。
import { monthOf } from './date';
import { isValidDate } from './new-employee';

export type SalaryRecord = {
  id: string;
  employeeId: string;
  /** 支払日 'YYYY-MM-DD'。随時改定の変動月は支払月で数える */
  paidDate: string;
  /** 固定的賃金（基本給・諸手当・通勤手当・固定的な現物給与など） */
  fixedWages: number;
  /** 非固定的賃金（残業代・歩合給など） */
  nonFixedWages: number;
  /** 支払基礎日数 */
  paymentBaseDays: number;
  /** 固定的賃金のうち、過去の月の分としてまとめて払った差額（遡及差額） */
  retroactiveDiff: number | null;
  /** 支払った額のうち、現物給与の価額 */
  inKindWages: number | null;
};

/** 支払月ごとにまとめた給与（同じ月に2回以上払った分は合算する） */
export type PayMonth = {
  yearMonth: string;
  /** 固定的賃金から遡及差額を除いた額（変動の判定に使う） */
  fixed: number;
  nonFixed: number;
  retroactive: number;
  days: number;
  /** 平均に使う報酬（固定的賃金＋非固定的賃金−遡及差額） */
  total: number;
};

export function payMonths(salaries: SalaryRecord[]): PayMonth[] {
  const map = new Map<string, PayMonth>();
  for (const s of salaries) {
    const ym = monthOf(s.paidDate);
    const retro = s.retroactiveDiff ?? 0;
    const m = map.get(ym) ?? { yearMonth: ym, fixed: 0, nonFixed: 0, retroactive: 0, days: 0, total: 0 };
    m.fixed += s.fixedWages - retro;
    m.nonFixed += s.nonFixedWages;
    m.retroactive += retro;
    m.days += s.paymentBaseDays;
    m.total += s.fixedWages - retro + s.nonFixedWages;
    map.set(ym, m);
  }
  return [...map.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export type FixedWageChange = { yearMonth: string; direction: 'up' | 'down'; before: number; after: number };

/** 固定的賃金が前月の支払いから変わった支払月（前月の給与がない月は判定しない） */
export function detectFixedWageChanges(months: PayMonth[]): FixedWageChange[] {
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  return months.flatMap((m) => {
    const prev = byMonth.get(addMonths(m.yearMonth, -1));
    if (!prev || prev.fixed === m.fixed) return [];
    return [{ yearMonth: m.yearMonth, direction: m.fixed > prev.fixed ? 'up' : 'down', before: prev.fixed, after: m.fixed }];
  });
}

// ---- 入力のチェック ----

export type SalaryInput = {
  paidDate: string;
  fixedWages: number | null;
  nonFixedWages: number | null;
  paymentBaseDays: number | null;
  retroactiveDiff: number | null;
  inKindWages: number | null;
};

export type SalaryErrors = Partial<Record<keyof SalaryInput, string>>;

const isYen = (v: number | null) => v !== null && Number.isInteger(v) && v >= 0;

export function validateSalary(input: SalaryInput): SalaryErrors {
  const e: SalaryErrors = {};
  if (!isValidDate(input.paidDate)) e.paidDate = '支払日を正しく入力してください';
  if (!isYen(input.fixedWages)) e.fixedWages = '固定的賃金を0円以上の円で入力してください';
  if (input.nonFixedWages !== null && !isYen(input.nonFixedWages)) e.nonFixedWages = '0円以上の円で入力してください';
  const d = input.paymentBaseDays;
  if (d === null || !Number.isInteger(d) || d < 0 || d > 31) e.paymentBaseDays = '支払基礎日数を0〜31日で入力してください';
  if (input.retroactiveDiff !== null) {
    if (!isYen(input.retroactiveDiff)) e.retroactiveDiff = '0円以上の円で入力してください';
    else if (isYen(input.fixedWages) && input.retroactiveDiff > input.fixedWages!)
      e.retroactiveDiff = '遡及差額は固定的賃金の内数です（固定的賃金以下にしてください）';
  }
  if (input.inKindWages !== null) {
    const total = (input.fixedWages ?? 0) + (input.nonFixedWages ?? 0);
    if (!isYen(input.inKindWages)) e.inKindWages = '0円以上の円で入力してください';
    else if (input.inKindWages > total) e.inKindWages = '現物給与は支払った額の内数です（固定的賃金と非固定的賃金の合計以下にしてください）';
  }
  return e;
}
