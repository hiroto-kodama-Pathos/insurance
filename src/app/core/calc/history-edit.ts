// 登録した履歴の訂正・削除の入力チェック（設計書 3.1「登録した情報の訂正・削除」）
// 追加のときと同じ基準で確かめる。訂正では、直している行そのものは比べる相手から除く。
// 削除は、消すと計算できなくなる場合（資格がある人の標準報酬月額が0件になるなど）だけ止める。
import { AGE75_ACQUIRE_MESSAGE, is75OrOlderOn } from './age';
import { nextDay, Qualification } from './eligibility';
import { isValidDate } from './new-employee';
import { Assignment } from './office';
import { Errors } from './employee-edit';
import { dateLabel } from './year-month';

type WithId<T> = T & { id: string };

/** 前の日（'YYYY-MM-DD'） */
export function prevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// ---- 生年月日 ----

/**
 * 生年月日の訂正。新規登録と同じく、今日より後の日と、資格取得日（入社日）以降の日は入れない
 * @param firstAcquired 最初の資格取得日（加入したことがない人は null）
 */
export function checkBirthDateChange(
  current: string,
  value: string,
  today: string,
  firstAcquired: string | null,
  /** すべての資格取得日（新しい生年月日で、どれかの資格取得日に75歳以上になるなら止める） */
  acquiredDates: string[] = [],
): Errors {
  if (!isValidDate(value)) return { birthDate: '生年月日を正しく入力してください' };
  if (value > today) return { birthDate: '生年月日に、今日より後の日は入れられません' };
  if (value === current) return { birthDate: '今の生年月日と同じです' };
  if (firstAcquired && value >= firstAcquired) return { birthDate: '生年月日は、資格取得日（入社日）より前の日にしてください' };
  const over75 = acquiredDates.filter((d) => is75OrOlderOn(value, d)).sort().at(-1);
  if (over75)
    return { birthDate: `この生年月日だと、資格取得日（${dateLabel(over75)}）に75歳以上になり、健康保険・厚生年金の被保険者になれません。生年月日の年を確かめてください` };
  return {};
}

// ---- 資格の期間 ----

/** 資格の期間の訂正の入力。lostReason が空なら加入中（退職・喪失の取り消し） */
export type QualificationEditInput = {
  acquiredDate: string;
  /** 喪失の理由（'' = 加入中） */
  lostReason: string;
  /** 退職なら退職日、ほかの理由なら資格喪失日 */
  endDate: string;
};

/** 登録してある資格の期間を、訂正の入力の形にする（退職は資格喪失日の前日＝退職日を出す） */
export function toQualificationEdit(q: Qualification): QualificationEditInput {
  const reason = q.lostDate ? (q.lostReason ?? 'other') : '';
  const endDate = q.lostDate ? (reason === 'retirement' ? prevDay(q.lostDate) : q.lostDate) : '';
  return { acquiredDate: q.acquiredDate, lostReason: reason, endDate };
}

/**
 * 資格の期間の訂正（資格取得日・退職日／資格喪失日の誤り、退職の取り消し）
 * ほかの資格の期間と重なる訂正は入れない（加入中は1つだけ）
 * @returns エラーと、保存する資格喪失日（加入中は null）
 */
export function checkQualificationEdit(
  all: WithId<Qualification>[],
  id: string,
  input: QualificationEditInput,
  birthDate?: string,
): { errors: Errors; lostDate: string | null } {
  const errors: Errors = {};
  if (!isValidDate(input.acquiredDate)) errors['acquiredDate'] = '資格取得日を正しく入力してください';
  // 新規登録と同じく、生年月日より後・75歳未満（被保険者になれる年齢）に限る
  else if (birthDate && isValidDate(birthDate) && input.acquiredDate <= birthDate) errors['acquiredDate'] = '資格取得日は生年月日より後の日付にしてください';
  else if (birthDate && isValidDate(birthDate) && is75OrOlderOn(birthDate, input.acquiredDate)) errors['acquiredDate'] = AGE75_ACQUIRE_MESSAGE;
  let lostDate: string | null = null;
  if (input.lostReason) {
    const retire = input.lostReason === 'retirement';
    if (!isValidDate(input.endDate)) errors['endDate'] = retire ? '退職日を正しく入力してください' : '資格喪失日を正しく入力してください';
    else {
      lostDate = retire ? nextDay(input.endDate) : input.endDate;
      if (isValidDate(input.acquiredDate) && lostDate <= input.acquiredDate)
        errors['endDate'] = retire ? '退職日は資格取得日以降の日付にしてください' : '資格喪失日は資格取得日より後の日付にしてください';
    }
  }
  if (Object.keys(errors).length === 0) {
    const end = lostDate ?? '9999-12-31';
    const hit = all.find((q) => q.id !== id && q.acquiredDate < end && input.acquiredDate < (q.lostDate ?? '9999-12-31'));
    if (hit)
      errors['acquiredDate'] = `ほかの資格の期間（${dateLabel(hit.acquiredDate)}〜${hit.lostDate ? dateLabel(hit.lostDate) : '加入中'}）と重なっています`;
  }
  return { errors, lostDate: Object.keys(errors).length === 0 ? lostDate : null };
}

/** 資格の期間の削除（誤って登録した再加入など）。1つしかない資格は消さない */
export function checkQualificationDelete(all: Qualification[]): string | null {
  if (all.length <= 1)
    return '資格の期間が1つだけのときは削除できません。日付の誤りは「直す」で直してください（入社自体が誤りなら「誤登録として削除」を使います）';
  return null;
}

