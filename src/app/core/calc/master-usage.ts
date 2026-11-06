// 適用事業所・給与の支払区分の削除の前に、使われているかを数える（設計書 3.10）
// 1件でも使われていれば「使用中」として削除させない。今の所属だけでなく、過去の所属（履歴）も数える
// （過去の保険料・確定・照合の記録が、その事業所・区分を指しているため）
import { Assignment } from './office';
import { PayrollAssignment } from './payroll-group';

type UsageEmployee = { assignments: Assignment[]; payrollAssignments?: PayrollAssignment[] };

/** その適用事業所に所属した（している）従業員の数 */
export function officeUsage(employees: UsageEmployee[], officeId: string): number {
  return employees.filter((e) => e.assignments.some((a) => a.officeId === officeId)).length;
}

/** その支払区分に属した（している）従業員の数 */
export function payrollGroupUsage(employees: UsageEmployee[], groupId: string): number {
  return employees.filter((e) => (e.payrollAssignments ?? []).some((a) => a.payrollGroupId === groupId)).length;
}

/**
 * その健康保険組合を使っているもの：保険者として登録した適用事業所の数と、
 * 二以上事業所勤務で本人が選んだ保険者としている従業員の数（過去の標準報酬月額の履歴を含む）
 */
export function insurerUsage(
  offices: { insurerId: string }[],
  employees: { standardHistory: { selectedInsurerId?: string | null }[] }[],
  insurerId: string,
): { offices: number; employees: number } {
  return {
    offices: offices.filter((o) => o.insurerId === insurerId).length,
    employees: employees.filter((e) => e.standardHistory.some((s) => s.selectedInsurerId === insurerId)).length,
  };
}

/** 削除できないときの知らせ（使用中）。削除できるなら null */
export function inUseMessage(label: string, name: string, reason: { isDefault: boolean; employees?: number; bonuses?: boolean; offices?: number }): string | null {
  if (reason.offices && reason.offices > 0) return `${label}「${name}」は使用中なので、削除できません（適用事業所${reason.offices}件の保険者になっています）。`;
  if (reason.isDefault) return `${label}「${name}」は新規登録の初期値として使用中なので、削除できません（先に別の${label}を初期値にしてください）。`;
  if (reason.employees && reason.employees > 0)
    return label === '健康保険組合'
      ? `${label}「${name}」は使用中なので、削除できません（従業員${reason.employees}人が、二以上事業所勤務の保険者として選んでいます。過去の履歴を含みます）。`
      : `${label}「${name}」は使用中なので、削除できません（従業員${reason.employees}人が所属しています。過去の所属を含みます）。`;
  if (reason.bonuses) return `${label}「${name}」は使用中なので、削除できません（この種類の賞与が登録されています）。`;
  return null;
}
