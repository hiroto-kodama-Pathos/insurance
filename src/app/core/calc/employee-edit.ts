// 従業員の詳細画面での変更（退職・再加入・異動・標準報酬月額・休業）の入力チェック（設計書 2.8・2.10・2.12・3.1）
import { nextDay, Qualification } from './eligibility';
import { isValidDate } from './new-employee';
import { Assignment } from './office';
import { yearMonthLabel } from './year-month';
import { toHalfWidth } from './half-width';
import { standardGradeError, type GradeRow } from './grade-suggest';

export type Errors = Record<string, string>;

/**
 * 氏名の変更の入力チェック（結婚などで氏名が変わったとき・登録の誤りを直すとき）
 * 新規登録と同じく、空欄と50文字を超える氏名は入れない。今と同じ氏名も、変更にならないので入れない
 */
export function checkNameChange(current: string, name: string): Errors {
  const v = name.trim();
  if (!v) return { name: '氏名を入力してください' };
  if (v.length > 50) return { name: '氏名は50文字以内で入力してください' };
  if (v === current.trim()) return { name: '今の氏名と同じです' };
  return {};
}

/**
 * 社員番号の変更の入力チェック（全角で入れても半角にそろえて比べる）
 * 新規登録と同じく、半角英数字とハイフンで20文字以内。ほかの人の社員番号と重ねない
 * @param otherNumbers ほかの従業員の社員番号（自分を除く）
 * @returns エラーと、保存する社員番号（半角にそろえたもの）
 */
export function checkNumberChange(current: string, value: string, otherNumbers: string[]): { errors: Errors; number: string } {
  const number = toHalfWidth(value).trim();
  if (!number) return { errors: { employeeNumber: '社員番号を入力してください' }, number };
  if (!/^[0-9A-Za-z-]{1,20}$/.test(number)) return { errors: { employeeNumber: '社員番号は半角英数字20文字以内で入力してください' }, number };
  if (number === current) return { errors: { employeeNumber: '今の社員番号と同じです' }, number };
  if (otherNumbers.includes(number)) return { errors: { employeeNumber: 'この社員番号はほかの従業員が使っています' }, number };
  return { errors: {}, number };
}

/** 'YYYY-MM' として正しいか */
export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** まだ喪失していない資格の期間 */
export function openQualification(qs: Qualification[]): Qualification | null {
  return qs.find((q) => q.lostDate === null) ?? null;
}

/**
 * 退職の入力チェック。資格喪失日は退職日の翌日
 * @returns エラーと、求めた資格喪失日
 */
export function checkRetirement(
  qualifications: Qualification[],
  retirementDate: string,
): { errors: Errors; lostDate: string | null } {
  const errors: Errors = {};
  const open = openQualification(qualifications);
  if (!open) errors['retirementDate'] = '加入中の資格がありません';
  else if (!isValidDate(retirementDate)) errors['retirementDate'] = '退職日を正しく入力してください';
  else if (retirementDate < open.acquiredDate) errors['retirementDate'] = '退職日は資格取得日以降の日付にしてください';
  const lostDate = Object.keys(errors).length === 0 ? nextDay(retirementDate) : null;
  return { errors, lostDate };
}

/** 退職以外の理由で資格を失う場合（資格喪失日を直接入れる） */
export function checkLoss(qualifications: Qualification[], lostDate: string, reason: string): Errors {
  const errors: Errors = {};
  const open = openQualification(qualifications);
  if (!open) errors['lostDate'] = '加入中の資格がありません';
  else if (!isValidDate(lostDate)) errors['lostDate'] = '資格喪失日を正しく入力してください';
  else if (lostDate <= open.acquiredDate) errors['lostDate'] = '資格喪失日は資格取得日より後の日付にしてください';
  if (!reason) errors['reason'] = '喪失の理由を選んでください';
  return errors;
}

