import { parseCsv } from './csv';
import { buildPreview, findByNumber, ImportEmployee, mappingConflicts, missingColumns, PreviewContext, SalaryMapping, TEMPLATE_HEADERS, TEMPLATE_MAPPING, templateCsv } from './salary-import';

const employees: ImportEmployee[] = [
  { id: 'e1', employeeNumber: '0001', name: '山田 太郎', assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }] },
  { id: 'e2', employeeNumber: '0002', name: '佐藤 花子', assignments: [{ validFrom: '2024-04-01', officeId: 'osaka' }] },
];
const offices = [
  { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
  { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
];
const ctx = (over: Partial<PreviewContext> = {}): PreviewContext => ({
  employees, offices, closed: new Set(), existingIds: new Set(), scope: 'all', ...over,
});

// 給与ソフトの出力の例（列名がアプリと違い、手当が別々の列）
const SOFT_CSV = [
  '従業員コード,氏名,支給日,出勤日数,基本給,役職手当,通勤手当,残業手当,深夜手当',
  '1,山田 太郎,2026/10/25,31,"300,000","20,000","15,000","18,000","2,000"',
  '0002,佐藤 花子,R8.10.25,30,250000,0,10000,0,0',
].join('\r\n');
const SOFT_MAPPING: SalaryMapping = {
  employeeNumber: '従業員コード',
  paidDate: '支給日',
  paymentBaseDays: '出勤日数',
  fixedWages: ['基本給', '役職手当', '通勤手当'],
  nonFixedWages: ['残業手当', '深夜手当'],
  retroactiveDiff: '',
  inKindWages: '',
};

describe('findByNumber', () => {
  it('先頭の0が消えた社員番号も、登録済みの桁数にそろえて照合する', () => {
    expect(findByNumber(employees, '1')?.id).toBe('e1');
    expect(findByNumber(employees, '0002')?.id).toBe('e2');
    expect(findByNumber(employees, '9')).toBeNull();
  });
});

describe('buildPreview', () => {
  it('複数の列を合計し、日付と金額の書き方の違いをそろえる', () => {
    const p = buildPreview(parseCsv(SOFT_CSV), SOFT_MAPPING, ctx());
    expect(p.map((r) => r.status)).toEqual(['new', 'new']);
    expect(p[0].salary).toEqual({
      employeeId: 'e1', paidDate: '2026-10-25', fixedWages: 335_000, nonFixedWages: 20_000,
      paymentBaseDays: 31, retroactiveDiff: null, inKindWages: null, workingHours: null, hourlyRate: null, excludedAmount: null,
    });
    expect(p[1].salary!.paidDate).toBe('2026-10-25');
    expect(p[1].officeId).toBe('osaka');
  });

  it('登録されていない社員番号・読めない日付・数値でない金額はエラー行にする', () => {
    const csv = [TEMPLATE_HEADERS.join(','), '0009,2026-10-25,31,300000,0,,', '0001,10月25日,31,300000,0,,', '0002,2026-10-25,31,abc,0,,'].join('\n');
    const p = buildPreview(parseCsv(csv), TEMPLATE_MAPPING, ctx());
    expect(p.map((r) => r.status)).toEqual(['error', 'error', 'error']);
    expect(p[0].errors[0]).toContain('登録されていない社員番号');
    expect(p[0].line).toBe(2);
    expect(p[1].errors[0]).toContain('支払日を読み取れません');
    expect(p[2].errors[0]).toContain('数値として読み取れません');
  });

  it('登録済みは上書き、確定済みの月・担当範囲外は取り込まない', () => {
    const csv = parseCsv(templateCsv() + '0002,2026-10-25,30,250000,0,,\r\n');
    expect(buildPreview(csv, TEMPLATE_MAPPING, ctx({ existingIds: new Set(['e1_2026-10-25']) }))[0].status).toBe('overwrite');
    expect(buildPreview(csv, TEMPLATE_MAPPING, ctx({ closed: new Set(['2026-10|honsha']) })).map((r) => r.status)).toEqual(['closed', 'new']);
    expect(buildPreview(csv, TEMPLATE_MAPPING, ctx({ scope: 'osaka' })).map((r) => r.status)).toEqual(['outOfScope', 'new']);
  });

  it('労働時間の列があれば取り込む（時:分も読める。読めなければエラー）', () => {
    const csv = parseCsv(templateCsv() + '0002,2026-10-25,20,120000,0,,,86:30,1200\r\n0003,2026-10-25,20,120000,0,,,abc,\r\n');
    const p = buildPreview(csv, TEMPLATE_MAPPING, ctx());
    expect(p[0].salary?.workingHours).toBeNull();
    expect(p[1].salary?.workingHours).toBe(86.5);
    expect(p[1].salary?.hourlyRate).toBe(1200);
    expect(p[2].errors).toContain('労働時間を数値として読み取れません');
  });

  it('同じ社員番号・支払日の行が2つあればエラーにする', () => {
    const csv = parseCsv(templateCsv() + '1,2026/10/25,31,340000,0,,\r\n');
    expect(buildPreview(csv, TEMPLATE_MAPPING, ctx())[1].errors[0]).toContain('2つ以上');
  });
});

describe('missingColumns', () => {
  it('CSVにない列名と、未設定の必須項目を返す', () => {
    expect(missingColumns(SOFT_MAPPING, parseCsv(SOFT_CSV)[0])).toEqual([]);
    expect(missingColumns(TEMPLATE_MAPPING, parseCsv(SOFT_CSV)[0])).toContain('社員番号');
    expect(missingColumns({ ...SOFT_MAPPING, fixedWages: [] }, parseCsv(SOFT_CSV)[0])[0]).toBe('（必須の項目が未設定）');
  });
});

describe('算定から除く額（支払月・締め日の変更月）', () => {
  const head = [...TEMPLATE_HEADERS, '算定から除く額'].join(',');
  const rows = (lines: string[]) => parseCsv([head, ...lines].join('\n'));
  const ctx2 = (need: boolean) => ({
    employees: [{ id: 'e1', employeeNumber: '0001', name: '山田', assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }] }],
    offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
    closed: new Set<string>(), existingIds: new Set<string>(), scope: 'all',
    needsExclusion: (_id: string, ym: string) => need && ym === '2026-10',
  });

  it('除く額が要る月の行は、額（0を含む）がなければ取り込まない', () => {
    const empty = buildPreview(rows(['0001,2026-10-25,31,340000,20000,,,,,']), TEMPLATE_MAPPING, ctx2(true));
    expect(empty[0].status).toBe('error');
    expect(empty[0].errors.join()).toContain('10月は支払月・締め日の変更月のため、算定から除く額が要ります');
    const zero = buildPreview(rows(['0001,2026-10-25,31,340000,20000,,,,,0']), TEMPLATE_MAPPING, ctx2(true));
    expect(zero[0].status).toBe('new');
    expect(zero[0].salary?.excludedAmount).toBe(0);
  });

  it('同じ人・同じ月の行のどれかに額があればよい。除く額が要らない月は、入っていても残さない', () => {
    const two = buildPreview(rows(['0001,2026-10-10,31,170000,0,,,,,50000', '0001,2026-10-25,31,170000,0,,,,,']), TEMPLATE_MAPPING, ctx2(true));
    expect(two.map((r) => r.status)).toEqual(['new', 'new']);
    const notNeeded = buildPreview(rows(['0001,2026-10-25,31,340000,20000,,,,,5000']), TEMPLATE_MAPPING, ctx2(false));
    expect(notNeeded[0].salary?.excludedAmount).toBeNull();
  });

  it('前のテンプレート（算定から除く額の列なし）も、テンプレートの形式として読める', () => {
    expect(missingColumns(TEMPLATE_MAPPING, TEMPLATE_HEADERS)).toEqual([]);
  });
});

