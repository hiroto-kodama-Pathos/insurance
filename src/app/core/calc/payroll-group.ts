// 給与の支払区分（設計書 2.10）
// 月給者・パートなど、締め日や支払月が違う区分ごとに、締め日・支払月・控除のタイミング・支払日を持つ。
// 控除する給与の月と、被保険者区分を選ぶ締め日は、その人の区分で決まる。
import type { PayrollCutoff } from './insured-type';
import { isValidDate } from './new-employee';
import { CompanySettings } from './settings';

export type PayrollGroup = {
  id: string;
  name: string;
  cutoffDay: number | 'end';
  paidIn: 'sameMonth' | 'nextMonth';
  deductionTiming: 'nextMonth' | 'sameMonth';
  payDay: number | 'end';
  isDefault?: boolean;
};

/** 従業員の支払区分の履歴 */
export type PayrollAssignment = { validFrom: string; payrollGroupId: string };

/** 支払区分をまだ登録していない会社は、会社の設定（以前の、会社で1つの設定）を既定の区分として使う */
export const LEGACY_GROUP_ID = 'legacy';

export function legacyGroup(settings: Pick<CompanySettings, 'deductionTiming' | 'payrollCutoff'>): PayrollGroup {
  return {
    id: LEGACY_GROUP_ID,
    name: '既定（会社の設定）',
    cutoffDay: settings.payrollCutoff.day,
    paidIn: settings.payrollCutoff.paidIn,
    deductionTiming: settings.deductionTiming,
    payDay: 25,
    isDefault: true,
  };
}

/** 既定の区分（isDefault、なければ最初の区分） */
export function defaultGroup(groups: PayrollGroup[]): PayrollGroup {
  return groups.find((g) => g.isDefault) ?? groups[0];
}

/** その日の支払区分。履歴がなければ既定の区分 */
export function payrollGroupAt(groups: PayrollGroup[], assignments: PayrollAssignment[] | undefined, date: string): PayrollGroup {
  const a = (assignments ?? []).filter((x) => x.validFrom <= date).sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
  return (a && groups.find((g) => g.id === a.payrollGroupId)) || defaultGroup(groups);
}

export function cutoffOf(g: PayrollGroup): PayrollCutoff {
  return { day: g.cutoffDay, paidIn: g.paidIn };
}

/** 支払月の支払日（給与の入力の初期値） */
export function payDateOf(g: PayrollGroup, yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = g.payDay === 'end' ? last : Math.min(g.payDay, last);
  return `${yearMonth}-${String(d).padStart(2, '0')}`;
}

export type PayrollGroupInput = Omit<PayrollGroup, 'id'>;
export type PayrollGroupErrors = Partial<Record<'name' | 'cutoffDay' | 'payDay', string>>;

export function checkPayrollGroup(input: PayrollGroupInput, existingNames: string[]): PayrollGroupErrors {
  const e: PayrollGroupErrors = {};
  const name = input.name.trim();
  if (!name) e.name = '区分の名前を入力してください';
  else if (existingNames.includes(name)) e.name = '同じ名前の区分があります';
  const day = (v: number | 'end') => v === 'end' || (Number.isInteger(v) && v >= 1 && v <= 30);
  if (!day(input.cutoffDay)) e.cutoffDay = '締め日は1〜30日か「末日」にしてください';
  if (!day(input.payDay)) e.payDay = '支払日は1〜30日か「末日」にしてください';
  return e;
}

export function checkPayrollAssignment(existing: PayrollAssignment[], validFrom: string, groupId: string, current: string): Record<string, string> {
  if (!isValidDate(validFrom)) return { payrollDate: '変わった日を正しく入力してください' };
  if (!groupId) return { payrollDate: '支払区分を選んでください' };
  if (existing.some((a) => a.validFrom === validFrom)) return { payrollDate: 'この日からの支払区分はすでに登録されています' };
  if (groupId === current) return { payrollDate: 'この日の支払区分と同じです' };
  return {};
}

export function groupLabel(g: PayrollGroup): string {
  const day = (v: number | 'end') => (v === 'end' ? '末日' : `${v}日`);
  return `${day(g.cutoffDay)}締め・${g.paidIn === 'sameMonth' ? '当月' : '翌月'}${day(g.payDay)}払・${g.deductionTiming === 'nextMonth' ? '翌月控除' : '当月控除'}`;
}

/** 人と支払月ごとの締め日（随時改定・定時決定の被保険者区分の判定に渡す） */
export function cutoffResolver(
  groups: PayrollGroup[],
  employees: { id: string; payrollAssignments?: PayrollAssignment[] }[],
): (employeeId: string, paidMonth: string) => PayrollCutoff {
  const byId = new Map(employees.map((e) => [e.id, e]));
  return (employeeId, paidMonth) => cutoffOf(payrollGroupAt(groups, byId.get(employeeId)?.payrollAssignments, `${paidMonth}-01`));
}
