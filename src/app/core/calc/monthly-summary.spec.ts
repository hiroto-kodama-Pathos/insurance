import { EmployeeMonthResult } from './employee-month';
import { MonthlyPremium } from './monthly-premium';
import { summarizeMonth } from './monthly-summary';
import { PremiumResult } from './premium-calculator';

function p(fullSen: bigint, employeeYen: bigint): PremiumResult {
  return { fullSen, employeeYen, employerSen: fullSen - employeeYen * 100n };
}

function result(
  id: string,
  officeId: string,
  premium: Partial<MonthlyPremium>,
  status: EmployeeMonthResult['status'] = 'ok',
): EmployeeMonthResult {
  return {
    employeeId: id,
    yearMonth: '2026-10',
    status,
    officeId,
    insurerId: 'kyokai',
    standard: { health: 0, pension: 0 },
    premium: {
      health: null,
      care: null,
      childSupport: null,
      pension: null,
      careLabel: 'none',
      exempt: false,
      missingRates: [],
      ...premium,
    },
    rates: null,
  };
}

describe('月次の小計と会社合計', () => {
  it('健保と介護は、納付書の健康保険の欄として合わせて切り捨てる', () => {
    const s = summarizeMonth('2026-10', [
      result('a', 'honsha', { health: p(100_030n, 500n), care: p(20_040n, 100n) }),
    ]);
    const hc = s.offices[0].lines.healthCare;
    expect(hc.paymentYen).toBe(1_200n); // 1,200.70円 → 1,200円
    expect(hc.employeeTotal).toBe(600n);
    expect(hc.employerTotal).toBe(600n);
  });

  it('事業所ごとに切り捨て、会社全体は足し上げるだけ', () => {
    const s = summarizeMonth('2026-10', [
      result('a', 'honsha', { pension: p(100_060n, 500n) }),
      result('b', 'osaka', { pension: p(200_060n, 1_000n) }),
    ]);
    expect(s.offices.map((o) => o.lines.pension.paymentYen)).toEqual([1_000n, 2_000n]);
    expect(s.company.pension.paymentYen).toBe(3_000n); // 3,001円にしない
  });

  it('1人ずつの会社負担の合計との差を出す', () => {
    // 全額939.60円の人が2人：会社負担は1人469.60円（表示469円）
    const s = summarizeMonth('2026-10', [
      result('a', 'honsha', { pension: p(93_960n, 470n) }),
      result('b', 'honsha', { pension: p(93_960n, 470n) }),
    ]);
    const line = s.offices[0].lines.pension;
    expect(line.paymentYen).toBe(1_879n); // 1,879.20円
    expect(line.employerTotal).toBe(939n); // 1,879 − 940
    expect(line.employerDisplaySum).toBe(938n); // 469 + 469
    expect(line.roundingGap).toBe(1n);
    expect(line.count).toBe(2);
  });

  it('計算できなかった人は合計に含めない', () => {
    const s = summarizeMonth('2026-10', [
      result('a', 'honsha', { pension: p(100_000n, 500n) }),
      result('b', 'honsha', { pension: p(100_000n, 500n) }, 'missingRate'),
    ]);
    expect(s.offices[0].lines.pension.count).toBe(1);
    expect(s.company.pension.paymentYen).toBe(1_000n);
  });

  it('保険料がかからない欄は0件・0円', () => {
    const s = summarizeMonth('2026-10', [result('a', 'honsha', { pension: p(100_000n, 500n) })]);
    expect(s.offices[0].lines.childSupport.count).toBe(0);
    expect(s.offices[0].lines.childSupport.paymentYen).toBe(0n);
  });
});