describe('給与のCSV：空欄・桁の多すぎる金額・対応づけの矛盾（設計書 3.8）', () => {
  const H = TEMPLATE_HEADERS.join(',');
  const one = (line: string) => buildPreview(parseCsv(`${H}\r\n${line}\r\n`), TEMPLATE_MAPPING, ctx())[0];

  it('固定的賃金が空欄ならエラー。「0」と入っていれば0円として取り込む（画面と同じ）', () => {
    const blank = one('0001,2026-10-25,31,,20000,,,,');
    expect(blank.status).toBe('error');
    expect(blank.errors[0]).toContain('固定的賃金が空欄です');
    const zero = one('0001,2026-10-25,31,0,20000,,,,');
    expect(zero.status).toBe('new');
    expect(zero.salary!.fixedWages).toBe(0);
  });

  it('複数の列を合計する固定的賃金も、すべて空欄ならエラー（どれかに額があれば取り込む）', () => {
    const csv = (base: string, allow: string) => parseCsv(`従業員コード,支給日,出勤日数,基本給,役職手当\r\n1,2026/10/25,31,${base},${allow}\r\n`);
    const m = { ...SOFT_MAPPING, fixedWages: ['基本給', '役職手当'], nonFixedWages: [] };
    expect(buildPreview(csv('', ''), m, ctx())[0].errors[0]).toContain('「基本給」「役職手当」がすべて空欄');
    expect(buildPreview(csv('', '20000'), m, ctx())[0].salary!.fixedWages).toBe(20_000);
  });

  it('桁の多すぎる金額・1億円以上は取り込まない（正しく扱えない数・打ち間違い）', () => {
    expect(one('0001,2026-10-25,31,9007199254740993,0,,,,').errors).toContain('固定的賃金の「固定的賃金」を数値として読み取れません');
    expect(one('0001,2026-10-25,31,100000000,0,,,,').errors[0]).toContain('99,999,999円以下');
    expect(one('0001,2026-10-25,31,1e6,0,,,,').status).toBe('error');
  });

  it('同じ列を固定的賃金と非固定的賃金の両方に選んだら矛盾として返す', () => {
    expect(mappingConflicts({ ...SOFT_MAPPING, nonFixedWages: ['残業手当', '基本給'] })).toEqual([
      '「基本給」の列を、固定的賃金と非固定的賃金の両方に選んでいます（どちらか一方にしてください）',
    ]);
    expect(mappingConflicts(SOFT_MAPPING)).toEqual([]);
  });

  it('月の途中で異動した人の給与は、支払日に所属している事業所にする', () => {
    const moved = [{ id: 'e1', employeeNumber: '0001', name: '山田 太郎', assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-11-15', officeId: 'osaka' }] }];
    const r = buildPreview(parseCsv(`${H}\r\n0001,2026-11-25,30,300000,0,,,,\r\n0001,2026-11-10,30,1000,0,,,,\r\n`), TEMPLATE_MAPPING, ctx({ employees: moved }));
    expect(r.map((x) => x.officeId)).toEqual(['osaka', 'honsha']);
  });
});
