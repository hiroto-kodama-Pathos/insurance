// 年齢による対象判定（設計書 2.2・5.2・5.5）
import { formatDate, isLeapYear, monthOf, parseDate, previousDay } from './date';

export type CareStatus = 'none' | 'second' | 'first';

/** その年齢の誕生日。2月29日生まれで、その年がうるう年でなければ3月1日とする */
export function birthdayAt(birthDate: string, age: number): string {
  const b = parseDate(birthDate);
  const y = b.y + age;
  if (b.m === 2 && b.d === 29 && !isLeapYear(y)) {
    return formatDate({ y, m: 3, d: 1 });
  }
  return formatDate({ y, m: b.m, d: b.d });
}

/** 年齢到達日（誕生日の前日。年齢計算に関する法律） */
export function ageReachedDate(birthDate: string, age: number): string {
  return formatDate(previousDay(parseDate(birthdayAt(birthDate, age))));
}

/** 介護保険の区分：40歳到達月から第2号、65歳到達月から第1号 */
export function careStatus(birthDate: string, yearMonth: string): CareStatus {
  if (yearMonth < monthOf(ageReachedDate(birthDate, 40))) return 'none';
  if (yearMonth < monthOf(ageReachedDate(birthDate, 65))) return 'second';
  return 'first';
}

/** 厚生年金保険の対象年齢か：70歳到達月の前月まで */
export function isPensionAge(birthDate: string, yearMonth: string): boolean {
  return yearMonth < monthOf(ageReachedDate(birthDate, 70));
}

/** 健康保険の対象年齢か：75歳の誕生日の属する月の前月まで */
export function isHealthAge(birthDate: string, yearMonth: string): boolean {
  return yearMonth < monthOf(birthdayAt(birthDate, 75));
}