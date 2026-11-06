import { checkBonusType, fourOrMoreBonuses, fourthBonusWarning, isRemunerationBonus, remunerationBonusAddOn } from './bonus-type';

const types = [{ id: 'q', name: '四半期賞与', isRemuneration: true, validFrom: '2026-04' }, { id: 's', name: '夏季賞与', isRemuneration: false, validFrom: '2020-01' }];

describe('年4回以上支給する賞与', () => {
  it('報酬扱いになるのは、年4回以上支給の種類で、適用開始月以後の支給', () => {
    expect(isRemunerationBonus(types, 'q', '2026-04-10')).toBe(true);
    expect(isRemunerationBonus(types, 'q', '2026-03-31')).toBe(false);
    expect(isRemunerationBonus(types, 's', '2026-07-10')).toBe(false);
    expect(isRemunerationBonus(types, null, '2026-07-10')).toBe(false);
  });

  it('7月1日〜翌6月30日で4回目（報酬扱いの賞与は数えない）なら警告する', () => {
    const b = (paidDate: string, isRemuneration = false) => ({ employeeId: 'e1', paidDate, isRemuneration });
    expect(fourthBonusWarning([b('2026-07-10'), b('2026-09-10')], 'e1', '2026-12-10')).toBeNull();
    expect(fourthBonusWarning([b('2026-07-10'), b('2026-09-10'), b('2026-12-10')], 'e1', '2027-03-10')).toContain('2026年7月〜2027年6月で4回目');
    // 6月の支給は前の期間（4月〜3月の年度ではなく、7月〜6月で数える）
    expect(fourthBonusWarning([b('2026-06-10'), b('2026-09-10'), b('2026-12-10')], 'e1', '2027-03-10')).toBeNull();
    expect(fourthBonusWarning([b('2026-07-10', true), b('2026-09-10', true), b('2026-12-10', true)], 'e1', '2027-03-10')).toBeNull();
    // 直している賞与（同じ支給日）は二重に数えない
    expect(fourthBonusWarning([b('2026-07-10'), b('2026-09-10'), b('2026-12-10')], 'e1', '2026-12-10')).toBeNull();
  });

  it('年4回以上の支給になっているのに報酬扱いでない人を出す', () => {
    const b = (employeeId: string, paidDate: string) => ({ employeeId, paidDate, isRemuneration: false });
    const list = [b('e1', '2026-07-10'), b('e1', '2026-09-10'), b('e1', '2026-12-10'), b('e1', '2027-03-10'), b('e2', '2026-07-10'), b('e2', '2026-12-10')];
    expect(fourOrMoreBonuses(list, '2026-12-01')).toEqual([{ employeeId: 'e1', count: 4 }]);
  });

  it('定時決定の上乗せは、前年7月1日〜当年6月30日の報酬扱いの賞与の合計 ÷ 12', () => {
    const list = [
      { employeeId: 'e1', paidDate: '2025-06-30', amount: 120_000, isRemuneration: true },
      ...['2025-07-01', '2025-10-10', '2026-01-10', '2026-04-10'].map((paidDate) => ({ employeeId: 'e1', paidDate, amount: 120_000, isRemuneration: true })),
      { employeeId: 'e1', paidDate: '2025-12-10', amount: 500_000 },
    ];
    expect(remunerationBonusAddOn(list, 'e1', 2026)).toEqual({ total: 480_000, addOn: 40_000 });
  });

  it('種類の入力チェック', () => {
    expect(checkBonusType({ name: '決算賞与', isRemuneration: false, validFrom: '2026-04' }, ['夏季賞与'])).toEqual({});
    expect(Object.keys(checkBonusType({ name: '夏季賞与', isRemuneration: false, validFrom: '2026-13' }, ['夏季賞与'])).sort()).toEqual(['name', 'validFrom']);
  });
});
