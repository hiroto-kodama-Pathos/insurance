import { deleteImpact, deleteImpactMessage, monthRanges } from './delete-impact';
import { EmployeeData, Masters } from './employee-month';

const masters: Masters = {
  offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};
const base: EmployeeData = {
  id: 'e1',
  birthDate: '1990-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [{ id: 'l1', type: 'maternity', startDate: '2026-06-01', endDate: '2026-08-31', workedDays: null }] as unknown as EmployeeData['leaves'],
  exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
};

describe('履歴の削除の影響', () => {
  it('月の並びを、続く月はまとめて出す', () => {
    expect(monthRanges(['2026-06', '2026-07', '2026-08', '2026-10'])).toBe('2026年6月分〜2026年8月分・2026年10月分');
  });

  it('産前産後休業を削除すると、免除だった月に保険料がかかる。確定済みの月と、削除後の今月の状態を出す', () => {
    const after = { ...base, leaves: [] };
    const i = deleteImpact(base, after, masters, '2026-06', '2026-12', '2026-11', 'combined', { honsha: ['2026-06', '2026-07'] });
    expect(i.months.map((m) => m.yearMonth)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(i.lines).toEqual(['健康保険', '子ども・子育て支援金', '厚生年金']);
    expect(i.closedMonths).toEqual(['2026-06', '2026-07']);
    expect(i.employeeDiff).toBe(3 * (14_775 + 345 + 27_450));
    const msg = deleteImpactMessage(i, '2026-11', '', '届け出た「産前産後休業取得者申出書」は、取消（訂正）の届出が必要です。');
    expect(msg).toContain('影響する月：2026年6月分〜2026年8月分（3か月）');
    expect(msg).toContain('変わる保険料：健康保険・子ども・子育て支援金・厚生年金（本人負担の合計 +127,710円）');
    expect(msg).toContain('そのうち確定済みの月は2か月');
    expect(msg).toContain('産前産後休業取得者申出書');
    expect(msg).toContain('削除後の2026年11月分：健康保険・子ども・子育て支援金・厚生年金がかかる（本人 42,570円）');
  });

  it('保険料が変わらない履歴は、何に使うかを出す', () => {
    const i = deleteImpact(base, { ...base, insuredTypes: [] }, masters, '2026-04', '2026-12', '2026-11', 'combined', {});
    expect(i.months).toEqual([]);
    expect(deleteImpactMessage(i, '2026-11', '被保険者区分は、随時改定・定時決定の支払基礎日数の基準に使います。', '')).toContain(
      '保険料は変わりません。被保険者区分は',
    );
  });
});
