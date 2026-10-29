// 本番の Firestore（kensyu10170）に、協会けんぽの保険者・料率と厚生年金の料率を入れる（運営者が使う）
// 使い方は load-grades.mjs と同じ（鍵の場所を指定して、まず確認だけ → --yes で書き込む）
//   node scripts/load-rates.mjs
//   node scripts/load-rates.mjs --yes
import { KYOKAI_INSURER, kyokaiRateDocs, pensionRateDocs } from './data/kyokai-rates.mjs';
import { checkEnvironment, openSi, PROJECT_ID, putAll, shouldWrite } from './lib/admin.mjs';

checkEnvironment();
const rates = kyokaiRateDocs();
const pension = pensionRateDocs();
const pct = (r) => `${(r / 1000).toFixed(2)}%`;
const health = rates.filter((r) => r.data.rateType === 'health');
const pick = (pref) => health.find((r) => r.data.prefecture === pref).data.rate;

console.log(`投入先：${PROJECT_ID} の apps/socialInsurance（insurers・insurerRates・pensionRates）`);
console.log(`保険者：${KYOKAI_INSURER.data.name}（ID：${KYOKAI_INSURER.id}）`);
console.log(`健康保険料率：${health.length}都道府県（2026-03から）例：東京都 ${pct(pick('東京都'))}、大阪府 ${pct(pick('大阪府'))}、北海道 ${pct(pick('北海道'))}`);
for (const r of rates.filter((r) => r.data.rateType !== 'health')) {
  console.log(`${r.data.rateType === 'care' ? '介護保険料率' : '子ども・子育て支援金率'}：${pct(r.data.rate)}（${r.data.validFrom}から、全国一律）`);
}
console.log(`厚生年金保険料率：${pct(pension[0].data.rate)}（${pension[0].data.validFrom}から）　負担割合はすべて折半`);

if (!shouldWrite) {
  console.log('\n確認だけ行いました（書き込んでいません）。書き込むときは --yes を付けて実行してください。');
  process.exit(0);
}

const { db, col } = openSi();
await putAll(db, col('insurers'), [KYOKAI_INSURER]);
await putAll(db, col('insurerRates'), rates);
await putAll(db, col('pensionRates'), pension);

const n = (await col('insurerRates').where('insurerId', '==', 'kyokai').get()).size;
console.log(`\n書き込みました。協会けんぽの料率：${n}件（${rates.length}件なら正常）`);
