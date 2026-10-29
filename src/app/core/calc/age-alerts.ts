// 年齢到達の要確認（設計書 2.2・2.7）
// 40歳・65歳・70歳は年齢到達日（誕生日の前日）、75歳は誕生日の属する月から保険料が切り替わる。
import { ageReachedDate, birthdayAt } from './age';
import { monthOf } from './date';
import { isInsuredInMonth, Qualification } from './eligibility';

export type AgeAlertKind = 'careStart' | 'careEnd' | 'pensionEnd' | 'healthEnd';

export type AgeAlert = {
  employeeId: string;
  kind: AgeAlertKind;
  age: 40 | 65 | 70 | 75;
  /** 切り替わりのもとになる日（年齢到達日、75歳は誕生日） */
  date: string;
  /** 一覧に出す説明 */
  message: string;
};

const RULES: { kind: AgeAlertKind; age: AgeAlert['age']; dateOf: (b: string) => string; message: string }[] = [
  { kind: 'careStart', age: 40, dateOf: (b) => ageReachedDate(b, 40), message: 'この月の分から介護保険料がかかります' },
  {
    kind: 'careEnd',
    age: 65,
    dateOf: (b) => ageReachedDate(b, 65),
    message: 'この月の分から給与からの介護保険料がなくなります（市区町村が徴収）',
  },
  {
    kind: 'pensionEnd',
    age: 70,
    dateOf: (b) => ageReachedDate(b, 70),
    message: 'この月の分から厚生年金保険料がなくなります。70歳到達届が必要か確かめてください',
  },
  {
    kind: 'healthEnd',
    age: 75,
    dateOf: (b) => birthdayAt(b, 75),
    message: 'この月の分から健康保険料がなくなります（後期高齢者医療へ）。資格喪失届を出してください',
  },
];

/** 対象月に年齢で保険料が切り替わる人（その月に資格がある人だけ） */
export function ageAlerts(
  employees: { id: string; birthDate: string; qualifications: Qualification[] }[],
  yearMonth: string,
): AgeAlert[] {
  return employees.flatMap((e) =>
    isInsuredInMonth(e.qualifications, yearMonth)
      ? RULES.filter((r) => monthOf(r.dateOf(e.birthDate)) === yearMonth).map((r) => ({
          employeeId: e.id,
          kind: r.kind,
          age: r.age,
          date: r.dateOf(e.birthDate),
          message: r.message,
        }))
      : [],
  );
}
