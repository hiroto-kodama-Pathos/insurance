// 給与の画面の絞り込みと並び替え（設計書 3.6）
// 給与の行から絞り込みに使う事実だけを取り出して判定するので、画面とは別に確かめられる。
import { matchesPerson } from './person-search';

export type SalaryStatusFilter = '' | 'empty' | 'entered' | 'changed' | 'attention' | 'exclusionMissing' | 'uninsured';
export type SalarySortKey = 'employeeNumber' | 'name' | 'office' | 'fixedDesc';

export const SALARY_STATUS_LABEL: Record<Exclude<SalaryStatusFilter, ''>, string> = {
  empty: '未入力の人',
  entered: '入力済みの人',
  changed: '固定的賃金の変動ありの人',
  attention: '要確認の人（遡及の可能性・支払月や締め日の変更月）',
  exclusionMissing: '算定から除く額が未入力の人（支払月・締め日の変更月）',
  uninsured: '未加入の人（労働時間を入れる人）',
};

export const SALARY_SORT_LABEL: Record<SalarySortKey, string> = {
  employeeNumber: '社員番号順',
  name: '氏名順',
  office: '適用事業所順（設定に登録した順）',
  fixedDesc: '固定的賃金の多い順',
};

export type SalaryCriteria = {
  /** 氏名・社員番号（空白は無視） */
  query: string;
  officeId: string;
  /** 支払区分 */
  groupId: string;
  status: SalaryStatusFilter;
  sort: SalarySortKey;
};

export const DEFAULT_SALARY_CRITERIA: SalaryCriteria = { query: '', officeId: '', groupId: '', status: '', sort: 'employeeNumber' };

/** 絞り込み・並び替えに使う、1人分の事実 */
export type SalaryFacts = {
  employeeNumber: string;
  name: string;
  officeId: string | null;
  /** 適用事業所の並び（設定に登録した順。所属がなければ最後） */
  officeOrder: number;
  groupId: string;
  /** この月の給与が入力済みか */
  entered: boolean;
  /** この月の固定的賃金（未入力は null） */
  fixed: number | null;
  /** 固定的賃金の変動あり（給与から見つけたもの・担当者が登録したもの） */
  changed: boolean;
  /** 遡及の可能性・支払月や締め日の変更月 */
  attention: boolean;
  /** 算定から除く額が要る月なのに、給与は入っていて除く額が未入力（CSVで取り込んだときなど） */
  exclusionMissing?: boolean;
  uninsured: boolean;
};


function matchesStatus(f: SalaryFacts, status: SalaryStatusFilter): boolean {
  switch (status) {
    case '':
      return true;
    case 'empty':
      return !f.entered;
    case 'entered':
      return f.entered;
    case 'changed':
      return f.changed;
    case 'attention':
      return f.attention;
    case 'exclusionMissing':
      return !!f.exclusionMissing;
    case 'uninsured':
      return f.uninsured;
  }
}

function compare(a: SalaryFacts, b: SalaryFacts, sort: SalarySortKey): number {
  const byNumber = a.employeeNumber.localeCompare(b.employeeNumber);
  switch (sort) {
    case 'employeeNumber':
      return byNumber;
    case 'name':
      return a.name.localeCompare(b.name, 'ja') || byNumber;
    case 'office':
      return a.officeOrder - b.officeOrder || byNumber;
    case 'fixedDesc':
      // 未入力の人は最後
      if (a.fixed === null && b.fixed === null) return byNumber;
      if (a.fixed === null) return 1;
      if (b.fixed === null) return -1;
      return b.fixed - a.fixed || byNumber;
  }
}

/** 条件に合う行を、指定の順に並べて返す（元の配列は変えない） */
export function filterSalaryRows<T>(rows: T[], factsOf: (row: T) => SalaryFacts, c: SalaryCriteria): T[] {
  return rows
    .map((row) => ({ row, f: factsOf(row) }))
    .filter(
      ({ f }) =>
        matchesPerson(f.employeeNumber, f.name, c.query) &&
        (c.officeId === '' || f.officeId === c.officeId) &&
        (c.groupId === '' || f.groupId === c.groupId) &&
        matchesStatus(f, c.status),
    )
    .sort((a, b) => compare(a.f, b.f, c.sort))
    .map(({ row }) => row);
}
