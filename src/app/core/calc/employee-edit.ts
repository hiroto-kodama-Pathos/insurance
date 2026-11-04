// 従業員の詳細画面での変更（退職・再加入・異動・標準報酬月額・休業）の入力チェック（設計書 2.8・2.10・2.12・3.1）
import { nextDay, Qualification } from './eligibility';
import { isValidDate } from './new-employee';
import { Assignment } from './office';
import { yearMonthLabel } from './year-month';
import { toHalfWidth } from './half-width';

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

/** 標準報酬月額の履歴の追加 */
export function checkStandard(existingMonths: string[], input: StandardInput): Errors {
  const errors: Errors = {};
  if (!isValidMonth(input.validFrom)) errors['validFrom'] = '適用開始月を正しく入力してください';
  else if (existingMonths.includes(input.validFrom))
    errors['validFrom'] = 'この月からの標準報酬月額はすでに登録されています';
  for (const key of ['healthStandard', 'pensionStandard'] as const) {
    const v = input[key];
    if (v === null || !Number.isInteger(v) || v <= 0) errors[key] = '標準報酬月額を円で入力してください';
    else if (v % 1000 !== 0) errors[key] = '標準報酬月額は1,000円単位です';
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

/** 産前産後休業・育児休業の追加・終了日の変更 */
export function checkLeave(input: LeaveInput): Errors {
  const errors: Errors = {};
  if (!isValidDate(input.startDate)) errors['startDate'] = '開始日を正しく入力してください';
  if (input.endDate !== '') {
    if (!isValidDate(input.endDate)) errors['endDate'] = '終了日を正しく入力してください';
    else if (isValidDate(input.startDate) && input.endDate < input.startDate)
      errors['endDate'] = '終了日は開始日以降の日付にしてください';
  }
  if (input.workedDays !== null) {
    if (input.type !== 'childcare') errors['workedDays'] = '就業した日数は育児休業（産後パパ育休）だけ入力できます';
    else if (!Number.isInteger(input.workedDays) || input.workedDays < 0)
      errors['workedDays'] = '就業した日数は0以上の整数で入力してください';
  }
  return errors;
}
