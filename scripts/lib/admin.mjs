// 本番の Firestore（kensyu10170）に、運営者がシステム共通マスタを入れるときの共通処理
// 鍵の場所は環境変数 GOOGLE_APPLICATION_CREDENTIALS で渡す（使い方は load-grades.mjs の先頭を参照）
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const PROJECT_ID = 'kensyu10170';

/** --yes が付いていれば書き込む。付いていなければ確認だけ */
export const shouldWrite = process.argv.includes('--yes');

/** 本番に書き込める状態かを確かめる（だめなら理由を出して終わる） */
export function checkEnvironment() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(`FIRESTORE_EMULATOR_HOST（${process.env.FIRESTORE_EMULATOR_HOST}）が設定されているため、本番ではなくエミュレータに書き込みます。`);
    console.error('本番に入れるときは、このターミナルで  Remove-Item Env:FIRESTORE_EMULATOR_HOST  を実行してから、やり直してください。');
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS（サービスアカウントの鍵の場所）が設定されていません。load-grades.mjs の先頭の使い方を見てください。');
    process.exit(1);
  }
}

/** apps/socialInsurance/{name} への参照を返す関数と、db */
export function openSi() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const si = db.collection('apps').doc('socialInsurance');
  return { db, col: (name) => si.collection(name) };
}

/** 同じIDで上書きする（何回実行しても同じ結果） */
export async function putAll(db, col, docs) {
  const batch = db.batch();
  for (const d of docs) batch.set(col.doc(d.id), d.data);
  await batch.commit();
}
