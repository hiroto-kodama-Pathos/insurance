// 同月得喪の人の表示（設計書 2.27）
// 同じ月に資格を取得・喪失した人は、その月の保険料が1か月分かかる。
// その後、同じ月に国民年金の第1号被保険者や他社の厚生年金の資格を取ると、厚生年金保険料が日本年金機構から還付されるため、
// 会社は本人負担分を本人に返す。同月得喪かどうかは資格の期間から計算し、担当者が決めた還付の状態（refundStatus）だけを保存する。
import { Qualification } from './eligibility';

export type RefundStatus = 'pending' | 'returned' | 'none';

export const REFUND_LABEL: Record<RefundStatus, string> = {
  pending: '還付待ち',
  returned: '返金済み',
  none: '還付なし',
};

export const REFUND_KEYS = Object.keys(REFUND_LABEL) as RefundStatus[];

/**
 * 同月得喪か（資格取得日と資格喪失日が同じ月）
 * 継続再雇用の同日得喪（喪失と同じ日に次の資格を取る）は、資格が途切れないので含めない
 */
export function isSameMonth(q: Qualification, all: Qualification[]): boolean {
  if (!q.lostDate || q.lostDate <= q.acquiredDate) return false;
  if (q.acquiredDate.slice(0, 7) !== q.lostDate.slice(0, 7)) return false;
  if (q.lostReason === 'reemployment') return false;
  return !all.some((x) => x !== q && x.acquiredDate === q.lostDate);
}

export type SameMonthCase<Q extends Qualification = Qualification> = {
  qualification: Q;
  /** 保険料がかかる月 */
  yearMonth: string;
  /** 未設定は還付待ち */
  status: RefundStatus;
};

/** 同月得喪の資格の期間（新しい順） */
export function sameMonthCases<Q extends Qualification>(qualifications: Q[]): SameMonthCase<Q>[] {
  return qualifications
    .filter((q) => isSameMonth(q, qualifications))
    .map((q) => ({ qualification: q, yearMonth: q.acquiredDate.slice(0, 7), status: q.refundStatus ?? 'pending' }))
    .sort((a, b) => b.qualification.acquiredDate.localeCompare(a.qualification.acquiredDate));
}

/** 要確認に出す、還付待ちの同月得喪（社員番号順） */
export function pendingRefunds<E extends { id: string; employeeNumber: string; qualifications: Qualification[] }>(
  employees: E[],
): { employee: E; case: SameMonthCase }[] {
  return employees
    .flatMap((e) => sameMonthCases(e.qualifications).filter((c) => c.status === 'pending').map((c) => ({ employee: e, case: c })))
    .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
}
