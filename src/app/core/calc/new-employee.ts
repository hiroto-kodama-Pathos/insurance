// 従業員の新規登録の入力チェック（設計書 3.1）
import { daysInMonth } from './date';
import type { InsuredType } from './insured-type';

export type NewEmployeeInput = {
  employeeNumber: string;
  name: string;
  birthDate: string;
  officeId: string;
  /** 社会保険に加入するか。未加入なら、資格取得日・報酬月額・標準報酬月額は使わない */
  insured: boolean;
  acquiredDate: string;
  /** 被保険者区分（初期値は一般被保険者） */
  insuredType?: InsuredType;
  /** 報酬月額（入社時の見込み。資格取得届に書く額） */
  remuneration: number | null;
  healthStandard: number | null;
  pensionStandard: number | null;
};

export type NewEmployeeErrors = Partial<Record<keyof NewEmployeeInput, string>>;

/** 'YYYY-MM-DD' として正しい日付か */
export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function isPositiveInt(v: number | null): v is number {
  return v !== null && Number.isInteger(v) && v > 0;
}

/**
 * 新規登録の入力をチェックする。エラーがなければ空のオブジェクトを返す
 *
 * @param input 入力
 * @param existingNumbers 登録済みの社員番号
 */
export function validateNewEmployee(input: NewEmployeeInput, existingNumbers: string[]): NewEmployeeErrors {
  const e: NewEmployeeErrors = {};
  const num = input.employeeNumber.trim();
  if (!num) e.employeeNumber = '社員番号を入力してください';
  else if (!/^[0-9A-Za-z-]{1,20}$/.test(num)) e.employeeNumber = '社員番号は半角英数字20文字以内で入力してください';
  else if (existingNumbers.includes(num)) e.employeeNumber = 'この社員番号はすでに登録されています';

  if (!input.name.trim()) e.name = '氏名を入力してください';
  else if (input.name.trim().length > 50) e.name = '氏名は50文字以内で入力してください';

  if (!isValidDate(input.birthDate)) e.birthDate = '生年月日を正しく入力してください';
  if (!input.officeId) e.officeId = '所属する適用事業所を選んでください';

  if (!input.insured) return e;

  if (!isValidDate(input.acquiredDate)) e.acquiredDate = '資格取得日を正しく入力してください';
  else if (isValidDate(input.birthDate) && input.acquiredDate <= input.birthDate)
    e.acquiredDate = '資格取得日は生年月日より後の日付にしてください';

  if (!isPositiveInt(input.remuneration)) e.remuneration = '報酬月額（見込み）を円で入力してください';

  for (const key of ['healthStandard', 'pensionStandard'] as const) {
    const v = input[key];
    if (!isPositiveInt(v)) e[key] = '標準報酬月額を入れてください（「提案を入力」で入ります）';
    else if (v % 1000 !== 0) e[key] = '標準報酬月額は1,000円単位です';
  }
  return e;
}
