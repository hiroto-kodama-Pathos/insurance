// 被扶養者と特定被保険者（設計書 2.6・4章 dependents）
// 被扶養者は、氏名・生年月日と、扶養に入った日（認定日）・外れた日を持つ。
// 特定被保険者制度のある組合健保では、40〜64歳の被扶養者がいる人の介護保険料を、被扶養者の年齢から毎月判定する。
import { birthdayAt, careStatus } from './age';
import { monthOf } from './date';
import { nextDay } from './eligibility';
import { isValidDate } from './new-employee';
import type { Insurer } from './rate';
import { dateLabel } from './year-month';

export type Dependent = {
  name: string;
  birthDate: string;
  /** 扶養に入った日（認定日） */
  certifiedDate: string;
  /** 扶養から外れた日。扶養中は null */
  removedDate: string | null;
  /** 介護保険の適用除外の期間（国外居住・適用除外施設への入所など）。この期間は特定被保険者の判定から外す */
  careExemptions?: DependentCareExemption[];
};

/**
 * 被扶養者の介護保険の適用除外の期間
 * startDate：該当年月日（国外転出・施設入所の翌日）／endDate：非該当年月日（帰国して住所を持った日・施設の退所日）。該当中は null
 */
export type DependentCareExemption = { startDate: string; endDate: string | null };

/**
 * 扶養から外れる日と理由（先の日付のこともある）。生年月日が分からず、外れた日も登録していなければ null
 * - removed：担当者が登録した外れた日
 * - age75：75歳の誕生日（後期高齢者医療の被保険者になり、その日に被扶養者でなくなる）。外れた日を登録していなくても外れる
 * 両方あれば早いほう
 */
export function dependentOut(d: Dependent): { date: string; reason: 'removed' | 'age75' } | null {
  const b75 = isValidDate(d.birthDate) ? birthdayAt(d.birthDate, 75) : null;
  if (d.removedDate !== null && (b75 === null || d.removedDate <= b75)) return { date: d.removedDate, reason: 'removed' };
  return b75 !== null ? { date: b75, reason: 'age75' } : null;
}

/** 扶養から外れた日（その日の時点で外れている。75歳の誕生日を含む）。日付を渡すと、その日までに外れていなければ null */
export function dependentOutDate(d: Dependent, asOf?: string): string | null {
  const out = dependentOut(d);
  if (!out) return null;
  return asOf === undefined || out.date <= asOf ? out.date : null;
}

/** その月に扶養に入っているか（認定日の月から、外れた日の月の前月まで。75歳の誕生日の月からは外れる） */
export function isDependentInMonth(d: Dependent, yearMonth: string): boolean {
  const out = dependentOut(d);
  return monthOf(d.certifiedDate) <= yearMonth && (out === null || yearMonth < monthOf(out.date));
}

/**
 * その月に、被扶養者が介護保険の適用除外か（該当年月日の月から、非該当年月日の月の前月まで）
 * 本人の適用除外（eligibility.ts の exemptedInsurances）と同じ数え方。該当日に第2号の資格を失い、非該当日に取り直すため
 */
export function isDependentCareExemptInMonth(d: Dependent, yearMonth: string): boolean {
  return (d.careExemptions ?? []).some((x) => monthOf(x.startDate) <= yearMonth && (x.endDate === null || yearMonth < monthOf(x.endDate)));
}

/**
 * 特定被保険者として介護保険料をかける月か
 * - 特定被保険者制度のある組合健保だけ判定する（協会けんぽにはない）
 * - その月に扶養に入っていて、40〜64歳（年齢到達日で判定）で、介護保険の適用除外でない被扶養者が1人以上いる
 * 本人が40〜64歳なら、もともと介護保険料がかかる（monthly-premium で本人の年齢が優先される）
 */
export function isSpecialInsuredMonth(insurer: Insurer, dependents: Dependent[] | undefined, yearMonth: string): boolean {
  if (insurer.type !== 'kumiai' || !insurer.specialInsuredEnabled) return false;
  return (dependents ?? []).some(
    // 壊れたデータは読み込みで除くが、念のため計算でも使わない（例外で画面が止まらないように）
    (d) => isValidDependent(d) && isDependentInMonth(d, yearMonth) && careStatus(d.birthDate, yearMonth) === 'second' && !isDependentCareExemptInMonth(d, yearMonth),
  );
}

/** 被扶養者異動届の期限（扶養に入った日・外れた日から5日以内） */
export function dependentReportDeadline(date: string): string {
  let d = date;
  for (let i = 0; i < 5; i++) d = nextDay(d);
  return d;
}

