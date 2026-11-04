import { EmployeeMonthResult } from './employee-month';
import { employerAmounts, monthRange, periodCsv, periodTotals } from './period-total';

// 全額（銭）と本人負担（円）から結果を作る
const P = (fullSen: number, employeeYen: number) => ({ fullSen: BigInt(fullSen), employeeYen: BigInt(employeeYen), employerSen: BigInt(fullSen - employeeYen * 100) });
const r = (office: string, care = false): EmployeeMonthResult => ({
  employeeId: 'e', yearMonth: '2026-10', status: 'ok', officeId: office, insurerId: 'kyokai',
  standard: { health: 300_000, pension: 300_000 },
  premium: {
    health: P(2_955_000, 14_775), care: care ? P(486_000, 2_430) : null, childSupport: P(69_000, 345), pension: P(5_490_000, 27_450),
    careLabel: care ? 'second' : 'none', exempt: false, missingRates: [],
  },
  rates: null,
});

describe('期間ごとの会社負担の集計', () => {
  it('月の範囲', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2026-11', '2026-10')).toEqual([]);
  });

  it('保険別の会社負担（介護保険は健康保険の欄から分け、合計は変わらない）', () => {
    const a = employerAmounts('2026-10', [r('honsha'), r('honsha', true)]);
    expect(a.care).toBe(2_430);
    expect(a.health).toBe(14_775 * 2);
    expect(a.childSupport).toBe(345 * 2);
    expect(a.pension).toBe(27_450 * 2);
    expect(a.total).toBe(a.health + a.care + a.childSupport + a.pension);
  });

  it('月額と賞与を分け、月ごとと期間の合計を出す。事業所で絞り込める', () => {
    const res = periodTotals([
      { yearMonth: '2026-10', monthly: [r('honsha'), r('osaka')], bonus: [], includesUnclosed: false },
      { yearMonth: '2026-11', monthly: [r('honsha')], bonus: [r('honsha')], includesUnclosed: true },
    ]);
    expect(res.rows[0].total.total).toBe(2 * (14_775 + 345 + 27_450));
    expect(res.rows[1].bonus.total).toBe(14_775 + 345 + 27_450);
    expect(res.total.total.total).toBe(4 * (14_775 + 345 + 27_450));
    expect(res.total.includesUnclosed).toBe(true);
    expect(periodTotals([{ yearMonth: '2026-10', monthly: [r('honsha'), r('osaka')], bonus: [], includesUnclosed: false }], 'osaka').total.monthly.total).toBe(14_775 + 345 + 27_450);
    const csv = periodCsv(res);
    expect(csv.split('\r\n')[0]).toContain('月,区分,健康保険,介護保険');
    expect(csv).toContain('2026-11,賞与,14775,0,345,27450,42570,未確定を含む');
  });
});
