// 月次保険料一覧の並び替え・絞り込み（設計書 3.2）
// 一覧の行ごとに、並び替え・絞り込みに使う値（事実）をまとめ、条件で並べ替える。
import { EmployeeMonthResult } from './employee-month';
import { MonthlyPremium } from './monthly-premium';
import { matchesPerson } from './person-search';

/** 満年齢（その日の年齢。年齢計算に関する法律により、誕生日の前日に年をとる） */
export function ageOn(birthDate: string, date: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  // 翌日の時点で誕生日を迎えていれば、その日に年をとっている
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = next.getUTCMonth() + 1;
  const nd = next.getUTCDate();
  return ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0);
}

/** 本人負担の合計（円）・会社負担の合計（銭） */
export function premiumTotals(p: MonthlyPremium | null): { employee: number; employerSen: number } {
  if (!p) return { employee: 0, employerSen: 0 };
  const parts = [p.health, p.care, p.childSupport, p.pension];
  return {
    employee: Number(parts.reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n)),
    employerSen: Number(parts.reduce((t, x) => t + (x?.employerSen ?? 0n), 0n)),
  };
}

/**
 * 前月から保険料が変わった理由（変わっていなければ空）
 * @param prev 前月の結果（前月に資格がなければ null）
 */
export function changeReasons(prev: EmployeeMonthResult | null, cur: EmployeeMonthResult): string[] {
  const now = premiumTotals(cur.premium).employee;
  if (!prev || prev.status === 'notInsured') return now > 0 || cur.status === 'ok' ? ['入社・資格取得'] : [];
  const before = premiumTotals(prev.premium).employee;
  if (before === now && prev.officeId === cur.officeId) return [];
  const r: string[] = [];
  if (prev.standard && cur.standard && (prev.standard.health !== cur.standard.health || prev.standard.pension !== cur.standard.pension))
    r.push('標準報酬月額の改定');
  if (prev.officeId !== cur.officeId) r.push('異動');
  const p = prev.premium;
  const c = cur.premium;
  if (p && c) {
    if (p.exempt !== c.exempt) r.push(c.exempt ? '休業免除の開始' : '休業免除の終了');
    if (p.careLabel !== c.careLabel) r.push(c.careLabel === 'first' ? '介護保険（65歳）' : c.careLabel === 'none' ? '介護保険（対象外）' : '介護保険（40歳など）');
    if (!!p.pension !== !!c.pension) r.push(c.pension ? '厚生年金の開始' : '厚生年金の終了（70歳など）');
    if (!!p.health !== !!c.health) r.push(c.health ? '健康保険の開始' : '健康保険の終了（75歳など）');
    if (!!p.childSupport !== !!c.childSupport) r.push('子ども・子育て支援金');
  }
  if (r.length === 0 && JSON.stringify(prev.rates) !== JSON.stringify(cur.rates)) r.push('料率の改定');
  if (r.length === 0 && before !== now) r.push('その他（適用除外・按分など）');
  return r;
}

/** 一覧の1行の、並び替え・絞り込みに使う値 */
export type RowFacts = {
  id: string;
  employeeNumber: string;
  name: string;
  officeId: string | null;
  officeName: string;
  insurerId: string | null;
  /** 健康保険の標準報酬月額（並び替え用。なければ -1） */
  standard: number;
  employeeTotal: number;
  employerSen: number;
  age: number | null;
  /** 前月との本人負担の差（前月に資格がなければ null） */
  diff: number | null;
  reasons: string[];
  /** 要確認の内容（年齢到達・改定・通知書待ち・控除不足・計算できない理由など） */
  alerts: string[];
  exempt: boolean;
  careFirst: boolean;
  /** 適用除外で0円にしている保険がある */
  exemption: boolean;
  joined: boolean;
  left: boolean;
};

export type SortKey = 'employeeNumber' | 'office' | 'standard' | 'employeeTotal' | 'employerTotal' | 'age' | 'diff';

export const SORT_LABEL: Record<SortKey, string> = {
  employeeNumber: '社員番号',
  office: '適用事業所',
  standard: '標準報酬月額（等級）',
  employeeTotal: '本人負担',
  employerTotal: '会社負担',
  age: '年齢',
  diff: '前月との差額',
};

export type ExtraFilter = '' | 'changed' | 'alert' | 'exempt' | 'careFirst' | 'exemption' | 'joined' | 'left';

export const FILTER_LABEL: Record<Exclude<ExtraFilter, ''>, string> = {
  changed: '前月から保険料が変わった人',
  alert: '要確認がある人',
  exempt: '産休・育休で免除中の人',
  careFirst: '介護保険第1号（65歳以上）の人',
  exemption: '適用除外の人',
  joined: 'この月に入社（資格取得）した人',
  left: 'この月に退職（資格喪失）する人',
};

export type ListCriteria = {
  query: string;
  officeId: string;
  insurerId: string;
  extra: ExtraFilter;
  sort: SortKey;
  /** 大きい順・新しい順 */
  desc: boolean;
};

export const DEFAULT_CRITERIA: ListCriteria = { query: '', officeId: '', insurerId: '', extra: '', sort: 'employeeNumber', desc: false };

export function matches(f: RowFacts, c: ListCriteria): boolean {
  if (!matchesPerson(f.employeeNumber, f.name, c.query)) return false;
  if (c.officeId && f.officeId !== c.officeId) return false;
  if (c.insurerId && f.insurerId !== c.insurerId) return false;
  switch (c.extra) {
    case 'changed': return f.reasons.length > 0;
    case 'alert': return f.alerts.length > 0;
    case 'exempt': return f.exempt;
    case 'careFirst': return f.careFirst;
    case 'exemption': return f.exemption;
    case 'joined': return f.joined;
    case 'left': return f.left;
    default: return true;
  }
}

/** 並び替え（同じ値は社員番号順） */
export function compareFacts(a: RowFacts, b: RowFacts, key: SortKey, desc: boolean): number {
  const val = (f: RowFacts): number | string => {
    switch (key) {
      case 'office': return f.officeName;
      case 'standard': return f.standard;
      case 'employeeTotal': return f.employeeTotal;
      case 'employerTotal': return f.employerSen;
      case 'age': return f.age ?? -1;
      case 'diff': return f.diff ?? 0;
      default: return f.employeeNumber;
    }
  };
  const x = val(a);
  const y = val(b);
  const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  return (desc ? -c : c) || a.employeeNumber.localeCompare(b.employeeNumber);
}
