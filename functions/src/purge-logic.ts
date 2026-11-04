// 退職者データの消去の判定（設計書 2.19）。Firestore を読まない純粋な関数だけを置き、テストできるようにする
import { createHash } from "node:crypto";

export type PurgeQualification = { acquiredDate: string; lostDate: string | null; lostReason?: string | null };

/** 消去の対象にする喪失の理由（退職・死亡）。加入の条件から外れた人・75歳到達の人は在籍していることがあるので対象にしない */
export const PURGE_REASONS = ["retirement", "death"];

/** 退職して資格を失った日（すべての資格の期間が閉じていて、最後の喪失の理由が退職・死亡）。在籍中・未加入なら null */
export function retiredOn(qualifications: PurgeQualification[]): string | null {
  if (qualifications.length === 0) return null;
  if (qualifications.some((q) => q.lostDate === null)) return null;
  const last = [...qualifications].sort((a, b) => (b.lostDate ?? "").localeCompare(a.lostDate ?? ""))[0];
  return PURGE_REASONS.includes(last.lostReason ?? "") ? last.lostDate : null;
}

/** n年後の日（2月29日は2月28日にする） */
export function addYears(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y + n, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/**
 * 消去してよい日。最後の月次確定（その人を含む確定をした日）と資格喪失日の遅いほうから、保管期間がたった日
 * （退職日から数えると、退職後の確定・訂正から保管期間がたたないうちに消えるおそれがあるため）
 */
export function purgeDueDate(lostDate: string, lastClosedOn: string | null, retentionYears: number): string {
  const base = lastClosedOn && lastClosedOn > lostDate ? lastClosedOn : lostDate;
  return addYears(base, retentionYears);
}

export type PurgeCandidate = { employeeId: string; lostDate: string; lastClosedOn: string | null; dueDate: string };

/** 今日消去する人 */
export function findPurgeTargets(
  employees: { id: string; qualifications: PurgeQualification[] }[],
  lastClosedOn: Map<string, string>,
  retentionYears: number,
  today: string,
): PurgeCandidate[] {
  return employees.flatMap((e) => {
    const lost = retiredOn(e.qualifications);
    if (!lost) return [];
    const closed = lastClosedOn.get(e.id) ?? null;
    const dueDate = purgeDueDate(lost, closed, retentionYears);
    return dueDate <= today ? [{ employeeId: e.id, lostDate: lost, lastClosedOn: closed, dueDate }] : [];
  });
}

/** 月次確定の行の、従業員を表す項目 */
export type PersonFields = { employeeId: string; employeeNumber: string; name: string };

/** 匿名ID（同じ人は、どの月の確定でも同じIDになる。元の従業員IDには戻せない） */
export function anonymousId(employeeId: string): string {
  return `退職者-${createHash("sha256").update(employeeId).digest("hex").slice(0, 8)}`;
}

/**
 * 月次確定の行のうち、消去する人の氏名・社員番号・従業員IDを匿名IDに置き換える。金額などは残す
 * @returns 置き換えた行（変わらなければ null）
 */
export function anonymizeRows<T extends PersonFields>(rows: T[] | undefined, ids: Set<string>): T[] | null {
  if (!rows || !rows.some((r) => ids.has(r.employeeId))) return null;
  return rows.map((r) => {
    if (!ids.has(r.employeeId)) return r;
    const anon = anonymousId(r.employeeId);
    return { ...r, employeeId: anon, employeeNumber: anon, name: anon };
  });
}

/** 確定日時（ISO）を、日本時間の日付にする */
export function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 従業員ごとの、その人を含む最後の確定の日（日本時間） */
export function lastClosedDates(closings: { closedAt: string | null; rows?: PersonFields[]; bonusRows?: PersonFields[] }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of closings) {
    if (!c.closedAt) continue;
    const day = jstDate(c.closedAt);
    for (const r of [...(c.rows ?? []), ...(c.bonusRows ?? [])]) {
      const cur = map.get(r.employeeId);
      if (!cur || cur < day) map.set(r.employeeId, day);
    }
  }
  return map;
}
