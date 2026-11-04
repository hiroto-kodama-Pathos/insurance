// その月に保険料がかかるかの判定（設計書 2.8 資格・2.12 休業の免除・2.16 適用除外）
// 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱う。
import { daysInMonth, formatDate, monthOf, parseDate } from './date';

/** 資格の期間（qualifications） */
export type Qualification = {
  acquiredDate: string;
  /** 資格喪失日。在籍中は null */
  lostDate: string | null;
  /** 喪失の理由（'reemployment' は継続再雇用の同日得喪） */
  lostReason?: string | null;
  /** 同月得喪のときの厚生年金保険料の還付の状態（担当者が決めたもの。未設定は還付待ちとして扱う） */
  refundStatus?: 'pending' | 'returned' | 'none' | null;
};

/** 産前産後休業・育児休業（leaves） */
export type Leave = {
  type: 'maternity' | 'childcare';
  startDate: string;
  /** 終了日。終わっていなければ null */
  endDate: string | null;
  /** 産後パパ育休の間に就業した日数 */
  workedDays?: number | null;
};

/** 適用除外（exemptions）。日付は届出に書く日（該当年月日・非該当年月日） */
export type Exemption = {
  type: 'care' | 'healthNhiUnion' | 'healthLateElderly' | 'healthAgreement' | 'pensionAgreement';
  startDate: string;
  endDate: string | null;
};

/** 翌日 */
export function nextDay(date: string): string {
  const { y, m, d } = parseDate(date);
  if (d < daysInMonth(y, m)) return formatDate({ y, m, d: d + 1 });
  if (m < 12) return formatDate({ y, m: m + 1, d: 1 });
  return formatDate({ y: y + 1, m: 1, d: 1 });
}

/**
 * 対象月に保険料がかかる資格があるか
 *
 * 資格を取った月から、資格を失った月の前月までかかる。
 * 同じ月に資格を取って失った場合（同月得喪）は、その月の1か月分がかかる。
 */
export function isInsuredInMonth(qualifications: Qualification[], yearMonth: string): boolean {
  return qualifications.some((q) => {
    const from = monthOf(q.acquiredDate);
    if (yearMonth < from) return false;
    if (q.lostDate === null) return true;
    const lost = monthOf(q.lostDate);
    if (from === lost) return yearMonth === from; // 同月得喪
    return yearMonth < lost;
  });
}

/**
 * 対象月が産休・育休で免除される月か
 *
 * - 休業を始めた月から、終了日の翌日が属する月の前月までを免除する
 * - 育児休業で、開始日と終了日の翌日が同じ月にある場合は、その月の休業日数
 *   （同じ月の複数回は合計し、就業した日数は引く）が14日以上なら免除する
 */
export function isLeaveExemptMonth(leaves: Leave[], yearMonth: string): boolean {
  return exemptingLeave(leaves, yearMonth) !== null;
}

/**
 * 対象月を免除にしている休業（免除されない月は null）。判定は isLeaveExemptMonth と同じ
 * 同じ月の短い育児休業を合計して14日以上になるときは、その月の最初の休業を返す
 */
export function exemptingLeave<L extends Leave>(leaves: L[], yearMonth: string): L | null {
  let shortDays = 0;
  let firstShort: L | null = null;
  for (const l of leaves) {
    const start = monthOf(l.startDate);
    if (yearMonth < start) continue;
    if (l.endDate === null) return l; // まだ終わっていない
    const resume = monthOf(nextDay(l.endDate));
    if (yearMonth < resume) return l;
    if (l.type === 'childcare' && start === resume && start === yearMonth) {
      const days = parseDate(l.endDate).d - parseDate(l.startDate).d + 1;
      shortDays += days - (l.workedDays ?? 0);
      firstShort ??= l;
    }
  }
  return shortDays >= 14 ? firstShort : null;
}

/** 休業の取得者申出書の届出のID（届出の期限の一覧・filings と同じ「従業員ID_leave_開始日」） */
export function leaveFilingId(employeeId: string, leave: Pick<Leave, 'startDate'>): string {
  return `${employeeId}_leave_${leave.startDate}`;
}

/**
 * 免除の表示（「産休免除」「育休免除」）。取得者申出書を届出済みにするまでは「（申出待ち）」と添える
 * @param filedIds 届出済みにした届出のID
 */
export function leaveExemptLabel(employeeId: string, leave: Leave, filedIds: Set<string>): string {
  const name = leave.type === 'maternity' ? '産休免除' : '育休免除';
  return filedIds.has(leaveFilingId(employeeId, leave)) ? name : `${name}（申出待ち）`;
}

/** 対象月に適用除外になっている保険 */
export function exemptedInsurances(
  exemptions: Exemption[],
  yearMonth: string,
): { health: boolean; care: boolean; pension: boolean } {
  const active = exemptions.filter(
    (e) =>
      monthOf(e.startDate) <= yearMonth && (e.endDate === null || yearMonth < monthOf(e.endDate)),
  );
  const has = (...types: Exemption['type'][]) => active.some((e) => types.includes(e.type));
  return {
    health: has('healthNhiUnion', 'healthLateElderly', 'healthAgreement'),
    care: has('care'),
    pension: has('pensionAgreement'),
  };
}
