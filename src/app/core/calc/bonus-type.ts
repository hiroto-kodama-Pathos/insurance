// 賞与の種類と、年4回以上支給する賞与（設計書 2.4・4章 bonusTypes）
// 年4回以上支給する種類は報酬扱いとし、賞与の保険料をかけず、定時決定で報酬に上乗せする。
// 年4回以上かどうかは給与規程などで決まるため、管理者が種類ごとに設定する。
import { fiscalYearOf } from './bonus-premium';

export type BonusType = { id: string; name: string; isRemuneration: boolean; validFrom: string };
export type BonusTypeInput = Omit<BonusType, 'id'>;

/** その支給日に、その種類の賞与が報酬扱いか（適用開始月から） */
export function isRemunerationBonus(types: BonusType[], typeId: string | null | undefined, paidDate: string): boolean {
  const t = types.find((x) => x.id === typeId);
  return !!t && t.isRemuneration && paidDate.slice(0, 7) >= t.validFrom;
}

export function checkBonusType(input: BonusTypeInput, otherNames: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) e['name'] = '種類の名前を入力してください';
  else if (otherNames.includes(name)) e['name'] = '同じ名前の種類があります';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.validFrom)) e['validFrom'] = '適用開始月を正しく入力してください';
  return e;
}

/** 4回目の警告：報酬扱いでない賞与が、同じ人・同じ年度にすでに3回以上ある */
export const FOURTH_BONUS = 4;

export function fourthBonusWarning(
  bonuses: { employeeId: string; paidDate: string; isRemuneration?: boolean }[],
  employeeId: string,
  paidDate: string,
): string | null {
  const fy = fiscalYearOf(paidDate);
  const count = bonuses.filter((b) => b.employeeId === employeeId && !b.isRemuneration && fiscalYearOf(b.paidDate) === fy).length;
  if (count + 1 < FOURTH_BONUS) return null;
  return `同じ年度で${count + 1}回目の賞与です。年4回以上支給する賞与なら報酬扱いになる可能性があります（給与規程を確かめ、設定の「賞与の種類」で年4回以上支給にしてください）。`;
}

/**
 * 定時決定で各月の報酬に上乗せする額（前年7月1日〜当年6月30日に支払った報酬扱いの賞与の合計 ÷ 12。円未満切り捨て）
 */
export function remunerationBonusAddOn(
  bonuses: { employeeId: string; paidDate: string; amount: number; isRemuneration?: boolean }[],
  employeeId: string,
  year: number,
): { total: number; addOn: number } {
  const from = `${year - 1}-07-01`;
  const to = `${year}-06-30`;
  const total = bonuses
    .filter((b) => b.employeeId === employeeId && b.isRemuneration && b.paidDate >= from && b.paidDate <= to)
    .reduce((t, b) => t + b.amount, 0);
  return { total, addOn: Math.floor(total / 12) };
}

