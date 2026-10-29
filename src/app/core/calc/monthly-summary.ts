// 月次保険料一覧の小計と会社合計（設計書 2.5・3.2）
// 納付書は適用事業所ごとに届くので、事業所・保険者・納付書の欄ごとに全額を合計してから円未満を切り捨てる。
import { EmployeeMonthResult } from './employee-month';
import { calcCompanyTotals, CompanyTotals, PremiumResult, senToDisplayYen } from './premium-calculator';

/** 納付書の欄。介護保険料は健康保険料の欄に含めて請求される */
export type PaymentLine = 'healthCare' | 'childSupport' | 'pension';

export type LineTotals = CompanyTotals & {
  /** 1人ずつの会社負担（円未満切り捨て）を足し上げた額 */
  employerDisplaySum: bigint;
  /** 会社負担合計 − 1人ずつの会社負担の合計（一覧に出す「数円の差」） */
  roundingGap: bigint;
  /** 人数（その欄の保険料がかかる人） */
  count: number;
};

export type OfficeSubtotal = {
  officeId: string;
  insurerId: string;
  lines: Record<PaymentLine, LineTotals>;
};

export type MonthlySummary = {
  yearMonth: string;
  offices: OfficeSubtotal[];
  /** 会社全体。事業所ごとの額を足し上げるだけで、切り捨て直さない */
  company: Record<PaymentLine, CompanyTotals>;
};

const LINES: PaymentLine[] = ['healthCare', 'childSupport', 'pension'];

function emptyTotals(): CompanyTotals {
  return { paymentYen: 0n, employeeTotal: 0n, employerTotal: 0n };
}

/** 健康保険と介護保険を、納付書の健康保険の欄として1件にまとめる */
function healthCareOf(r: EmployeeMonthResult): PremiumResult | null {
  const h = r.premium?.health ?? null;
  const c = r.premium?.care ?? null;
  if (!h && !c) return null;
  return {
    fullSen: (h?.fullSen ?? 0n) + (c?.fullSen ?? 0n),
    employeeYen: (h?.employeeYen ?? 0n) + (c?.employeeYen ?? 0n),
    employerSen: (h?.employerSen ?? 0n) + (c?.employerSen ?? 0n),
  };
}

function lineOf(r: EmployeeMonthResult, line: PaymentLine): PremiumResult | null {
  if (line === 'healthCare') return healthCareOf(r);
  if (line === 'childSupport') return r.premium?.childSupport ?? null;
  return r.premium?.pension ?? null;
}

/**
 * 1か月分の個人別の結果から、適用事業所別の小計と会社合計を求める
 *
 * 計算できなかった人（資格のない月・料率の未登録など）は、合計に含めない。
 */
export function summarizeMonth(yearMonth: string, results: EmployeeMonthResult[]): MonthlySummary {
  const groups = new Map<string, { officeId: string; insurerId: string; items: EmployeeMonthResult[] }>();
  for (const r of results) {
    if (r.status !== 'ok' || !r.officeId || !r.insurerId) continue;
    const key = `${r.officeId}|${r.insurerId}`;
    const g = groups.get(key) ?? { officeId: r.officeId, insurerId: r.insurerId, items: [] };
    g.items.push(r);
    groups.set(key, g);
  }

  const offices: OfficeSubtotal[] = [];
  const company = { healthCare: emptyTotals(), childSupport: emptyTotals(), pension: emptyTotals() };

  for (const g of groups.values()) {
    const lines = {} as Record<PaymentLine, LineTotals>;
    for (const line of LINES) {
      const items = g.items.map((r) => lineOf(r, line)).filter((x): x is PremiumResult => x !== null);
      const totals = calcCompanyTotals(items);
      const employerDisplaySum = items.reduce((s, x) => s + senToDisplayYen(x.employerSen), 0n);
      lines[line] = {
        ...totals,
        employerDisplaySum,
        roundingGap: totals.employerTotal - employerDisplaySum,
        count: items.length,
      };
      company[line].paymentYen += totals.paymentYen;
      company[line].employeeTotal += totals.employeeTotal;
      company[line].employerTotal += totals.employerTotal;
    }
    offices.push({ officeId: g.officeId, insurerId: g.insurerId, lines });
  }

  offices.sort((a, b) => a.officeId.localeCompare(b.officeId) || a.insurerId.localeCompare(b.insurerId));
  return { yearMonth, offices, company };
}
