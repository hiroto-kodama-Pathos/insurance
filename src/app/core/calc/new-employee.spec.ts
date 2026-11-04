import { breakdownTotal, checkBreakdown, childLaborEndDate, childLaborNotice, EMPTY_BREAKDOWN, isValidDate, NewEmployeeInput, normalizeBreakdown, similarRemuneration, validateNewEmployee } from './new-employee';

const ok: NewEmployeeInput = {
  employeeNumber: '0005',
  name: '田中 次郎',
  birthDate: '1990-04-01',
  officeId: 'honsha',
  insured: true,
  acquiredDate: '2026-10-01',
  breakdown: { basic: 250_000, allowances: 20_000, commuting: 15_000, overtime: 20_000 },
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

  it('加入の人は、基本給と標準報酬月額が必須', () => {
    const e = validateNewEmployee({ ...ok, breakdown: { ...ok.breakdown, basic: null }, healthStandard: null }, []);
    expect(e.basic).toBeDefined();
    expect(e.healthStandard).toBeDefined();
  });

  it('未加入の人は、報酬月額・標準報酬月額がなくてよい（入社日は必要）', () => {
    expect(validateNewEmployee({ ...ok, insured: false, acquiredDate: '' }, []).acquiredDate).toContain('入社日');
    const e = validateNewEmployee(
      { ...ok, insured: false, breakdown: EMPTY_BREAKDOWN, healthStandard: null, pensionStandard: null },
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

describe('加入対象の判定の入力', () => {
  const el = { employmentType: 'partTime' as const, weeklyHours: 25, monthlyDays: 20, contractEnd: '', renewalExpected: false, isStudent: false };
  it('週の所定労働時間・月の所定労働日数は必須。契約の終わりは入社日以後', () => {
    expect(validateNewEmployee({ ...ok, eligibility: el }, [])).toEqual({});
    const e = validateNewEmployee({ ...ok, eligibility: { ...el, weeklyHours: null, monthlyDays: 32, contractEnd: '2026-09-30' } }, []);
    expect(Object.keys(e).sort()).toEqual(['contractEnd', 'monthlyDays', 'weeklyHours']);
    expect(validateNewEmployee({ ...ok, eligibility: { ...el, weeklyHours: 25.25 } }, []).weeklyHours).toBeDefined();
  });
});

describe('報酬月額の内訳', () => {
  it('4つの合計が報酬月額（空欄は0円）。基本給が空なら合計なし', () => {
    expect(breakdownTotal({ basic: 250_000, allowances: 20_000, commuting: 15_000, overtime: 20_000 })).toBe(305_000);
    expect(breakdownTotal({ basic: 250_000, allowances: null, commuting: 15_000, overtime: null })).toBe(265_000);
    expect(breakdownTotal({ ...EMPTY_BREAKDOWN, commuting: 15_000 })).toBeNull();
    expect(normalizeBreakdown({ basic: 250_000, allowances: null, commuting: 15_000, overtime: null })).toEqual({
      basic: 250_000, allowances: 0, commuting: 15_000, overtime: 0,
    });
  });

  it('基本給は1円以上、ほかは空欄か0円以上', () => {
    expect(checkBreakdown({ basic: 250_000, allowances: 0, commuting: null, overtime: null })).toEqual({});
    expect(checkBreakdown({ ...EMPTY_BREAKDOWN, basic: 0 }).basic).toBeDefined();
    expect(checkBreakdown({ basic: 250_000, allowances: -1, commuting: 1.5, overtime: null })).toEqual({
      allowances: expect.any(String), commuting: expect.any(String),
    });
  });
});

describe('日給・時給の人：同じような仕事をする人の前月の報酬の平均', () => {
  const sal = (employeeId: string, paidDate: string, fixed: number, nonFixed = 0, retro: number | null = null) =>
    ({ employeeId, paidDate, fixedWages: fixed, nonFixedWages: nonFixed, retroactiveDiff: retro });

  it('前月に払った報酬（遡及差額を除き、同じ月の複数回は合算）の平均。給与のない人は平均に入れない', () => {
    const r = similarRemuneration(
      [sal('a', '2026-09-25', 180_000, 20_000), sal('b', '2026-09-10', 100_000), sal('b', '2026-09-25', 110_000, 0, 10_000), sal('a', '2026-08-25', 999_999)],
      ['a', 'b', 'c'],
      '2026-09',
    );
    expect(r.people).toEqual([{ employeeId: 'a', total: 200_000 }, { employeeId: 'b', total: 200_000 }, { employeeId: 'c', total: null }]);
    expect(r.average).toBe(200_000);
    expect(similarRemuneration([], ['c'], '2026-09').average).toBeNull();
  });
});

describe('生年月日の入力チェックと、児童の注意', () => {
  it('生年月日が今日より後・資格取得日以後ならエラー', () => {
    expect(validateNewEmployee({ ...ok, birthDate: '2026-11-03' }, [], '2026-11-02').birthDate).toContain('今日より後');
    expect(validateNewEmployee({ ...ok, birthDate: ok.acquiredDate }, [], '2026-11-02').birthDate).toContain('資格取得日');
    expect(validateNewEmployee(ok, [], '2026-11-02').birthDate).toBeUndefined();
  });

  it('被扶養者の生年月日も、今日より後ならエラー', () => {
    const e = validateNewEmployee({ ...ok, dependents: [{ name: '子', birthDate: '2026-12-01', certifiedDate: '' }] }, [], '2026-11-02');
    expect(e['dependent0']).toContain('今日より後');
  });

  it('満15歳に達した日（誕生日の前日）以後の最初の3月31日', () => {
    expect(childLaborEndDate('2011-04-01')).toBe('2026-03-31'); // 2026-03-31 に15歳に達する → その日
    expect(childLaborEndDate('2011-04-02')).toBe('2027-03-31'); // 2026-04-01 に15歳に達する → 翌年
    expect(childLaborEndDate('2011-01-01')).toBe('2026-03-31'); // 2025-12-31 に15歳に達する
  });

  it('入社日がその3月31日以前なら注意の一文を出し、4月1日からは出さない', () => {
    expect(childLaborNotice('2011-04-01', '2026-03-31')).toContain('2026年3月31日');
    expect(childLaborNotice('2011-04-01', '2026-04-01')).toBe('');
    expect(childLaborNotice('', '2026-04-01')).toBe('');
  });
});
