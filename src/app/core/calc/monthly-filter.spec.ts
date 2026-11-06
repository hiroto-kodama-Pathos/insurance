import { EmployeeMonthResult } from './employee-month';
import { ageOn, changeReasons, compareFacts, DEFAULT_CRITERIA, ExtraFilter, matches, RowFacts, SortKey } from './monthly-filter';

const P = (yen: number) => ({ fullSen: BigInt(yen * 200), employeeYen: BigInt(yen), employerSen: BigInt(yen * 100) });
const result = (over: Partial<EmployeeMonthResult> & { yen?: number; care?: 'second' | 'first' | 'none'; exempt?: boolean } = {}): EmployeeMonthResult => ({
  employeeId: 'e1', yearMonth: '2026-10', status: 'ok', officeId: 'honsha', insurerId: 'kyokai',
  standard: { health: 300_000, pension: 300_000 },
  premium: {
    health: P(over.yen ?? 15_000), care: over.care === 'second' ? P(2_000) : null, childSupport: P(300), pension: P(27_000),
    careLabel: over.care ?? 'none', exempt: over.exempt ?? false, missingRates: [],
  },
  rates: null,
  ...over,
});

describe('月次保険料一覧の並び替え・絞り込み', () => {
  it('満年齢は誕生日の前日に加わる', () => {
    expect(ageOn('1986-10-20', '2026-10-18')).toBe(39);
    expect(ageOn('1986-10-20', '2026-10-19')).toBe(40);
    expect(ageOn('1986-11-01', '2026-10-31')).toBe(40);
    expect(ageOn('', '2026-10-31')).toBeNull();
  });

  it('前月から変わった理由', () => {
    expect(changeReasons(result(), result())).toEqual([]);
    expect(changeReasons(null, result())).toEqual(['入社・資格取得']);
    // 前月は標準報酬月額がなく計算していない（導入時の登録で、この月から登録した人）：「料率の改定」などと誤って出さない
    expect(changeReasons(result({ status: 'noStandard', standard: null, premium: null }), result())).toEqual(['標準報酬月額の登録']);
    expect(changeReasons(result(), result({ standard: { health: 360_000, pension: 360_000 }, yen: 18_000 }))).toEqual(['標準報酬月額の改定']);
    expect(changeReasons(result(), result({ care: 'second' }))).toEqual(['介護保険（40歳など）']);
    expect(changeReasons(result(), result({ exempt: true, yen: 0 }))).toContain('休業免除の開始');
    expect(changeReasons(result(), result({ officeId: 'osaka' }))).toEqual(['異動']);
  });

  const facts = (over: Partial<RowFacts>): RowFacts => ({
    id: 'e1', employeeNumber: '0001', name: '山田 太郎', officeId: 'honsha', officeName: '本社', insurerId: 'kyokai',
    standard: 300_000, employeeTotal: 40_000, employerSen: 4_000_000, age: 46, diff: 0, reasons: [], alerts: [],
    exempt: false, careFirst: false, exemption: false, joined: false, left: false, ...over,
  });

  it('氏名・社員番号の検索（空白は無視）、事業所・保険者・条件で絞り込む', () => {
    const f = facts({});
    expect(matches(f, { ...DEFAULT_CRITERIA, query: '山田太郎' })).toBe(true);
    expect(matches(f, { ...DEFAULT_CRITERIA, query: '0001' })).toBe(true);
    expect(matches(f, { ...DEFAULT_CRITERIA, query: '０００１' })).toBe(true); // 全角の数字でも見つかる
    expect(matches(f, { ...DEFAULT_CRITERIA, query: '佐藤' })).toBe(false);
    expect(matches(f, { ...DEFAULT_CRITERIA, officeId: 'osaka' })).toBe(false);
    expect(matches(f, { ...DEFAULT_CRITERIA, insurerId: 'kumiai' })).toBe(false);
    expect(matches(f, { ...DEFAULT_CRITERIA, extra: 'changed' })).toBe(false);
    expect(matches(facts({ reasons: ['異動'] }), { ...DEFAULT_CRITERIA, extra: 'changed' })).toBe(true);
    expect(matches(facts({ joined: true }), { ...DEFAULT_CRITERIA, extra: 'joined' })).toBe(true);
  });

  it('並び替え（同じ値は社員番号順。逆順にもできる）', () => {
    const list = [facts({ employeeNumber: '0002', employeeTotal: 50_000 }), facts({ employeeNumber: '0001', employeeTotal: 50_000 }), facts({ employeeNumber: '0003', employeeTotal: 10_000 })];
    expect([...list].sort((a, b) => compareFacts(a, b, 'employeeTotal', true)).map((f) => f.employeeNumber)).toEqual(['0001', '0002', '0003']);
    expect([...list].sort((a, b) => compareFacts(a, b, 'employeeTotal', false)).map((f) => f.employeeNumber)).toEqual(['0003', '0001', '0002']);
  });
});

