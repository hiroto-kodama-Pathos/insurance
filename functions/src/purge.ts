// 退職者データの消去と、月次確定の匿名化（設計書 2.19）
// ・purgeRetiredEmployees：毎日（日本時間3時）、保管期間の終わった退職者の個人データを消去し、月次確定の氏名・社員番号を匿名IDにする
// ・deleteMistakenEmployee：誤って登録した従業員を、管理者がその場で削除する（月次確定に一度も含まれていない人だけ）
// Firestore はサブコレクションを自動で消さないため、Admin SDK の recursiveDelete で、従業員とサブコレクションをまとめて消す。
import { DocumentData, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { anonymizeRows, findPurgeTargets, lastClosedDates, PersonFields, PurgeQualification } from "./purge-logic.js";

const REGION = "asia-northeast1";
const SI = "apps/socialInsurance";

/** employeeId を持つコレクション（従業員と一緒に消す） */
const BY_EMPLOYEE_ID = ["salaries", "bonuses", "payrollDeductions", "filings"];
/** ドキュメントIDが「従業員ID_…」のコレクション */
const BY_ID_PREFIX = ["adjustments", "revisionCandidates"];

type ClosingDoc = { ref: FirebaseFirestore.DocumentReference; closedAt: string | null; rows?: PersonFields[]; bonusRows?: PersonFields[] };

const toIso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : null);

/** すべての月次確定（closings/{月}/offices/{事業所}）。マスタの offices と同じ名前なので、パスで見分ける */
async function loadClosings(): Promise<ClosingDoc[]> {
  const snap = await getFirestore().collectionGroup("offices").get();
  return snap.docs
    .filter((d) => d.ref.path.startsWith(`${SI}/closings/`))
    .map((d) => {
      const x = d.data();
      return { ref: d.ref, closedAt: toIso(x.closedAt), rows: x.rows, bonusRows: x.bonusRows };
    });
}

/** 1人分の個人データを消す（従業員・サブコレクション・給与・賞与・控除額・届出済み・差額の精算・改定の候補の状態・社員番号の記録） */
async function deleteEmployeeData(employeeId: string): Promise<void> {
  const db = getFirestore();
  const writer = db.bulkWriter();
  for (const name of BY_EMPLOYEE_ID) {
    const snap = await db.collection(`${SI}/${name}`).where("employeeId", "==", employeeId).get();
    for (const d of snap.docs) writer.delete(d.ref);
  }
  for (const name of BY_ID_PREFIX) {
    const snap = await db.collection(`${SI}/${name}`).orderBy("__name__").startAt(`${employeeId}_`).endAt(`${employeeId}_`).get();
    for (const d of snap.docs) writer.delete(d.ref);
  }
  // 社員番号の記録（employeeNumbers/{社員番号}）も消し、その番号をほかの人に使えるようにする（この人を指しているときだけ）
  const emp = await db.doc(`${SI}/employees/${employeeId}`).get();
  const number = emp.get("employeeNumber");
  if (typeof number === "string" && number) {
    const rec = await db.doc(`${SI}/employeeNumbers/${number}`).get();
    if (rec.exists && rec.get("employeeId") === employeeId) writer.delete(rec.ref);
  }
  await writer.close();
  await db.recursiveDelete(db.doc(`${SI}/employees/${employeeId}`));
}

/** 月次確定の行の氏名・社員番号・従業員IDを匿名IDにする。変えた確定の件数を返す */
async function anonymizeClosings(closings: ClosingDoc[], ids: Set<string>): Promise<number> {
  const writer = getFirestore().bulkWriter();
  let count = 0;
  for (const c of closings) {
    const rows = anonymizeRows(c.rows, ids);
    const bonusRows = anonymizeRows(c.bonusRows, ids);
    if (!rows && !bonusRows) continue;
    const update: DocumentData = {};
    if (rows) update.rows = rows;
    if (bonusRows) update.bonusRows = bonusRows;
    writer.update(c.ref, update);
    count++;
  }
  await writer.close();
  return count;
}

/** 日本時間の今日 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export const purgeRetiredEmployees = onSchedule(
  { schedule: "every day 03:00", timeZone: "Asia/Tokyo", region: REGION },
  async () => {
    const db = getFirestore();
    const settings = await db.doc(`${SI}/companySettings/main`).get();
    const years = Number(settings.get("retentionYears") ?? 2);
    if (!Number.isInteger(years) || years < 1) {
      logger.error("保管期間（retentionYears）が正しくないため、消去を止めました", { years });
      return;
    }
    const employees = await db.collection(`${SI}/employees`).get();
    const list = await Promise.all(
      employees.docs.map(async (d) => {
        const qs = await d.ref.collection("qualifications").get();
        return {
          id: d.id,
          qualifications: qs.docs.map((q) => q.data() as PurgeQualification),
        };
      }),
    );
    const closings = await loadClosings();
    const targets = findPurgeTargets(list, lastClosedDates(closings), years, todayJst());
    if (targets.length === 0) {
      logger.info("保管期間の終わった退職者はいません");
      return;
    }
    const ids = new Set(targets.map((t) => t.employeeId));
    // 先に匿名化してから消す（途中で止まっても、確定に名前だけが残ることがないように）
    const anonymized = await anonymizeClosings(closings, ids);
    for (const t of targets) await deleteEmployeeData(t.employeeId);
    // 記録には個人データを残さない（件数と日時だけ）
    await db.collection(`${SI}/purgeLogs`).add({ runAt: Timestamp.now(), purgedCount: targets.length, anonymizedClosings: anonymized, retentionYears: years });
    logger.info("退職者のデータを消去しました", { purgedCount: targets.length, anonymizedClosings: anonymized });
  },
);

/** 誤って登録した従業員を削除する（管理者だけ。月次確定に一度も含まれていない人だけ） */
export const deleteMistakenEmployee = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "ログインしてください");
  if (req.auth.token.siRole !== "admin") throw new HttpsError("permission-denied", "従業員を削除できるのは管理者だけです");
  const { employeeId } = req.data ?? {};
  if (typeof employeeId !== "string" || employeeId === "" || employeeId.includes("/")) throw new HttpsError("invalid-argument", "従業員を選んでください");
  const ref = getFirestore().doc(`${SI}/employees/${employeeId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "この従業員は見つかりません");
  const closings = await loadClosings();
  if (closings.some((c) => [...(c.rows ?? []), ...(c.bonusRows ?? [])].some((r) => r.employeeId === employeeId)))
    throw new HttpsError("failed-precondition", "月次確定に含まれている従業員は削除できません（退職として登録してください）");
  await deleteEmployeeData(employeeId);
  logger.info("誤登録の従業員を削除しました", { by: req.auth.uid });
  return { employeeId };
});
