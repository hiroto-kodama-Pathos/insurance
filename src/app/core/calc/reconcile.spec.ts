import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import { summarizeMonth } from './monthly-summary';
import {
  buildDeductionPreview,
  compareDeduction,
  compareNotice,
  deductionCauses,
  detectDeductionColumns,
  employeeDeduction,
  expectedPayments,
  noticeCauses,
} from './reconcile';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '東京都', insurerId: 'kyokai' },
  ],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

const person = (id: string, office: string, extra: Partial<EmployeeData> = {}): EmployeeData & { id: string } => ({
  id,
  birthDate: '1990-01-01',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [],
  exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: office }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
  ...extra,
});

const calc = (e: EmployeeData & { id: string }, ym: string) => calcEmployeeMonth(e, masters, ym, 'combined');

describe('納付書との照合', () => {
  const e1 = person('e1', 'honsha');
  const e2 = person('e2', 'osaka');
  const results = [calc(e1, '2026-10'), calc(e2, '2026-10')];
  const exp = expectedPayments(summarizeMonth('2026-10', results), summarizeMonth('2026-10', []));

  it('適用事業所ごとの納付見込額（月額と賞与の合計）', () => {
    // 標準報酬月額30万円：健保29,550・支援金690・厚年54,900（全額）
    expect(exp.get('honsha')!.total).toEqual({ healthCare: 29_550, childSupport: 690, pension: 54_900 });
    expect(exp.get('osaka')!.monthly.pension).toBe(54_900);
  });

  it('納付書の金額との差を欄ごとに出す', () => {
    const c = compareNotice('honsha', exp.get('honsha'), { healthCare: 29_650, childSupport: 690, pension: 54_900 });
    expect(c.status).toBe('diff');
    expect(c.diff!.healthCare).toBe(100);
    expect(c.diffTotal).toBe(100);
    expect(compareNotice('honsha', exp.get('honsha'), exp.get('honsha')!.total).status).toBe('match');
    expect(compareNotice('honsha', exp.get('honsha'), null).status).toBe('notEntered');
  });

  it('原因の候補に、前月から変わった人と賞与を支給した人を並べる', () => {
    const raised = person('e3', 'honsha', {
      standardHistory: [
        { validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 },
        { validFrom: '2026-10', healthStandard: 360_000, pensionStandard: 360_000 },
      ],
    });
    const left = person('e4', 'honsha', { qualifications: [{ acquiredDate: '2024-04-01', lostDate: '2026-10-01' }] });
    const inputs = [e1, e2, raised, left].map((e) => ({
      employeeId: e.id, label: e.id, prev: calc(e, '2026-09'), cur: calc(e, '2026-10'), provisional: false,
    }));
    const causes = noticeCauses('honsha', inputs, [{ employeeId: 'e1', label: 'e1', officeId: 'honsha', amount: 500_000 }]);
    expect(causes.map((c) => c.employeeId)).toEqual(['e1', 'e3', 'e4']);
    expect(causes[0].reasons).toEqual(['賞与の支給（500,000円）']);
    expect(causes[1].reasons).toContain('標準報酬月額の改定');
    expect(causes[2].reasons[0]).toContain('退職・資格喪失');
    // 大阪支店の人は本社の候補に入らない
    expect(noticeCauses('osaka', inputs, [])).toEqual([]);
  });
});

describe('給与の控除額との照合', () => {
  const e1 = person('e1', 'honsha');
  const r = calc(e1, '2026-10');
  const input = { employeeId: 'e1', label: 'e1', prev: calc(e1, '2026-09'), cur: r, provisional: false };

  it('本人負担を、給与ソフトと同じ区切り（健康保険は介護保険を含む）で出す', () => {
    expect(employeeDeduction(r)).toEqual({ health: 14_775, childSupport: 345, pension: 27_450 });
    const care = calc(person('c', 'honsha', { birthDate: '1980-01-01' }), '2026-10');
    // 介護保険（30万円×1.62%÷2＝2,430）を健康保険に足す
    expect(employeeDeduction(care).health).toBe(14_775 + 2_430);
  });

  it('差と原因の候補', () => {
    const exp = employeeDeduction(r);
    const same = compareDeduction(exp, { ...exp });
    expect(same.status).toBe('match');
    expect(deductionCauses(same, input, 0)).toEqual([]);

    const settled = compareDeduction(exp, { ...exp, pension: exp.pension + 2_000 });
    expect(settled.diffTotal).toBe(2_000);
    expect(deductionCauses(settled, input, 2_000)[0]).toContain('精算した差額（+2,000円）');

    const split = compareDeduction(exp, { ...exp, health: exp.health + 1, childSupport: exp.childSupport - 1 });
    expect(deductionCauses(split, input, 0)[0]).toContain('支援金の端数処理');

    const other = compareDeduction(exp, { ...exp, health: exp.health + 500 });
    expect(deductionCauses(other, input, 0)[0]).toContain('給与ソフトの標準報酬月額');
    expect(compareDeduction(exp, null).status).toBe('notEntered');
  });
});

describe('給与の控除額のCSV', () => {
  const employees = [
    { id: 'e1', employeeNumber: '0001', name: '山田', assignments: [] },
    { id: 'e2', employeeNumber: '0002', name: '佐藤', assignments: [] },
    { id: 'e3', employeeNumber: '0003', name: '大阪', assignments: [] },
  ];
  const allowed = new Set(['e1', 'e2']);

  it('見出しを言葉で探す（会社負担の列は使わない・介護保険の列は健康保険に足す）', () => {
    const cols = detectDeductionColumns(['従業員番号', '健康保険料（会社）', '健康保険料', '介護保険料', '厚生年金保険料', '子ども・子育て支援金']);
    expect(cols).toEqual({ employeeNumber: 0, health: 2, care: 3, childSupport: 5, pension: 4 });
    expect(detectDeductionColumns(['社員番号', '金額'])).toContain('健康保険');
  });

  it('取り込む内容とエラー行', () => {
    const rows = buildDeductionPreview(
      [
        ['社員番号', '健康保険', '介護保険', '厚生年金'],
        ['1', '14,775', '2,430', '27450'],
        ['0002', '14775', '', 'abc'],
        ['0003', '1', '0', '1'],
        ['9999', '1', '0', '1'],
        ['', '', '', ''],
      ],
      employees,
      allowed,
    );
    if (typeof rows === 'string') throw new Error(rows);
    expect(rows).toHaveLength(4);
    expect(rows[0].amounts).toEqual({ health: 17_205, childSupport: 0, pension: 27_450 });
    expect(rows[0].label).toBe('0001 山田');
    expect(rows[1].errors).toEqual(['厚生年金を読み取れません（abc）']);
    expect(rows[2].errors).toEqual(['担当範囲の外の従業員です']);
    expect(rows[3].errors[0]).toContain('9999');
  });
});
