// 被扶養者と特定被保険者（設計書 2.6・4章 dependents）
// 被扶養者は、氏名・生年月日と、扶養に入った日（認定日）・外れた日を持つ。
// 特定被保険者制度のある組合健保では、40〜64歳の被扶養者がいる人の介護保険料を、被扶養者の年齢から毎月判定する。
import { careStatus } from './age';
import { monthOf } from './date';
import { nextDay } from './eligibility';
import { isValidDate } from './new-employee';
import type { Insurer } from './rate';

export type Dependent = {
  name: string;
  birthDate: string;
  /** 扶養に入った日（認定日） */
  certifiedDate: string;
  /** 扶養から外れた日。扶養中は null */
  removedDate: string | null;
};

/** その月に扶養に入っているか（認定日の月から、外れた日の月の前月まで） */
export function isDependentInMonth(d: Dependent, yearMonth: string): boolean {
  return monthOf(d.certifiedDate) <= yearMonth && (d.removedDate === null || yearMonth < monthOf(d.removedDate));
}

/**
 * 特定被保険者として介護保険料をかける月か
 * - 特定被保険者制度のある組合健保だけ判定する（協会けんぽにはない）
 * - その月に扶養に入っていて、40〜64歳（年齢到達日で判定）の被扶養者が1人以上いる
 * 本人が40〜64歳なら、もともと介護保険料がかかる（monthly-premium で本人の年齢が優先される）
 */
export function isSpecialInsuredMonth(insurer: Insurer, dependents: Dependent[] | undefined, yearMonth: string): boolean {
  if (insurer.type !== 'kumiai' || !insurer.specialInsuredEnabled) return false;
  return (dependents ?? []).some((d) => isDependentInMonth(d, yearMonth) && careStatus(d.birthDate, yearMonth) === 'second');
}

/** 被扶養者異動届の期限（扶養に入った日・外れた日から5日以内） */
export function dependentReportDeadline(date: string): string {
  let d = date;
  for (let i = 0; i < 5; i++) d = nextDay(d);
  return d;
}

export type DependentInput = { name: string; birthDate: string; certifiedDate: string };
export type DependentErrors = Partial<Record<'name' | 'birthDate' | 'certifiedDate' | 'removedDate', string>>;

export function checkDependent(input: DependentInput): DependentErrors {
  const e: DependentErrors = {};
  if (!input.name.trim()) e.name = '氏名を入力してください';
  else if (input.name.trim().length > 50) e.name = '氏名は50文字以内で入力してください';
  if (!isValidDate(input.birthDate)) e.birthDate = '生年月日を正しく入力してください';
  if (!isValidDate(input.certifiedDate)) e.certifiedDate = '扶養に入った日を正しく入力してください';
  else if (isValidDate(input.birthDate) && input.certifiedDate < input.birthDate)
    e.certifiedDate = '扶養に入った日は生年月日以降の日にしてください';
  return e;
}

export function checkRemoval(d: Dependent, removedDate: string): DependentErrors {
  if (!isValidDate(removedDate)) return { removedDate: '扶養から外れた日を正しく入力してください' };
  if (removedDate <= d.certifiedDate) return { removedDate: '扶養から外れた日は、扶養に入った日より後の日にしてください' };
  return {};
}
