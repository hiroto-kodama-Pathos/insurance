// 賞与の登録の入力チェック
import { isValidDate } from './new-employee';

export type BonusInput = { employeeId: string; paidDate: string; amount: number | null };
export type BonusErrors = Partial<Record<keyof BonusInput, string>>;

export function validateBonus(input: BonusInput): BonusErrors {
  const e: BonusErrors = {};
  if (!input.employeeId) e.employeeId = '従業員を選んでください';
  if (!isValidDate(input.paidDate)) e.paidDate = '支給日を正しく入力してください';
  if (input.amount === null || !Number.isInteger(input.amount) || input.amount <= 0)
    e.amount = '賞与額を円で入力してください';
  else if (input.amount >= 100_000_000) e.amount = '賞与額が大きすぎます。桁を確かめてください';
  return e;
}
