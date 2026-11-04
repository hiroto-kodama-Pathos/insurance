import { describe, expect, it } from 'vitest';
import { DEFAULT_SALARY_CRITERIA, filterSalaryRows, SalaryCriteria, SalaryFacts } from './salary-filter';

const base: SalaryFacts = {
  employeeNumber: '', name: '', officeId: 'honsha', officeOrder: 0, groupId: 'monthly',
  entered: true, fixed: 300_000, changed: false, attention: false, uninsured: false,
};
const rows: SalaryFacts[] = [
  { ...base, employeeNumber: '0001', name: '山田 太郎', fixed: 300_000, changed: true },
  { ...base, employeeNumber: '0002', name: '佐藤 花子', officeId: 'osaka', officeOrder: 1, fixed: 450_000 },
  { ...base, employeeNumber: '0003', name: '青木 健', groupId: 'part', entered: false, fixed: null, uninsured: true },
  { ...base, employeeNumber: '0004', name: '石井 葵', fixed: 200_000, attention: true },
];
const run = (c: Partial<SalaryCriteria>) => filterSalaryRows(rows, (r) => r, { ...DEFAULT_SALARY_CRITERIA, ...c }).map((r) => r.employeeNumber);

describe('給与の画面の絞り込みと並び替え', () => {
  it('条件がなければ、社員番号順にすべて', () => {
    expect(run({})).toEqual(['0001', '0002', '0003', '0004']);
  });

  it('氏名（空白を無視）・社員番号で検索する', () => {
    expect(run({ query: '山田太郎' })).toEqual(['0001']);
    expect(run({ query: '0002' })).toEqual(['0002']);
    expect(run({ query: '０００２' })).toEqual(['0002']); // 全角の数字でも見つかる
  });

  it('適用事業所・支払区分で絞り込む', () => {
    expect(run({ officeId: 'osaka' })).toEqual(['0002']);
    expect(run({ groupId: 'part' })).toEqual(['0003']);
  });

  it('未入力・入力済み・変動あり・要確認・未加入で絞り込む', () => {
    expect(run({ status: 'empty' })).toEqual(['0003']);
    expect(run({ status: 'entered' })).toEqual(['0001', '0002', '0004']);
    expect(run({ status: 'changed' })).toEqual(['0001']);
    expect(run({ status: 'attention' })).toEqual(['0004']);
    expect(run({ status: 'uninsured' })).toEqual(['0003']);
  });

  it('固定的賃金の多い順（未入力の人は最後）・適用事業所順に並べる', () => {
    expect(run({ sort: 'fixedDesc' })).toEqual(['0002', '0001', '0004', '0003']);
    expect(run({ sort: 'office' })).toEqual(['0001', '0003', '0004', '0002']);
  });
});
