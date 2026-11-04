// 70歳到達届の要否（設計書 2.2）
// 70歳到達日（誕生日の前日）から5日以内に、70歳到達届（厚生年金保険被保険者資格喪失届・70歳以上被用者該当届）を出す。
// 次の両方に当たる人は届出が不要（日本年金機構の案内）：
// - 70歳到達日以前から同じ適用事業所に使用され、70歳到達日以降も引き続き使用される
// - 70歳到達日時点の標準報酬月額相当額が、70歳到達日の前日の標準報酬月額と同額
import { ageReachedDate } from './age';
import { formatDate, monthOf, parseDate, previousDay } from './date';
import { dependentReportDeadline } from './dependent';
import { Qualification } from './eligibility';
import { findEffective, StandardHistory } from './employee-month';
import { GradeRow, suggestStandards } from './grade-suggest';
import { Assignment } from './office';
import { addMonths, payMonths, SalaryRecord } from './salary';
import { dateLabel, yearMonthLabel } from './year-month';

export type Age70Status = 'required' | 'notRequired' | 'unknown';

export type Age70Notice = {
  employeeId: string;
  /** 70歳到達日（誕生日の前日） */
  reachedDate: string;
  /** 届出の期限（到達日から5日以内） */
  deadline: string;
  status: Age70Status;
  /** 到達日の前日の厚生年金の標準報酬月額 */
  before: number | null;
  /** 到達日時点の報酬月額と、それから求めた標準報酬月額相当額 */
  remuneration: number | null;
  equivalent: number | null;
  /** 判定に使った報酬月額のもと（直近の給与の月、または登録した報酬月額） */
  basis: string;
  /** 一覧に出す説明 */
  message: string;
};

export type Age70Employee = {
  id: string;
  birthDate: string;
  qualifications: Qualification[];
  assignments: Assignment[];
  standardHistory: StandardHistory[];
};

const insuredOn = (qs: Qualification[], date: string) => qs.some((q) => q.acquiredDate <= date && (q.lostDate === null || q.lostDate > date));
const officeOn = (as: Assignment[], date: string) =>
  [...as].filter((a) => a.validFrom <= date).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.officeId ?? null;

/** 直近の給与を見る期間（到達日の月を含めて3か月） */
export const AGE70_SALARY_MONTHS = 3;

/**
 * 70歳到達届の要否。到達日に資格がない人は null
 *
 * 報酬月額は、到達日以前で直近の給与の月（固定的賃金＋非固定的賃金−遡及差額）。給与がなければ、標準報酬月額の履歴に登録した報酬月額を使う
 */
export function age70Notice(employee: Age70Employee, salaries: SalaryRecord[], grades: GradeRow[]): Age70Notice | null {
  if (!employee.birthDate) return null;
  const reachedDate = ageReachedDate(employee.birthDate, 70);
  const dayBefore = formatDate(previousDay(parseDate(reachedDate)));
  if (!insuredOn(employee.qualifications, reachedDate)) return null;
  const deadline = dependentReportDeadline(reachedDate);
  const base = { employeeId: employee.id, reachedDate, deadline };
  const required = (message: string, extra: Partial<Age70Notice> = {}): Age70Notice => ({
    ...base, status: 'required', before: null, remuneration: null, equivalent: null, basis: '', ...extra,
    message: `70歳到達届：要（${dateLabel(deadline)}まで）。${message}`,
  });

  // 到達日の前日から使用されていない（到達日に資格を取った）・前後で適用事業所が変わる
  if (!insuredOn(employee.qualifications, dayBefore)) return required('70歳到達日の前日に資格がありません');
  if (officeOn(employee.assignments, dayBefore) !== officeOn(employee.assignments, reachedDate))
    return required('70歳到達日の前後で適用事業所が変わります');

  const before = findEffective(employee.standardHistory, monthOf(dayBefore))?.pensionStandard ?? null;
  const reachedYm = monthOf(reachedDate);
  const months = payMonths(salaries.filter((s) => s.employeeId === employee.id && s.paidDate <= reachedDate))
    .filter((m) => m.yearMonth > addMonths(reachedYm, -AGE70_SALARY_MONTHS))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  const registered = findEffective(employee.standardHistory, reachedYm)?.remuneration ?? null;
  const remuneration = months[0]?.total ?? registered;
  const basis = months[0] ? `${yearMonthLabel(months[0].yearMonth)}の給与` : registered !== null ? '登録した報酬月額' : '';

  if (before === null || remuneration === null) {
    return {
      ...base, status: 'unknown', before, remuneration, equivalent: null, basis,
      message: `70歳到達届：要確認（${before === null ? '前日の標準報酬月額' : '到達時の報酬月額（直近の給与）'}がないため相当額を求められません。届け出るなら${dateLabel(deadline)}まで）`,
    };
  }
  const equivalent = suggestStandards(remuneration, grades, reachedYm, '')?.pensionStandard ?? null;
  if (equivalent === null) {
    return { ...base, status: 'unknown', before, remuneration, equivalent, basis, message: '70歳到達届：要確認（等級表がないため相当額を求められません）' };
  }
  const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
  if (equivalent === before) {
    return {
      ...base, status: 'notRequired', before, remuneration, equivalent, basis,
      message: `70歳到達届：不要（相当額が同額。${basis}の報酬月額${remuneration.toLocaleString('ja-JP')}円 → 相当額${man(equivalent)}）`,
    };
  }
  return required(`相当額が前日の標準報酬月額と違います（${man(before)} → ${man(equivalent)}。${basis}の報酬月額${remuneration.toLocaleString('ja-JP')}円）`, {
    before, remuneration, equivalent, basis,
  });
}
