// 給与の支払区分（設計書 2.10）
// 月給者・パートなど、締め日や支払月が違う区分ごとに、締め日・支払月・控除のタイミング・支払日を持つ。
// 控除する給与の月と、被保険者区分を選ぶ締め日は、その人の区分で決まる。
import type { PayrollCutoff } from './insured-type';
import { isValidDate } from './new-employee';
import { CompanySettings } from './settings';

/** 支払区分の締め日・支払月・控除のタイミング・支払日（給与の制度） */
export type PayrollTerms = {
  cutoffDay: number | 'end';
  paidIn: 'sameMonth' | 'nextMonth';
  deductionTiming: 'nextMonth' | 'sameMonth';
  payDay: number | 'end';
};

/** 給与の制度の変更（validFrom の支払月から、この締め日などにする） */
export type PayrollTermsChange = PayrollTerms & { validFrom: string };

/**
 * 支払区分。cutoffDay などは最初の制度で、changes に「○年○月から変える」の履歴を持つ（設計書 2.10）。
 * 過去の月は、その月の制度で計算する（制度を変えても、過去の月の給与の計算期間・控除する月は変わらない）
 */
export type PayrollGroup = PayrollTerms & {
  id: string;
  name: string;
  isDefault?: boolean;
  /** 使わない区分（消さずに、新しく割り当てられなくする。設計書 3.10） */
  archived?: boolean;
  /** 給与の制度の変更（支払月 'YYYY-MM' の古い順） */
  changes?: PayrollTermsChange[];
};

const TERM_KEYS = ['cutoffDay', 'paidIn', 'deductionTiming', 'payDay'] as const;

/** 制度だけを取り出す */
export function termsOf(t: PayrollTerms): PayrollTerms {
  return { cutoffDay: t.cutoffDay, paidIn: t.paidIn, deductionTiming: t.deductionTiming, payDay: t.payDay };
}

/** その支払月（'YYYY-MM'）の制度：最初の制度に、その月までの変更を当てる */
export function termsAt(g: PayrollGroup, yearMonth: string): PayrollTerms {
  const c = [...(g.changes ?? [])].filter((x) => x.validFrom <= yearMonth).sort((a, b) => a.validFrom.localeCompare(b.validFrom)).at(-1);
  return termsOf(c ?? g);
}

/** 2つの制度が同じか */
export function sameTerms(a: PayrollTerms, b: PayrollTerms): boolean {
  return TERM_KEYS.every((k) => a[k] === b[k]);
}

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

/**
 * その日の支払区分。履歴がなければ既定の区分。締め日などは、その日の月の制度にする
 * （区分の制度を「○年○月から変えた」とき、それより前の月は前の制度のまま）
 */
export function payrollGroupAt(groups: PayrollGroup[], assignments: PayrollAssignment[] | undefined, date: string): PayrollGroup {
  const a = (assignments ?? []).filter((x) => x.validFrom <= date).sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
  const g = (a && groups.find((x) => x.id === a.payrollGroupId)) || defaultGroup(groups);
  return g && g.changes?.length ? { ...g, ...termsAt(g, date.slice(0, 7)) } : g;
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

/**
 * 「○年○月から変える」の入力のチェック
 * @param thisMonth 今月（'YYYY-MM'）。それより前の月からは変えられない（過去の月を変えてしまうため。誤りは「直す」で）
 */
export function checkTermsChange(g: PayrollGroup, change: PayrollTermsChange, thisMonth: string): PayrollGroupErrors & { validFrom?: string } {
  const e: PayrollGroupErrors & { validFrom?: string } = {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(change.validFrom)) e.validFrom = '変える月（支払月）を正しく入力してください';
  else if (change.validFrom < thisMonth) e.validFrom = '過去の月からは変えられません（過去の月の給与の計算期間・控除する月が変わるため）。今月以降の月にしてください';
  else if ((g.changes ?? []).some((c) => c.validFrom >= change.validFrom))
    e.validFrom = 'この月以降の変更がすでにあります。先にその変更を取り消してください';
  const day = (v: number | 'end') => v === 'end' || (Number.isInteger(v) && v >= 1 && v <= 30);
  if (!day(change.cutoffDay)) e.cutoffDay = '締め日は1〜30日か「末日」にしてください';
  if (!day(change.payDay)) e.payDay = '支払日は1〜30日か「末日」にしてください';
  if (!e.validFrom && sameTerms(change, termsAt(g, change.validFrom))) e.validFrom = 'その月の締め日・支払月・支払日・控除する給与と同じです';
  return e;
}

/** 制度を短い文にする（「15日締め・当月25日払・翌月控除」） */
export function termsLabel(t: PayrollTerms): string {
  const day = (v: number | 'end') => (v === 'end' ? '末日' : `${v}日`);
  return `${day(t.cutoffDay)}締め・${t.paidIn === 'sameMonth' ? '当月' : '翌月'}${day(t.payDay)}払・${t.deductionTiming === 'nextMonth' ? '翌月控除' : '当月控除'}`;
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
