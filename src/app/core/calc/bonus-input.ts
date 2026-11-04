// 賞与の登録の入力チェックと、届け出る賞与額（設計書 2.4・3.3）
import { isValidDate } from './new-employee';

export type BonusInput = {
  employeeId: string;
  paidDate: string;
  /** 賞与額（現物を含めた合計） */
  amount: number | null;
  /** うち現物の価額（自社製品などの時価。任意） */
  inKindAmount?: number | null;
  /** 賞与の種類（任意） */
  bonusTypeId?: string;
};
export type BonusErrors = Partial<Record<keyof BonusInput, string>>;

export function validateBonus(input: BonusInput): BonusErrors {
  const e: BonusErrors = {};
  if (!input.employeeId) e.employeeId = '従業員を選んでください';
  if (!isValidDate(input.paidDate)) e.paidDate = '支給日を正しく入力してください';
  if (input.amount === null || !Number.isInteger(input.amount) || input.amount <= 0)
    e.amount = '賞与額を円で入力してください';
  else if (input.amount >= 100_000_000) e.amount = '賞与額が大きすぎます。桁を確かめてください';
  const k = input.inKindAmount;
  if (k !== null && k !== undefined) {
    if (!Number.isInteger(k) || k < 0) e.inKindAmount = 'うち現物の価額を0円以上の円で入力してください';
    else if (input.amount !== null && k > input.amount) e.inKindAmount = 'うち現物は賞与額の内数です（賞与額以下にしてください）';
  }
  return e;
}

/** 届け出る賞与額（人と支給月ごと） */
export type BonusReportAmount = {
  employeeId: string;
  yearMonth: string;
  /** その月の支給日（2回以上なら複数） */
  paidDates: string[];
  /** 通貨・現物（円。合算した額） */
  cash: number;
  inKind: number;
  /** 合計（同じ月の2回以上の支給を合算し、1,000円未満を切り捨て。上限を当てる前の額） */
  total: number;
};

/**
 * 届け出る賞与額（設計書 2.4）。同じ月に同じ人へ2回以上支払った賞与を合算し、1,000円未満を切り捨てる。
 * 上限（年度573万円・同月150万円）は保険者が当てるので、ここでは当てない
 */
export function bonusReportAmounts(
  bonuses: { employeeId: string; paidDate: string; amount: number; inKindAmount?: number | null }[],
): BonusReportAmount[] {
  const map = new Map<string, BonusReportAmount>();
  for (const b of [...bonuses].sort((x, y) => x.paidDate.localeCompare(y.paidDate))) {
    const ym = b.paidDate.slice(0, 7);
    const key = `${b.employeeId}|${ym}`;
    const cur = map.get(key) ?? { employeeId: b.employeeId, yearMonth: ym, paidDates: [], cash: 0, inKind: 0, total: 0 };
    const inKind = b.inKindAmount ?? 0;
    cur.paidDates.push(b.paidDate);
    cur.cash += b.amount - inKind;
    cur.inKind += inKind;
    cur.total = Math.floor((cur.cash + cur.inKind) / 1000) * 1000;
    map.set(key, cur);
  }
  return [...map.values()];
}