export type DependentInput = { name: string; birthDate: string; certifiedDate: string };
export type DependentErrors = Partial<Record<'name' | 'birthDate' | 'certifiedDate' | 'removedDate', string>>;

/** 75歳の誕生日（後期高齢者医療の被保険者になり、扶養から外れる日。2/29生まれは平年は3/1） */
const birthday75 = (birthDate: string) => birthdayAt(birthDate, 75);

/** 氏名を比べるときの形（空白を除く） */
export const normName = (s: string) => s.replace(/[\s　]/g, '');

/** n年後の同じ日（年の打ち間違いの確認に使う） */
function yearsLater(date: string, n: number): string {
  return `${Number(date.slice(0, 4)) + n}${date.slice(4)}`;
}

/** 被扶養者の登録の確認に使う、本人と、ほかの被扶養者（設計書 2.6） */
export type DependentContext = {
  /** 本人の資格の期間（扶養に入った日に資格があるかを見る） */
  qualifications?: { acquiredDate: string; lostDate: string | null }[];
  /** 本人（本人を被扶養者にする誤りを止める） */
  self?: { name: string; birthDate: string };
  /** すでに登録してあるほかの被扶養者（直すときは、直している人を除いて渡す） */
  others?: { name: string; birthDate: string }[];
};

/**
 * 被扶養者の追加・訂正のチェック
 * @param today 今日 'YYYY-MM-DD'。渡すと、生年月日が今日より後・扶養に入った日が1年以上先でないかも確かめる
 * @param ctx 本人の資格の期間・本人・ほかの被扶養者。渡したものだけ確かめる
 */
export function checkDependent(input: DependentInput, today?: string, ctx: DependentContext = {}): DependentErrors {
  const e: DependentErrors = {};
  const name = normName(input.name);
  if (!input.name.trim()) e.name = '氏名を入力してください';
  else if (input.name.trim().length > 50) e.name = '氏名は50文字以内で入力してください';
  else if (ctx.self && normName(ctx.self.name) === name && ctx.self.birthDate === input.birthDate)
    e.name = '本人を被扶養者にはできません（氏名・生年月日が本人と同じです）';
  else if ((ctx.others ?? []).some((o) => normName(o.name) === name && o.birthDate === input.birthDate))
    e.name = 'この人（氏名・生年月日が同じ人）は、すでに被扶養者として登録されています。期間を変えるときは、その人の「直す」を使ってください';
  if (!isValidDate(input.birthDate)) e.birthDate = '生年月日を正しく入力してください';
  else if (today && input.birthDate > today) e.birthDate = '生年月日に、今日より後の日は入れられません';
  if (!isValidDate(input.certifiedDate)) e.certifiedDate = '扶養に入った日を正しく入力してください';
  else if (today && input.certifiedDate > yearsLater(today, 1)) e.certifiedDate = '扶養に入った日が1年以上先です。年を確かめてください';
  else if (isValidDate(input.birthDate) && input.certifiedDate < input.birthDate)
    e.certifiedDate = '扶養に入った日は生年月日以降の日にしてください';
  // 75歳以上（誕生日から）は後期高齢者医療制度の対象で、健康保険の被扶養者になれない（設計書 2.8）
  else if (isValidDate(input.birthDate) && input.certifiedDate >= birthday75(input.birthDate))
    e.birthDate = '75歳以上の人は後期高齢者医療制度の対象のため、被扶養者として登録できません';
  else if (ctx.qualifications && !ctx.qualifications.some((q) => q.acquiredDate <= input.certifiedDate && (q.lostDate === null || input.certifiedDate < q.lostDate)))
    e.certifiedDate = '扶養に入った日に、本人の社会保険の資格がありません（資格取得日〜資格喪失日の前日にしてください）';
  return e;
}

/**
 * 扶養から外れた日のチェック
 * @param today 今日。渡すと、1年以上先の日を止める
 */
export function checkRemoval(d: Dependent, removedDate: string, today?: string): DependentErrors {
  if (!isValidDate(removedDate)) return { removedDate: '扶養から外れた日を正しく入力してください' };
  if (removedDate <= d.certifiedDate) return { removedDate: '扶養から外れた日は、扶養に入った日より後の日にしてください' };
  if (today && removedDate > yearsLater(today, 1)) return { removedDate: '扶養から外れた日が1年以上先です。年を確かめてください' };
  if (isValidDate(d.birthDate) && removedDate > birthday75(d.birthDate))
    return { removedDate: `75歳の誕生日（${dateLabel(birthday75(d.birthDate))}）に扶養から外れています。外れた日はその日までにしてください` };
  return {};
}

const isDate = (v: unknown): v is string => typeof v === 'string' && isValidDate(v);

