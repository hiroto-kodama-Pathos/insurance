// 本番の Firestore（kensyu10170）に、加入対象の判定の基準（eligibilityRules）を入れる（運営者が使う）
//
// 使い方：load-grades.mjs と同じ（鍵の場所を GOOGLE_APPLICATION_CREDENTIALS に指定する）
//   確認だけ（書き込まない）：node scripts/load-eligibility.mjs
//   書き込む                ：node scripts/load-eligibility.mjs --yes
import { eligibilityRuleDocs } from './data/eligibility-rules.mjs';
import { checkEnvironment, openSi, PROJECT_ID, putAll, shouldWrite } from './lib/admin.mjs';

checkEnvironment();
const docs = eligibilityRuleDocs();
console.log(`投入先：${PROJECT_ID} の apps/socialInsurance/eligibilityRules`);
for (const d of docs)
  console.log(`　${d.data.validFrom}から：企業規模 ${d.data.companySize === null ? '要件なし' : `${d.data.companySize}人以上`}・週${d.data.weeklyHours}時間・4分の3（${d.data.fullTimeRatio}）`);

if (!shouldWrite) {
  console.log('\n確認だけ行いました（書き込んでいません）。書き込むときは --yes を付けて実行してください。');
  process.exit(0);
}

const { db, col } = openSi();
await putAll(db, col('eligibilityRules'), docs);
const snap = await col('eligibilityRules').get();
console.log(`\n書き込みました。eligibilityRules：${snap.size}件（${docs.length}件なら正常）`);
