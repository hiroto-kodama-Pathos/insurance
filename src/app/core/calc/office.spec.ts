import { monthEnd } from './date';
import { Assignment, defaultOfficeId, findOffice, monthlyBaseDate, Office } from './office';

const offices: Office[] = [
  { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
  { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
];

const transferred: Assignment[] = [
  { validFrom: '2024-04-01', officeId: 'honsha' },
  { validFrom: '2026-10-15', officeId: 'osaka' },
];

describe('所属事業所の判定', () => {
  it('異動のない人は入社事業所', () => {
    const a: Assignment[] = [{ validFrom: '2024-04-01', officeId: 'honsha' }];
    expect(findOffice(a, offices, '2026-10-31').id).toBe('honsha');
  });

  it('異動日の前日は元の事業所', () => {
    expect(findOffice(transferred, offices, '2026-10-14').id).toBe('honsha');
  });

  it('異動日当日は新しい事業所', () => {
    expect(findOffice(transferred, offices, '2026-10-15').id).toBe('osaka');
  });

  it('月額は月末時点の事業所（10月15日異動の10月分は大阪）', () => {
    expect(findOffice(transferred, offices, monthlyBaseDate('2026-10')).id).toBe('osaka');
  });

  it('月末に異動しても、その月は新しい事業所', () => {
    const a: Assignment[] = [
      { validFrom: '2024-04-01', officeId: 'honsha' },
      { validFrom: '2026-10-31', officeId: 'osaka' },
    ];
    expect(findOffice(a, offices, monthlyBaseDate('2026-10')).id).toBe('osaka');
  });

  it('履歴の順番が日付順でなくても正しく選ぶ', () => {
    const reversed = [...transferred].reverse();
    expect(findOffice(reversed, offices, '2026-11-01').id).toBe('osaka');
  });

  it('入社前の日付はエラー', () => {
    expect(() => findOffice(transferred, offices, '2024-03-31')).toThrow();
  });

  it('事業所が一覧にないときはエラー', () => {
    const a: Assignment[] = [{ validFrom: '2024-04-01', officeId: 'nagoya' }];
    expect(() => findOffice(a, offices, '2026-10-31')).toThrow();
  });
});

describe('対象月の末日', () => {
  it('うるう年と平年の2月', () => {
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
  });

  it('30日の月と31日の月', () => {
    expect(monthEnd('2026-11')).toBe('2026-11-30');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});
describe('新規登録で初めから選ぶ事業所', () => {
  it('事業所が1つだけなら、それを選ぶ', () => {
    expect(defaultOfficeId([offices[0]])).toBe('honsha');
  });

  it('複数あるときは、デフォルトに設定した事業所を選ぶ', () => {
    expect(defaultOfficeId([offices[0], { ...offices[1], isDefault: true }])).toBe('osaka');
  });

  it('複数あってデフォルトがなければ、選ばない', () => {
    expect(defaultOfficeId(offices)).toBe('');
  });
});
