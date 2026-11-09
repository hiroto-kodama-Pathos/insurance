// 本番の Firestore（kensyu10170）の第三課題のデータを、提出前の初期状態に戻す（入力したデータをすべて消す。運営者が使う）
//
// 消すもの：apps/socialInsurance の下の、入力したデータすべて
//   従業員（サブコレクション・変更の記録を含む）・社員番号の記録・給与・賞与・控除額・届出済み・改定の候補の状態・差額の精算・
//   月次確定・照合・事業所・支払区分・賞与の種類・会社の設定（列の対応づけを含む）・組合健保と、その料率・消去の記録 など
// 残すもの：システム共通のマスタ（load-grades / load-rates / load-eligibility で入れたもの）
//   等級表（grades・gradeThresholds）・厚生年金の料率（pensionRates）・加入対象の判定の基準（eligibilityRules）・
//   協会けんぽ（insurers/kyokai）と協会けんぽの料率（insurerRates の insurerId が kyokai のもの）
// 触らないもの：apps/socialInsurance の外（第二課題のデータ）、ログインのアカウント（Firebase Authentication と権限）
//
// 使い方（鍵の場所の指定は load-grades.mjs の先頭と同じ）：
//   1. 確認だけ（消さない）：node scripts/reset-production.mjs
//        消すもの・残すものの件数を表示する
//   2. 消す                ：node scripts/reset-production.mjs --yes
//   元に戻せない。消す前に、確認だけの表示で件数を確かめる
import { getAuth } from 'firebase-admin/auth';
import { checkEnvironment, openSi, PROJECT_ID, shouldWrite } from './lib/admin.mjs';

/** まるごと残すコレクション（システム共通のマスタ） */
const KEEP = ['grades', 'gradeThresholds', 'pensionRates', 'eligibilityRules'];
/** 協会けんぽだけを残し、組合健保（管理者が足したもの）は消すコレクション */
const KYOKAI_ONLY = { insurers: (d) => d.id === 'kyokai', insurerRates: (d) => d.get('insurerId') === 'kyokai' };

checkEnvironment();
const { db } = openSi();
const si = db.collection('apps').doc('socialInsurance');
console.log(`対象：${PROJECT_ID}（本番）の apps/socialInsurance\n`);

const collections = (await si.listCollections()).sort((a, b) => a.id.localeCompare(b.id));
const toDelete = collections.filter((c) => !KEEP.includes(c.id) && !(c.id in KYOKAI_ONLY));

console.log('消すもの');
for (const c of toDelete) console.log(`　${c.id}：${(await c.count().get()).data().count}件${c.id === 'employees' || c.id === 'closings' ? '（サブコレクションも消す）' : ''}`);
const partial = {};
for (const [name, keep] of Object.entries(KYOKAI_ONLY)) {
  const snap = await si.collection(name).get();
  partial[name] = snap.docs.filter((d) => !keep(d));
  console.log(`　${name}：${partial[name].length}件（組合健保の分。協会けんぽの${snap.size - partial[name].length}件は残す）`);
}

console.log('\n残すもの');
for (const name of KEEP) console.log(`　${name}：${(await si.collection(name).count().get()).data().count}件`);
const users = (await getAuth().listUsers(1000)).users.filter((u) => u.customClaims?.siRole);
console.log(`　ログインのアカウント（第三課題）：${users.length}件（${users.map((u) => `${u.email}・${u.customClaims.siRole}`).join('、') || 'なし'}）`);
if (!users.some((u) => u.customClaims.siRole === 'admin'))
  console.log('　※ 管理者のアカウントがありません。消したあと、grant-si-admin.mjs で管理者を決めてください');

if (!shouldWrite) {
  console.log('\n確認だけです（何も消していません）。消すときは --yes を付けて実行してください。元に戻せません。');
  process.exit(0);
}

console.log('\n消しています…');
for (const c of toDelete) {
  await db.recursiveDelete(c); // サブコレクション（従業員の履歴・月次確定の事業所ごとの結果など）もまとめて消す
  console.log(`　${c.id} を消しました`);
}
for (const [name, docs] of Object.entries(partial)) {
  for (const d of docs) await db.recursiveDelete(d.ref);
  console.log(`　${name} の組合健保の分（${docs.length}件）を消しました`);
}
console.log('\n初期状態に戻しました。アプリで管理者としてログインし、設定（事業所・支払区分など）から登録し直してください。');
process.exit(0);
