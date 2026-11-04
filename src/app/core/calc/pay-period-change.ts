// 支払月・締め日を変えた月の扱い（設計書 2.13・事例集 定時決定 問2・問3、随時改定 問7）
// 支払月の給与の計算期間を、前の支払月の締め日の翌日〜その月の締め日として求め、
// 変更後の区分なら本来いつからいつまでだったか（通常の期間）と比べて、変更月の種類を決める。
//   ・期間が短い（締め日を早めた）：支払基礎日数が17日以上ならそのまま平均に使う（17日未満は支払基礎日数で除かれる）
//   ・給与のない月（当月払い→翌月払い）：平均から除く
//   ・期間が長い（締め日を遅らせて暦日を超えた）：超えた分を除いて平均する
//   ・2か月分（翌月払い→当月払い）：変更前の給与を除いて平均する
// 長い・2か月分の月は、除く額が給与のデータからは分からないので、担当者が給与ごとに「算定から除く額」を入れる。
import { payPeriodEnd, PayrollCutoff } from './insured-type';
import { addMonths } from './salary';

export type PeriodChangeKind = 'shorter' | 'noPay' | 'longer' | 'twoPeriods';

export type PeriodChange = {
  yearMonth: string;
  kind: PeriodChangeKind;
  /** その月の給与の計算期間（給与のない月は null） */
  periodStart: string | null;
  periodEnd: string;
  /** 実際の計算期間の日数 */
  actualDays: number;
  /** 変更後の区分での、通常の計算期間の日数 */
  normalDays: number;
};

const toUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};
const nextDay = (d: string) => new Date(toUtc(d) + 86_400_000).toISOString().slice(0, 10);
/** a の翌日から b までの日数（b が a 以前なら 0 以下） */
const daysAfter = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

/**
 * その支払月が支払月・締め日の変更月なら、その種類（変更月でなければ null）
 * @param cutoffOf 支払月ごとの、その人の締め日と支払月（支払区分）
 */
export function periodChange(yearMonth: string, cutoffOf: (ym: string) => PayrollCutoff): PeriodChange | null {
  const prevYm = addMonths(yearMonth, -1);
  const before = cutoffOf(prevYm);
  const after = cutoffOf(yearMonth);
  if (before.day === after.day && before.paidIn === after.paidIn) return null;
  const prevEnd = payPeriodEnd(prevYm, before);
  const end = payPeriodEnd(yearMonth, after);
  const actualDays = daysAfter(prevEnd, end);
  const normalDays = daysAfter(payPeriodEnd(prevYm, after), end);
  const base = { yearMonth, periodEnd: end, actualDays, normalDays };
  if (actualDays <= 0) return { ...base, kind: 'noPay', periodStart: null };
  const periodStart = nextDay(prevEnd);
  if (actualDays < normalDays) return { ...base, kind: 'shorter', periodStart };
  if (actualDays > normalDays) {
    // 翌月払いから当月払いに変えた月は、前の月の分と、その月の分の2か月分になる
    const kind = before.paidIn === 'nextMonth' && after.paidIn === 'sameMonth' ? 'twoPeriods' : 'longer';
    return { ...base, kind, periodStart };
  }
  return null;
}

/**
 * 支払月の給与の計算期間の暦日数（前の支払月の締め日の翌日〜その月の締め日）。月給制で欠勤控除がない人の支払基礎日数
 * 締め日・支払月を変えた月は、実際の計算期間の日数（給与のない月は null）。給与の画面では、変更月には初期値を入れない
 */
export function periodCalendarDays(yearMonth: string, cutoffOf: (ym: string) => PayrollCutoff): number | null {
  const prevYm = addMonths(yearMonth, -1);
  const days = daysAfter(payPeriodEnd(prevYm, cutoffOf(prevYm)), payPeriodEnd(yearMonth, cutoffOf(yearMonth)));
  return days > 0 ? days : null;
}

/**
 * 支払基礎日数の初期値に暦日数を入れる人か（月給制とみなせる人）
 * - 雇用区分が正社員・役員（加入対象の判定で登録した区分）
 * - または、前月の支払基礎日数が前月の暦日数と同じで、時給単価がない人（CSVで登録して雇用区分のない人も、前月の入力から見分ける）
 * パート・アルバイトなど日給・時給の人には入れない（実際の出勤日数と違う日数が入ると、17日の判定を誤るため）
 */
export function isMonthlyPaid(
  employmentType: string | null | undefined,
  previous: { paymentBaseDays: number; hourlyRate?: number | null } | null,
  previousCalendarDays: number | null,
): boolean {
  if (employmentType === 'regular' || employmentType === 'officer') return true;
  if (employmentType) return false; // 契約社員・パート・アルバイトは、前月の入力から決めない
  return previous !== null && previousCalendarDays !== null && !previous.hourlyRate && previous.paymentBaseDays === previousCalendarDays;
}

/** 担当者が「算定から除く額」を入れる必要がある変更月か */
export function needsExclusion(c: PeriodChange | null): boolean {
  return c?.kind === 'longer' || c?.kind === 'twoPeriods';
}

const mmdd = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const month = (ym: string) => `${Number(ym.slice(5))}月`;

/** 画面・備考に出す説明。excluded：入力した「算定から除く額」（円。入れていなければ 0） */
export function periodChangeNote(c: PeriodChange, excluded: number): string {
  const range = c.periodStart ? `${mmdd(c.periodStart)}〜${mmdd(c.periodEnd)}の${c.actualDays}日分` : '';
  switch (c.kind) {
    case 'shorter':
      return `${month(c.yearMonth)}は締め日の変更で期間が短い月（${range}。支払基礎日数が17日以上なら平均に使う）`;
    case 'noPay':
      return `${month(c.yearMonth)}は支払月の変更（当月払い→翌月払い）の月（平均から除く）`;
    case 'longer':
      return excluded > 0
        ? `${month(c.yearMonth)}は締め日の変更で暦日を超えた月（${range}）。超えた${c.actualDays - c.normalDays}日分として${excluded.toLocaleString('ja-JP')}円を除いて平均`
        : `${month(c.yearMonth)}は締め日の変更で暦日を超えた月（${range}）。超えた${c.actualDays - c.normalDays}日分の額を、給与の画面の「算定から除く額」に入れる`;
    case 'twoPeriods':
      return excluded > 0
        ? `${month(c.yearMonth)}は支払月の変更（翌月払い→当月払い）で2か月分を払った月。変更前の給与${excluded.toLocaleString('ja-JP')}円を除いて平均`
        : `${month(c.yearMonth)}は支払月の変更（翌月払い→当月払い）で2か月分を払った月。変更前の給与の額を、給与の画面の「算定から除く額」に入れる`;
  }
}
