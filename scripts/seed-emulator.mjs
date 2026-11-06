// エミュレータに、画面の確認用のデータを入れる（本番には入らない）
// 使い方：エミュレータを起動したまま、別のターミナルで node scripts/seed-emulator.mjs
// 
// このバージョンは完全な初期状態：マスタデータと管理者アカウントのみ
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { kyokaiGradeDocs, kyokaiThresholdDocs } from './data/kyokai-grades.mjs';
import { KYOKAI_INSURER, kyokaiRateDocs, pensionRateDocs } from './data/kyokai-rates.mjs';
import { eligibilityRuleDocs } from './data/eligibility-rules.mjs';

const env = await initializeTestEnvironment({
  projectId: 'kensyu10170', // アプリと同じプロジェクトID（エミュレータの中だけ）
  firestore: { host: '127.0.0.1', port: 8080 },
});

// 前に画面で登録したデータが残らないように、Firestore を空にしてから入れる
// （エミュレータの中だけ。ログインのアカウントは消えない）
await env.clearFirestore();

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const si = (...path) => doc(db, 'apps', 'socialInsurance', ...path);

  // 保険者・料率（本番への投入と同じデータ。47都道府県の料率が入る）
  await setDoc(si('insurers', KYOKAI_INSURER.id), KYOKAI_INSURER.data);
  for (const r of kyokaiRateDocs()) await setDoc(si('insurerRates', r.id), r.data);
  for (const r of pensionRateDocs()) await setDoc(si('pensionRates', r.id), r.data);

  // 加入対象の判定の基準
  for (const r of eligibilityRuleDocs()) await setDoc(si('eligibilityRules', r.id), r.data);

  // 協会けんぽの保険料額表の等級（本番への投入と同じデータ）
  for (const g of kyokaiGradeDocs()) {
    await setDoc(si('grades', g.id), g.data);
  }
  for (const t of kyokaiThresholdDocs()) {
    await setDoc(si('gradeThresholds', t.id), t.data);
  }


})
await env.cleanup();

// 開発アカウント（ログイン画面で dev@example.com ／ dev-password でログインする）に siRole: 'admin' を付ける
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DEV = { email: 'dev@example.com', password: 'dev-password' };
async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function devAccount(cred, claims) {
  let account = await post(`${AUTH}/accounts:signUp?key=fake-api-key`, { ...cred, returnSecureToken: true });
  if (account.error) {
    // すでにある場合はログインして uid を取る
    account = await post(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, { ...cred, returnSecureToken: true });
  }
  await post(
    `${AUTH}/projects/kensyu10170/accounts:update`,
    { localId: account.localId, customAttributes: JSON.stringify(claims) },
    { Authorization: 'Bearer owner' },
  );
}
await devAccount(DEV, { siRole: 'admin', siScope: 'all' });

console.log('エミュレータを初期化しました（管理者アカウント dev@example.com のみ）');
