import { parseCsv } from './csv';
import {
  buildDecisionPreview, DECISION_TEMPLATE_HEADERS, DECISION_TEMPLATE_MAPPING, DecisionEmployee, DecisionExpectation,
  decisionTemplateCsv, missingDecisionColumns, parseStandardLoose, parseYearMonthLoose,
} from './decision-import';

const employees: DecisionEmployee[] = [
  { id: 'e1', employeeNumber: '0001', name: '山田 太郎', birthDate: '1980-05-10', standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }] },
  {
    id: 'e2', employeeNumber: '0002', name: '佐藤 花子', birthDate: '1995-08-20',
    standardHistory: [
      { validFrom: '2024-04', healthStandard: 260_000, pensionStandard: 260_000 },
      { id: 's2', validFrom: '2026-11', healthStandard: 280_000, pensionStandard: 280_000, provisional: true },
    ],
  },
  { id: 'e3', employeeNumber: '0003', name: '鈴木 一郎', birthDate: '1961-01-15', standardHistory: [{ validFrom: '2026-09', healthStandard: 410_000, pensionStandard: 410_000 }] },
];
const expectations: DecisionExpectation[] = [
  { employeeId: 'e1', validFrom: '2026-11', healthStandard: 360_000, pensionStandard: 360_000, reason: 'revision' },
  { employeeId: 'e2', validFrom: '2026-11', healthStandard: 280_000, pensionStandard: 280_000, reason: 'revision' },
];
const csv = (lines: string[]) => parseCsv([DECISION_TEMPLATE_HEADERS.join(','), ...lines].join('\n'));

describe('決定通知書の読み取り', () => {
  it('年月は西暦・和暦・日付のどれでも読める', () => {
    expect(parseYearMonthLoose('2026-09')).toBe('2026-09');
    expect(parseYearMonthLoose('2026/9')).toBe('2026-09');
    expect(parseYearMonthLoose('202609')).toBe('2026-09');
    expect(parseYearMonthLoose('令和8年9月')).toBe('2026-09');
    expect(parseYearMonthLoose('R8.9')).toBe('2026-09');
    expect(parseYearMonthLoose('2026-09-01')).toBe('2026-09');
    expect(parseYearMonthLoose('2026-13')).toBeNull();
    expect(parseYearMonthLoose('abc')).toBeNull();
  });

  it('標準報酬月額は千円単位でも円でも読める', () => {
    expect(parseStandardLoose('360')).toBe(360_000);
    expect(parseStandardLoose('360千円')).toBe(360_000);
    expect(parseStandardLoose('360,000')).toBe(360_000);
    expect(parseStandardLoose('')).toBeNull();
    expect(parseStandardLoose('abc')).toBeNaN();
  });

  it('社員番号か、氏名と生年月日の列が必要', () => {
    expect(missingDecisionColumns(DECISION_TEMPLATE_MAPPING, DECISION_TEMPLATE_HEADERS)).toEqual([]);
    expect(missingDecisionColumns({ ...DECISION_TEMPLATE_MAPPING, employeeNumber: '', birthDate: '' }, DECISION_TEMPLATE_HEADERS)[0]).toContain('社員番号か');
    expect(decisionTemplateCsv()).toContain('適用年月');
  });
});

describe('buildDecisionPreview', () => {
  it('新しく登録・通知書待ちの確定・同じ値の登録済みを見分け、見込みと違う人に印を付ける', () => {
    const p = buildDecisionPreview(
      csv(['0001,,,2026-11,380,380', '0002,,,2026-11,280,280', '0003,,,2026-09,410,410']),
      DECISION_TEMPLATE_MAPPING, employees, expectations,
    );
    expect(p.map((r) => r.status)).toEqual(['new', 'confirm', 'same']);
    expect(p[0].save).toEqual({ employeeId: 'e1', validFrom: '2026-11', reason: 'revision', healthStandard: 380_000, pensionStandard: 380_000, provisionalId: null });
    expect(p[0].differs).toBe(true);
    expect(p[1].save?.provisionalId).toBe('s2');
    expect(p[1].differs).toBe(false);
  });

  it('社員番号がなければ氏名（空白の違いは無視）と生年月日で照合する。9月分は定時決定にする', () => {
    const p = buildDecisionPreview(csv([',山田　太郎,昭和55年5月10日,2026-09,320,320', ',山田 太郎,1980-05-10,R8.9,320,320']), DECISION_TEMPLATE_MAPPING, employees, []);
    // 昭和の生年月日も読める。2行目は同じ人・同じ適用年月なので重複
    expect(p[0].status).toBe('new');
    expect(p[0].save?.reason).toBe('regular');
    expect(p[1].errors[0]).toContain('2つ以上');
  });

  it('厚生年金の欄が空なら、見込み・今の値を使う（70歳以上など）', () => {
    const p = buildDecisionPreview(csv(['0001,,,2026-11,380,']), DECISION_TEMPLATE_MAPPING, employees, expectations);
    expect(p[0].save?.pensionStandard).toBe(360_000);
  });

  it('照合できない人・読めない値・値の違う登録済みの履歴・ファイル内の重複はエラー', () => {
    const p = buildDecisionPreview(
      csv(['0009,,,2026-11,380,380', '0001,,,2026年13月,380,380', '0001,,,2026-11,abc,380', '0003,,,2026-09,440,440', '0001,,,2026-12,300,300', '0001,,,2026-12,300,300']),
      DECISION_TEMPLATE_MAPPING, employees, expectations,
    );
    expect(p.map((r) => r.status)).toEqual(['error', 'error', 'error', 'error', 'new', 'error']);
    expect(p[0].errors[0]).toContain('照合できません');
    expect(p[3].errors[0]).toContain('値が違います');
    expect(p[5].errors[0]).toContain('2つ以上');
  });
});