/**
 * 計算に使える被扶養者のデータか（氏名・生年月日・扶養に入った日・外れた日・介護保険の適用除外の形）。
 * 壊れたデータ（直接書き込まれたものなど）で計算が止まらないよう、読み込むときにこれで分け、
 * 壊れたものは計算に使わず詳細とトップに出す（設計書 2.6）
 */
export function isValidDependent(d: unknown): d is Dependent {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  if (typeof x['name'] !== 'string' || !x['name'].trim()) return false;
  if (!isDate(x['birthDate']) || !isDate(x['certifiedDate']) || x['certifiedDate'] < x['birthDate']) return false;
  const removed = x['removedDate'];
  // 外れた日は扶養に入った日以後（資格を失った日に一緒に外れる場合は、同じ日もありうる）
  if (removed !== null && removed !== undefined && (!isDate(removed) || removed < x['certifiedDate'])) return false;
  const ex = x['careExemptions'];
  if (ex === undefined || ex === null) return true;
  return (
    Array.isArray(ex) &&
    ex.every((y) => y && isDate(y.startDate) && (y.endDate === null || y.endDate === undefined || (isDate(y.endDate) && y.endDate > y.startDate)))
  );
}

export type DependentCareExemptionInput = { startDate: string; endDate: string };
export type DependentCareExemptionErrors = Partial<Record<'startDate' | 'endDate', string>>;

/**
 * 被扶養者の介護保険の適用除外の期間のチェック（追加・非該当年月日の登録）
 * @param editingIndex 非該当年月日を入れる期間の番号（追加のときは null）
 */
export function checkDependentCareExemption(
  d: Dependent,
  input: DependentCareExemptionInput,
  editingIndex: number | null = null,
  today?: string,
): DependentCareExemptionErrors {
  const e: DependentCareExemptionErrors = {};
  const out = dependentOut(d);
  if (!isValidDate(input.startDate)) e.startDate = '該当年月日を正しく入力してください';
  else if (input.startDate < d.birthDate) e.startDate = '該当年月日は生年月日以降の日にしてください';
  else if (editingIndex === null && today && input.startDate > yearsLater(today, 1)) e.startDate = '該当年月日が1年以上先です。年を確かめてください';
  // 被扶養者の介護保険の適用除外は、特定被保険者の判定（扶養中の40〜64歳）にだけ使う。扶養でない期間・対象年齢でない人には登録しない
  else if (editingIndex === null && input.startDate < d.certifiedDate) e.startDate = `該当年月日は、扶養に入った日（${dateLabel(d.certifiedDate)}）以後にしてください`;
  else if (editingIndex === null && out && input.startDate >= out.date)
    e.startDate = `該当年月日は、扶養から外れた日（${dateLabel(out.date)}）より前にしてください`;
  else if (editingIndex === null && careStatus(d.birthDate, monthOf(input.startDate)) !== 'second')
    e.startDate =
      careStatus(d.birthDate, monthOf(input.startDate)) === 'none'
        ? 'この月はまだ40歳になっていないため、介護保険の適用除外は要りません（介護保険は40〜64歳の人の制度です）'
        : 'この月は65歳以上のため、被扶養者の介護保険の適用除外は要りません（特定被保険者の判定は40〜64歳の被扶養者だけです）';
  if (input.endDate !== '' && !isValidDate(input.endDate)) e.endDate = '非該当年月日を正しく入力してください';
  else if (input.endDate !== '' && isValidDate(input.startDate) && input.endDate <= input.startDate)
    e.endDate = '非該当年月日は該当年月日より後の日にしてください';
  if (Object.keys(e).length > 0) return e;
  const end = input.endDate === '' ? '9999-12-31' : input.endDate;
  const overlap = (d.careExemptions ?? []).some(
    (x, i) => i !== editingIndex && x.startDate < end && (x.endDate === null || input.startDate < x.endDate),
  );
  if (overlap) e.startDate = 'この人の適用除外の期間と重なっています';
  return e;
}

/** 期間を足す・非該当年月日を入れたあとの一覧（該当年月日の順） */
export function withCareExemption(d: Dependent, input: DependentCareExemptionInput, editingIndex: number | null = null): DependentCareExemption[] {
  const next = { startDate: input.startDate, endDate: input.endDate === '' ? null : input.endDate };
  const list = [...(d.careExemptions ?? [])];
  if (editingIndex === null) list.push(next);
  else list[editingIndex] = next;
  return list.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** 表示用：「2026-04-01〜2027-03-01」「2026-04-01〜（該当中）」 */
export function careExemptionLabel(x: DependentCareExemption): string {
  return `${dateLabel(x.startDate)}〜${x.endDate ? dateLabel(x.endDate) : '（該当中）'}`;
}