// ---- 標準報酬月額 ----

/** 標準報酬月額の履歴の削除。資格がある人は、1件は残す（0件では保険料を計算できない） */
export function checkStandardDelete(count: number, hasQualification: boolean): string | null {
  if (count <= 1 && hasQualification) return '資格がある人の標準報酬月額は、1件は残してください。誤りは「直す」で直してください';
  return null;
}

// ---- 所属事業所・被保険者区分・支払区分（開始日つきの履歴） ----

/**
 * 被保険者区分・支払区分の履歴の訂正：変わった日が正しく、ほかの行と同じ日でないこと
 * @param others 直している行を除いた履歴
 * @param what 「区分」「支払区分」など、すでにあるときの文に使う名前
 */
export function checkDatedEdit(others: { validFrom: string }[], validFrom: string, key: string, what: string): Errors {
  if (!isValidDate(validFrom)) return { [key]: '変わった日を正しく入力してください' };
  if (others.some((x) => x.validFrom === validFrom)) return { [key]: `この日からの${what}はすでに登録されています` };
  return {};
}

/**
 * 所属事業所の履歴の訂正。開始日が重ならないことと、並べたときに前後が同じ事業所にならないこと
 * （同じ事業所が続くなら、異動ではないので1件にまとめる）
 */
export function checkAssignmentEdit(all: WithId<Assignment>[], id: string | null, input: Assignment): Errors {
  const others = all.filter((a) => a.id !== id);
  if (!isValidDate(input.validFrom)) return { assignmentDate: '開始日を正しく入力してください' };
  if (!input.officeId) return { assignmentOffice: '適用事業所を選んでください' };
  if (others.some((a) => a.validFrom === input.validFrom)) return { assignmentDate: 'この日からの所属はすでに登録されています' };
  const sorted = [...others, input].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const i = sorted.indexOf(input);
  if (sorted[i - 1]?.officeId === input.officeId || sorted[i + 1]?.officeId === input.officeId)
    return { assignmentOffice: '前後の所属と同じ事業所です（異動ではないので、1件にまとめてください）' };
  return {};
}

/** 所属事業所の履歴の削除。1件しかない所属は消さない。消したあとで前後が同じ事業所になるなら、それも止める */
export function checkAssignmentDelete(all: WithId<Assignment>[], id: string): string | null {
  if (all.length <= 1) return '所属が1件だけのときは削除できません。誤りは「直す」で直してください';
  const sorted = all.filter((a) => a.id !== id).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].officeId === sorted[i].officeId)
      return `削除すると、${dateLabel(sorted[i - 1].validFrom)}と${dateLabel(sorted[i].validFrom)}からの所属が同じ事業所で続きます。先にどちらかを直してください`;
  }
  return null;
}

/** 所属の履歴から、これまでに所属した事業所（担当範囲の絞り込みに使う officeIds）を求める */
export function officeIdsOf(assignments: Assignment[]): string[] {
  return [...new Set(assignments.map((a) => a.officeId))];
}

// ---- 休業 ----

/** 産休・育休の期間が、ほかの休業と重ならないか（訂正では、直している行を除いて比べる） */
export function checkLeaveOverlap(
  others: { type: 'maternity' | 'childcare'; startDate: string; endDate: string | null }[],
  startDate: string,
  endDate: string,
): Errors {
  if (!isValidDate(startDate)) return {};
  const end = endDate || '9999-12-31';
  const hit = others.find((l) => l.startDate <= end && startDate <= (l.endDate ?? '9999-12-31'));
  if (!hit) return {};
  const label = hit.type === 'maternity' ? '産前産後休業' : '育児休業';
  return { startDate: `ほかの休業（${label} ${dateLabel(hit.startDate)}〜${hit.endDate ? dateLabel(hit.endDate) : '休業中'}）と期間が重なっています` };
}

// ---- 被扶養者 ----

/**
 * 資格の期間を直すと、扶養に入った日が本人の資格の期間の外になってしまう被扶養者（直す前は中にあった人だけ）。
 * 被扶養者は本人に資格がある期間にだけ扶養に入れる（被扶養者の登録と同じ決まり）ので、資格取得日を後ろにずらすときなどに止める
 */
export function dependentsLeftOutside(
  dependents: { id: string; name: string; certifiedDate: string }[],
  before: { acquiredDate: string; lostDate: string | null }[],
  after: { acquiredDate: string; lostDate: string | null }[],
): { id: string; name: string; certifiedDate: string }[] {
  const inside = (qs: { acquiredDate: string; lostDate: string | null }[], d: string) =>
    qs.some((q) => q.acquiredDate <= d && (q.lostDate === null || d < q.lostDate));
  return dependents.filter((x) => inside(before, x.certifiedDate) && !inside(after, x.certifiedDate));
}

/**
 * 資格の期間を直したとき、同じ日に扶養から外れていた被扶養者の「扶養から外れた日」も合わせる
 * （退職を登録すると、扶養中の人は資格喪失日に外れるため）。退職を取り消したら扶養に戻す
 */
export function dependentMoves(
  dependents: { id: string; removedDate: string | null }[],
  oldLostDate: string | null,
  newLostDate: string | null,
): { id: string; removedDate: string | null }[] {
  if (!oldLostDate || oldLostDate === newLostDate) return [];
  return dependents.filter((d) => d.removedDate === oldLostDate).map((d) => ({ id: d.id, removedDate: newLostDate }));
}
