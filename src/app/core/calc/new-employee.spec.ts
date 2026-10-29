import { isValidDate, NewEmployeeInput, validateNewEmployee } from './new-employee';

const ok: NewEmployeeInput = {
  employeeNumber: '0005',
  name: '田中 次郎',
  birthDate: '1990-04-01',
  officeId: 'honsha',
  insured: true,
  acquiredDate: '2026-10-01',
  remuneration: 295_000,
  healthStandard: 300_000,
  pensionStandard: 300_000,
};

describe('日付のチェック', () => {
  it('存在しない日付は不可', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026/10/01')).toBe(false);
  });
});

describe('従業員の新規登録の入力チェック', () => {
  it('正しい入力はエラーなし', () => {
    expect(validateNewEmployee(ok, ['0001'])).toEqual({});
  });

  it('社員番号の重複はエラー', () => {
    expect(validateNewEmployee(ok, ['0005']).employeeNumber).toContain('すでに登録');
  });

  it('必須の項目が空ならエラー', () => {
    const e = validateNewEmployee({ ...ok, employeeNumber: '', name: ' ', officeId: '' }, []);
    expect(Object.keys(e).sort()).toEqual(['employeeNumber', 'name', 'officeId']);
  });

  it('加入の人は、報酬月額と標準報酬月額が必須', () => {
    const e = validateNewEmployee({ ...ok, remuneration: null, healthStandard: null }, []);
    expect(e.remuneration).toBeDefined();
    expect(e.healthStandard).toBeDefined();
  });

  it('未加入の人は、資格取得日・報酬月額・標準報酬月額がなくてよい', () => {
    const e = validateNewEmployee(
      { ...ok, insured: false, acquiredDate: '', remuneration: null, healthStandard: null, pensionStandard: null },
      [],
    );
    expect(e).toEqual({});
  });

  it('資格取得日が生年月日以前ならエラー', () => {
    expect(validateNewEmployee({ ...ok, acquiredDate: '1990-04-01' }, []).acquiredDate).toBeDefined();
  });

  it('標準報酬月額は1,000円単位', () => {
    expect(validateNewEmployee({ ...ok, healthStandard: 300_500 }, []).healthStandard).toContain('1,000円単位');
  });
});