/** 再加入（新しい資格の期間を足す） */
export function checkReacquire(qualifications: Qualification[], acquiredDate: string): Errors {
  const errors: Errors = {};
  if (openQualification(qualifications)) errors['acquiredDate'] = 'すでに加入中です。先に喪失を登録してください';
  else if (!isValidDate(acquiredDate)) errors['acquiredDate'] = '資格取得日を正しく入力してください';
  else {
    const lastLost = qualifications.map((q) => q.lostDate ?? '').sort().at(-1) ?? '';
    if (acquiredDate < lastLost) errors['acquiredDate'] = '前の資格喪失日より前の日付にはできません';
  }
  return errors;
}

/** 異動（別々の適用事業所の間の異動だけを登録する） */
export function checkTransfer(assignments: Assignment[], transferDate: string, officeId: string): Errors {
  const errors: Errors = {};
  const latest = [...assignments].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).at(-1);
  if (!isValidDate(transferDate)) errors['transferDate'] = '異動日を正しく入力してください';
  else if (latest && transferDate <= latest.validFrom)
    errors['transferDate'] = `異動日は、今の所属の開始日（${yearMonthLabel(latest.validFrom)}）より後の日付にしてください`;
  if (!officeId) errors['officeId'] = '異動先の適用事業所を選んでください';
  else if (latest && latest.officeId === officeId) errors['officeId'] = '今と同じ事業所です';
  return errors;
}

export type StandardInput = {
  validFrom: string;
  reason: 'acquisition' | 'regular' | 'revision' | 'leaveEnd';
  healthStandard: number | null;
  pensionStandard: number | null;
  /** 二以上事業所勤務（任意）：自社の報酬・合計の報酬・本人が選んだ保険者 */
  ownRemuneration?: number | null;
  totalRemuneration?: number | null;
  selectedInsurerId?: string | null;
  /** 通知書待ちとして、見込みの額を先に登録する */
  provisional?: boolean;
};

/**
 * 標準報酬月額の履歴の追加・訂正・異動
 * @param grades 等級表（額が適用開始月の等級の額かを確かめる。その月の表がなければ登録できない。null なら確かめない）
 */
export function checkStandard(existingMonths: string[], input: StandardInput, grades: GradeRow[] | null = null): Errors {
  const errors: Errors = {};
  if (!isValidMonth(input.validFrom)) errors['validFrom'] = '適用開始月を正しく入力してください';
  else if (existingMonths.includes(input.validFrom))
    errors['validFrom'] = 'この月からの標準報酬月額はすでに登録されています';
  for (const key of ['healthStandard', 'pensionStandard'] as const) {
    const v = input[key];
    if (v === null || !Number.isInteger(v) || v <= 0) errors[key] = '標準報酬月額を円で入力してください';
    else if (v % 1000 !== 0) errors[key] = '標準報酬月額は1,000円単位です';
    else if (isValidMonth(input.validFrom)) {
      const g = standardGradeError(grades, input.validFrom, key === 'healthStandard' ? 'health' : 'pension', v);
      if (g) errors[key] = g;
    }
  }
  const own = input.ownRemuneration ?? null;
  const total = input.totalRemuneration ?? null;
  if (own !== null || total !== null) {
    if (own === null || !Number.isInteger(own) || own <= 0) errors['ownRemuneration'] = '自社の報酬を円で入力してください';
    if (total === null || !Number.isInteger(total) || total <= 0) errors['totalRemuneration'] = '合計の報酬を円で入力してください';
    else if (own !== null && own > total) errors['totalRemuneration'] = '合計の報酬は、自社の報酬以上にしてください';
    if (!input.selectedInsurerId) errors['selectedInsurerId'] = '本人が選んだ保険者を選んでください';
  }
  return errors;
}

export type LeaveInput = {
  type: 'maternity' | 'childcare';
  startDate: string;
  endDate: string;
  workedDays: number | null;
};

/** 育児休業の保険料の免除・14日以上の決まりが今の制度になった日（これより前に始まった育児休業は扱わない） */
export const CHILDCARE_RULE_FROM = '2022-10-01';
/** 産前産後休業の長さの上限（多胎の産前98日＋産後56日に、出産が予定日より遅れた日数の余裕を足した日数） */
export const MATERNITY_MAX_DAYS = 180;
/** 産後パパ育休（出生時育児休業）の長さの上限 */
const PATERNITY_MAX_DAYS = 28;