// ---- 漏れていた分岐：前月から変わった理由と、絞り込み・並び替えの残り ----
describe('前月から変わった理由（毎月の確認に使う）', () => {
  /** 保険料の欄を差し替えた結果 */
  const withPremium = (over: Partial<NonNullable<EmployeeMonthResult['premium']>>, yen = 15_000) => {
    const r = result({ yen });
    return { ...r, premium: { ...r.premium!, ...over } };
  };

  it('前月に資格がない（未加入）なら「入社・資格取得」。今月も保険料がなければ理由なし', () => {
    expect(changeReasons(result({ status: 'notInsured', premium: null }), result())).toEqual(['入社・資格取得']);
    expect(changeReasons(null, result({ status: 'notInsured', premium: null }))).toEqual([]);
  });

  it('休業免除の終了', () => {
    expect(changeReasons(result({ exempt: true, yen: 0 }), result())).toContain('休業免除の終了');
  });

  it('介護保険の区分：65歳で第1号、40歳未満に戻る（特定被保険者の終了など）', () => {
    expect(changeReasons(result({ care: 'second' }), withPremium({ care: null, careLabel: 'first' }))).toContain('介護保険（65歳）');
    expect(changeReasons(result({ care: 'second' }), withPremium({ care: null, careLabel: 'none' }))).toContain('介護保険（対象外）');
  });

  it('厚生年金・健康保険・支援金の開始と終了', () => {
    expect(changeReasons(result(), withPremium({ pension: null }))).toContain('厚生年金の終了（70歳など）');
    expect(changeReasons(withPremium({ pension: null }), result())).toContain('厚生年金の開始');
    expect(changeReasons(result(), withPremium({ health: null, childSupport: null }))).toEqual(
      expect.arrayContaining(['健康保険の終了（75歳など）', '子ども・子育て支援金']),
    );
    expect(changeReasons(withPremium({ health: null }), result())).toContain('健康保険の開始');
  });

  it('ほかの理由がなく料率だけが変わったら「料率の改定」、何も分からなければ「その他」', () => {
    const rates = (rate: number) => ({ health: { rate, share: 500 }, care: null, childSupport: null, pension: { rate: 18300, share: 500 } });
    expect(changeReasons(result({ rates: rates(9850) }), result({ rates: rates(9910), yen: 15_100 }))).toEqual(['料率の改定']);
    expect(changeReasons(result(), result({ yen: 14_000 }))).toEqual(['その他（適用除外・按分など）']);
  });

  it('保険料の計算がない月どうし（前月・今月とも計算できない）でも落ちない', () => {
    expect(changeReasons(result({ premium: null, status: 'noStandard' }), result({ premium: null, status: 'noStandard', officeId: 'osaka' }))).toEqual(['異動']);
  });
});

describe('月次保険料一覧の絞り込み・並び替え（残りの条件）', () => {
  const facts = (over: Partial<RowFacts>): RowFacts => ({
    id: 'e1', employeeNumber: '0001', name: '山田 太郎', officeId: 'honsha', officeName: '本社', insurerId: 'kyokai',
    standard: 300_000, employeeTotal: 40_000, employerSen: 4_000_000, age: 46, diff: 0, reasons: [], alerts: [],
    exempt: false, careFirst: false, exemption: false, joined: false, left: false, ...over,
  });

  it.each([
    ['alert', { alerts: ['65歳到達'] }],
    ['exempt', { exempt: true }],
    ['careFirst', { careFirst: true }],
    ['exemption', { exemption: true }],
    ['left', { left: true }],
  ] as [ExtraFilter, Partial<RowFacts>][])('「%s」：当てはまる人だけを出す', (extra, over) => {
    expect(matches(facts({}), { ...DEFAULT_CRITERIA, extra })).toBe(false);
    expect(matches(facts(over), { ...DEFAULT_CRITERIA, extra })).toBe(true);
  });

  it.each([
    ['office', { officeName: '本社' }, { officeName: '大阪支店' }], // 事業所名は文字の順（大阪支店 → 本社）
    ['standard', { standard: 410_000 }, { standard: 300_000 }],
    ['employerTotal', { employerSen: 5_000_000 }, { employerSen: 4_000_000 }],
    ['age', { age: 60 }, { age: 30 }],
    ['diff', { diff: 1_200 }, { diff: -300 }],
  ] as [SortKey, Partial<RowFacts>, Partial<RowFacts>][])('「%s」で並べる（小さい順・大きい順）', (key, big, small) => {
    const a = facts({ employeeNumber: '0001', ...big });
    const b = facts({ employeeNumber: '0002', ...small });
    expect([a, b].sort((x, y) => compareFacts(x, y, key, false)).map((f) => f.employeeNumber)).toEqual(['0002', '0001']);
    expect([a, b].sort((x, y) => compareFacts(x, y, key, true)).map((f) => f.employeeNumber)).toEqual(['0001', '0002']);
  });

  it('年齢・前月との差がない人（不明・前月なし）は、年齢は -1、差は 0 として並べる', () => {
    const unknown = facts({ employeeNumber: '0002', age: null, diff: null });
    const young = facts({ employeeNumber: '0001', age: 20, diff: -1 });
    expect([young, unknown].sort((x, y) => compareFacts(x, y, 'age', false)).map((f) => f.employeeNumber)).toEqual(['0002', '0001']);
    expect([unknown, young].sort((x, y) => compareFacts(x, y, 'diff', false)).map((f) => f.employeeNumber)).toEqual(['0001', '0002']);
  });
});
