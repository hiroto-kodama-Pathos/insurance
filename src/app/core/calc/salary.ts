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
  /** その月の実際の労働時間（未加入の人の加入の可能性の判定に使う。設計書 2.24） */
  workingHours?: number | null;
  /** 時給単価（時給の人だけ。随時改定の変動を単価で見分ける。設計書 2.13） */
  hourlyRate?: number | null;
  /**
   * 算定から除く額（支払月・締め日の変更月だけ。暦日を超えた分、または変更前の給与）。
   * 給与のデータからは分からないので担当者が入れる。随時改定・定時決定の平均から除く（設計書 2.13）
   */
  excludedAmount?: number | null;
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
  /** total のうち現物給与の価額（届書の通貨・現物の内訳） */
  inKind: number;
  /** 時給単価（その月の最後の支払いの単価。入れていなければ null） */
  hourlyRate: number | null;
  /** 算定から除いた額（支払月・締め日の変更月。total からは除いてある） */
  excluded: number;
};

export function payMonths(salaries: SalaryRecord[]): PayMonth[] {
  const map = new Map<string, PayMonth>();
  for (const s of [...salaries].sort((a, b) => a.paidDate.localeCompare(b.paidDate))) {
    const ym = monthOf(s.paidDate);
    const retro = s.retroactiveDiff ?? 0;
    const m = map.get(ym) ?? { yearMonth: ym, fixed: 0, nonFixed: 0, retroactive: 0, days: 0, total: 0, inKind: 0, hourlyRate: null, excluded: 0 };
    m.inKind += s.inKindWages ?? 0;
    if (s.hourlyRate !== null && s.hourlyRate !== undefined) m.hourlyRate = s.hourlyRate;
    m.fixed += s.fixedWages - retro;
    m.nonFixed += s.nonFixedWages;
    m.retroactive += retro;
    m.days += s.paymentBaseDays;
    m.excluded += s.excludedAmount ?? 0;
    m.total += s.fixedWages - retro + s.nonFixedWages - (s.excludedAmount ?? 0);
    map.set(ym, m);
  }
  return [...map.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export type FixedWageChange = {
  yearMonth: string;
  direction: 'up' | 'down';
  /** 額（basis が hourlyRate のときは時給単価）。担当者が登録した変動で、前月の給与がなければ null */
  before: number | null;
  after: number | null;
  /** amount：固定的賃金の額 / hourlyRate：時給単価 / manual：担当者が「固定的賃金の変動として登録」 */
  basis: 'amount' | 'hourlyRate' | 'manual';
  /** 担当者が登録した内容（労働時間の変更など） */
  note?: string;
};

/** 担当者が登録した固定的賃金の変動（employees/{id}/fixedWageChanges） */
export type ManualWageChange = { yearMonth: string; direction: 'up' | 'down'; note: string };

/**
 * 固定的賃金が前月の支払いから変わった支払月（前月の給与がない月は判定しない）
 * - 時給の人（前月・その月とも時給単価がある）は、単価が変わった月だけを変動とする（労働時間で額が変わっただけの月は除く）
 * - 担当者が登録した変動は、額・単価が変わっていなくても変動月とする（向きは登録した向き）
 */
export function detectFixedWageChanges(months: PayMonth[], manual: ManualWageChange[] = []): FixedWageChange[] {
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  const detected = months.flatMap<FixedWageChange>((m) => {
    const prev = byMonth.get(addMonths(m.yearMonth, -1));
    if (!prev) return [];
    if (prev.hourlyRate !== null && m.hourlyRate !== null) {
      if (prev.hourlyRate === m.hourlyRate) return [];
      return [{ yearMonth: m.yearMonth, direction: m.hourlyRate > prev.hourlyRate ? 'up' : 'down', before: prev.hourlyRate, after: m.hourlyRate, basis: 'hourlyRate' as const }];
    }
    if (prev.fixed === m.fixed) return [];
    return [{ yearMonth: m.yearMonth, direction: m.fixed > prev.fixed ? 'up' : 'down', before: prev.fixed, after: m.fixed, basis: 'amount' as const }];
  });
  const result = detected.filter((c) => !manual.some((x) => x.yearMonth === c.yearMonth));
  for (const x of manual) {
    const prev = byMonth.get(addMonths(x.yearMonth, -1));
    const cur = byMonth.get(x.yearMonth);
    result.push({ yearMonth: x.yearMonth, direction: x.direction, before: prev?.fixed ?? null, after: cur?.fixed ?? null, basis: 'manual', note: x.note });
  }
  return result.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

export type RetroactivePossibility = { yearMonth: string; before: number; paid: number; after: number };

/**
 * 遡及の可能性（設計書 2.15）：遡及差額を入れていない月で、固定的賃金が前月より上がり、翌月にそれより下がった
 * （ただし前月よりは高い）。下がった幅が上がった幅以上（差額を1か月分以上まとめて払ったような動き）のときに出す。
 * 推測のため、随時改定の判定には使わない
 */
export function detectRetroactivePossibilities(months: PayMonth[]): RetroactivePossibility[] {
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  return months.flatMap((m) => {
    const prev = byMonth.get(addMonths(m.yearMonth, -1));
    const next = byMonth.get(addMonths(m.yearMonth, 1));
    if (!prev || !next || m.retroactive > 0) return [];
    if (!(m.fixed > prev.fixed && next.fixed < m.fixed && next.fixed > prev.fixed)) return [];
    if (m.fixed - next.fixed < next.fixed - prev.fixed) return [];
    return [{ yearMonth: m.yearMonth, before: prev.fixed, paid: m.fixed, after: next.fixed }];
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
  workingHours?: number | null;
  hourlyRate?: number | null;
  excludedAmount?: number | null;
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
  const x = input.excludedAmount;
  if (x !== null && x !== undefined) {
    if (!isYen(x)) e.excludedAmount = '0円以上の円で入力してください';
    else if (x > (input.fixedWages ?? 0) - (input.retroactiveDiff ?? 0) + (input.nonFixedWages ?? 0))
      e.excludedAmount = '算定から除く額は、支払った額（遡及差額を除く）以下にしてください';
  }
  const r = input.hourlyRate;
  if (r !== null && r !== undefined && !(Number.isInteger(r) && r > 0 && r <= 100_000)) e.hourlyRate = '時給単価を1円以上の円で入力してください';
  const h = input.workingHours;
  if (h !== null && h !== undefined && !(h >= 0 && h <= 744 && Math.round(h * 10) === h * 10))
    e.workingHours = '労働時間を0〜744時間で入力してください（小数第1位まで）';
  return e;
}