/** 開始日から終了日までの日数（両端を含む） */
export function daysInclusive(start: string, end: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(end) - t(start)) / 86_400_000) + 1;
}

/** n年後の同じ日（2/29 は 2/28 にする） */
function addYears(date: string, n: number): string {
  const y = Number(date.slice(0, 4)) + n;
  const md = date.slice(5);
  return md === '02-29' && !isValidDate(`${y}-02-29`) ? `${y}-02-28` : `${y}-${md}`;
}

/**
 * 産前産後休業・育児休業の追加・訂正（設計書 2.12）。
 * 打ち間違い（年の誤りなど）や、制度上ありえない期間・就業日数は、保険料の免除を誤るので入れない
 * @param qualifications 資格の期間（開始日がその中にあるかを見る）。渡さなければ見ない
 * @param today 今日（'YYYY-MM-DD'）。開始日が1年より先なら止める。渡さなければ見ない
 */
export function checkLeave(input: LeaveInput, qualifications: Qualification[] | null = null, today: string | null = null): Errors {
  const errors: Errors = {};
  const startOk = isValidDate(input.startDate);
  if (!startOk) errors['startDate'] = '開始日を正しく入力してください';
  else if (input.type === 'childcare' && input.startDate < CHILDCARE_RULE_FROM)
    errors['startDate'] = '2022年9月以前に始まった育児休業は登録できません（免除の決まりが今と違うため。このアプリは2022年10月以降の制度で計算します）';
  else if (today && input.startDate > addYears(today, 1))
    errors['startDate'] = '開始日が1年以上先です。年を確かめてください';
  else if (qualifications && !qualifications.some((q) => q.acquiredDate <= input.startDate && (q.lostDate === null || input.startDate < q.lostDate)))
    errors['startDate'] = '開始日が資格の期間（資格取得日〜資格喪失日の前日）の外です。年を確かめてください（資格のない期間の休業は免除に関係しません）';

  const endOk = input.endDate !== '' && isValidDate(input.endDate);
  if (input.endDate !== '') {
    if (!endOk) errors['endDate'] = '終了日を正しく入力してください';
    else if (startOk && input.endDate < input.startDate) errors['endDate'] = '終了日は開始日以降の日付にしてください';
    else if (startOk && input.type === 'maternity' && daysInclusive(input.startDate, input.endDate) > MATERNITY_MAX_DAYS)
      errors['endDate'] = `産前産後休業が${daysInclusive(input.startDate, input.endDate)}日になっています。産前産後休業は長くても半年ほど（多胎の産前98日＋産後56日）です。終了日の年を確かめてください（続けて育児休業を取るときは、育児休業として別に登録します）`;
    else if (startOk && input.type === 'childcare' && input.endDate >= addYears(input.startDate, 3))
      errors['endDate'] = '育児休業が3年以上になっています。育児休業の保険料の免除は、子が3歳になるまでです。終了日の年を確かめてください';
  }

  if (input.workedDays !== null) {
    const days = startOk && endOk && input.endDate >= input.startDate ? daysInclusive(input.startDate, input.endDate) : null;
    if (input.type !== 'childcare') errors['workedDays'] = '就業した日数は育児休業（産後パパ育休）だけ入力できます';
    else if (!Number.isInteger(input.workedDays) || input.workedDays < 0) errors['workedDays'] = '就業した日数は0以上の整数で入力してください';
    else if (input.workedDays === 0) {
      // 0日は入れていないのと同じ
    } else if (input.endDate === '') errors['workedDays'] = '就業した日数は、終了日を入れた産後パパ育休（28日以内）だけ入力できます';
    else if (days !== null && days > PATERNITY_MAX_DAYS)
      errors['workedDays'] = `就業した日数は産後パパ育休（28日以内の休業）だけ入力できます（この休業は${days}日です）`;
    else if (days !== null && input.workedDays > Math.floor(days / 2))
      errors['workedDays'] = `就業した日数が多すぎます。産後パパ育休中に就業できるのは休業中の所定労働日数の半分までで、${days}日の休業なら多くても${Math.floor(days / 2)}日です`;
  }
  return errors;
}
