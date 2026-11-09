// 賞与の種類と、年4回以上支給する賞与（設計書 2.4・4章 bonusTypes）
// 年4回以上支給する種類は報酬扱いとし、賞与の保険料をかけず、定時決定で報酬に上乗せする。
// 年4回以上かどうかは給与規程などで決まるため、管理者が種類ごとに設定する。

/** archived：使わない種類（登録した賞与が参照するので消さず、新しい賞与で選べなくする） */
export type BonusType = { id: string; name: string; isRemuneration: boolean; validFrom: string; archived?: boolean };
export type BonusTypeInput = Omit<BonusType, 'id' | 'archived'>;

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

/** 4回目の警告：報酬扱いでない賞与が、同じ人・同じ期間（7月1日〜翌6月30日）にすでに3回以上ある */
export const FOURTH_BONUS = 4;

/**
 * 年4回以上かを数える期間（7月1日〜翌6月30日。報酬扱いの賞与を定時決定に上乗せする期間と同じ）の始まりの年
 * '2026-07-01' → 2026、'2027-06-30' → 2026
 */
export function bonusCountYearOf(paidDate: string): number {
  const y = Number(paidDate.slice(0, 4));
  return Number(paidDate.slice(5, 7)) >= 7 ? y : y - 1;
}

/** その期間（7月1日〜翌6月30日）の最初と最後の日 */
export function bonusCountRange(paidDate: string): { from: string; to: string } {
  const y = bonusCountYearOf(paidDate);
  return { from: `${y}-07-01`, to: `${y + 1}-06-30` };
}

/** 年4回以上か数える支給回数（同じ月に2回以上支給しても、支給日ごとに1回と数える） */
function countIn(bonuses: { employeeId: string; paidDate: string; isRemuneration?: boolean }[], employeeId: string, paidDate: string): number {
  const y = bonusCountYearOf(paidDate);
  return new Set(bonuses.filter((b) => b.employeeId === employeeId && !b.isRemuneration && bonusCountYearOf(b.paidDate) === y).map((b) => b.paidDate)).size;
}

export function fourthBonusWarning(
  bonuses: { employeeId: string; paidDate: string; isRemuneration?: boolean }[],
  employeeId: string,
  paidDate: string,
): string | null {
  const already = bonuses.some((b) => b.employeeId === employeeId && b.paidDate === paidDate);
  const count = countIn(bonuses, employeeId, paidDate) + (already ? 0 : 1);
  if (count < FOURTH_BONUS) return null;
  const { from, to } = bonusCountRange(paidDate);
  return `${from.slice(0, 4)}年7月〜${to.slice(0, 4)}年6月で${count}回目の賞与です。年4回以上支給する賞与なら報酬扱いになる可能性があります（給与規程を確かめ、設定の「賞与の種類」で年4回以上支給にしてください）。`;
}

/**
 * 年4回以上の支給になっているのに、報酬扱いでない（賞与として保険料をかけている）人（設計書 2.4）。
 * 年4回以上かは給与規程・支給の実態で決まるので、自動では報酬扱いにせず、設定漏れの確認として出す
 */
export function fourOrMoreBonuses(
  bonuses: { employeeId: string; paidDate: string; isRemuneration?: boolean }[],
  paidDate: string,
): { employeeId: string; count: number }[] {
  const ids = [...new Set(bonuses.map((b) => b.employeeId))];
  return ids.map((id) => ({ employeeId: id, count: countIn(bonuses, id, paidDate) })).filter((x) => x.count >= FOURTH_BONUS);
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

