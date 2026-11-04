// 加入対象の判定の基準（システム共通マスタ eligibilityRules。設計書 2.24）
// 改正に合わせて運営者が更新する。賃金の要件（月額8.8万円）は2026年10月に撤廃されたため持たない。
// 企業規模の要件（厚生年金の被保険者数）：2024年10月から51人以上、2027年10月から36人以上、
// 2029年10月から21人以上、2032年10月から11人以上、2035年10月から撤廃（厚生労働省「社会保険の加入対象の拡大について」）
const base = { fullTimeRatio: 750, weeklyHours: 20, contractMonths: 2, studentExcluded: true };

export function eligibilityRuleDocs() {
  return [
    ['2024-10-01', 51],
    ['2027-10-01', 36],
    ['2029-10-01', 21],
    ['2032-10-01', 11],
    ['2035-10-01', null],
  ].map(([validFrom, companySize]) => ({ id: validFrom, data: { ...base, validFrom, companySize } }));
}
