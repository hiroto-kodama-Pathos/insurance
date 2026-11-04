// 休職（設計書 2.26）
// 私傷病・自己都合などの休職には、産休・育休のような保険料の免除はない。保険料は標準報酬月額で通常どおり計算する。
// 登録した期間は、「休職中」の表示、控除不足の添え書き（2.21）、定時決定の要確認（2.13.1）に使う。
import { isValidDate } from './new-employee';
import { dateLabel } from './year-month';

export type AbsenceReason = 'sickness' | 'personal' | 'furlough' | 'other';

export const ABSENCE_REASON_LABEL: Record<AbsenceReason, string> = {
  sickness: '私傷病',
  personal: '自己都合',
  furlough: '一時帰休',
  other: 'その他',
};

export const ABSENCE_REASONS = Object.keys(ABSENCE_REASON_LABEL) as AbsenceReason[];

export type Absence = {
  reason: AbsenceReason;
  startDate: string;
  /** 終了日（未定は null） */
  endDate: string | null;
};

export type AbsenceInput = { reason: AbsenceReason; startDate: string; endDate: string };

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** その日に休職中か */
export function absentOn(absences: Absence[] | undefined, date: string): Absence | null {
  return (absences ?? []).find((a) => a.startDate <= date && (a.endDate === null || a.endDate >= date)) ?? null;
}

/** その月に休職の期間が1日でもかかるか */
export function absentInMonth(absences: Absence[] | undefined, ym: string): boolean {
  const from = `${ym}-01`;
  const to = monthEnd(ym);
  return (absences ?? []).some((a) => a.startDate <= to && (a.endDate === null || a.endDate >= from));
}

/** 期間の表示（「2026-10-01〜（終了日未定）」など） */
export function absencePeriodLabel(a: Absence): string {
  return `${dateLabel(a.startDate)}〜${a.endDate ? dateLabel(a.endDate) : '（終了日未定）'}`;
}

/**
 * 休職の入力チェック。ほかの休職と期間が重なるものは登録できない
 * @param others 同じ人のほかの休職（期間を変えるときは、変える休職を除いて渡す）
 */
export function checkAbsence(input: AbsenceInput, others: Absence[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!ABSENCE_REASONS.includes(input.reason)) e['reason'] = '理由を選んでください';
  if (!isValidDate(input.startDate)) e['startDate'] = '開始日を入力してください';
  if (input.endDate !== '' && !isValidDate(input.endDate)) e['endDate'] = '終了日の書き方が正しくありません';
  else if (input.endDate !== '' && isValidDate(input.startDate) && input.endDate < input.startDate) e['endDate'] = '終了日は開始日以降にしてください';
  if (Object.keys(e).length === 0) {
    const end = input.endDate || '9999-12-31';
    if (others.some((a) => a.startDate <= end && (a.endDate ?? '9999-12-31') >= input.startDate))
      e['startDate'] = 'ほかの休職の期間と重なっています';
  }
  return e;
}

/** 控除不足の添え書き（その給与の月に休職の期間がかかるとき） */
export function absenceDeductionNote(absences: Absence[] | undefined, payYm: string): string {
  return absentInMonth(absences, payYm) ? '休職中のため控除不足に注意（本人から別に集める）' : '';
}

/** 一時帰休（会社の都合による休業）の期間だけ */
export function furloughs(absences: Absence[] | undefined): Absence[] {
  return (absences ?? []).filter((a) => a.reason === 'furlough');
}
