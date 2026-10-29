// 本番の Firestore（kensyu10170）に、協会けんぽの保険料額表の等級を入れる（運営者が使う）
//
// 使い方：
//   1. Firebase コンソール → プロジェクトの設定 → サービスアカウント → 「新しい秘密鍵を生成」で鍵（JSON）を取り、
//      secrets フォルダに置く（Git に入らない。鍵は人に渡さない）
//   2. PowerShell で鍵の場所を指定する
//        $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\pluser1\social-insurance\secrets\鍵のファイル名.json"
//   3. 確認だけ（書き込まない）：node scripts/load-grades.mjs
//      書き込む                ：node scripts/load-grades.mjs --yes
//
// セキュリティルールでは grades への書き込みを誰にも許可していないが、Admin SDK はルールを通らないので書き込める。
import { GRADES_VALID_FROM, kyokaiGradeDocs, kyokaiThresholdDocs } from './data/kyokai-grades.mjs';
import { checkEnvironment, openSi, PROJECT_ID, putAll, shouldWrite } from './lib/admin.mjs';

checkEnvironment();
const docs = kyokaiGradeDocs();
const thresholds = kyokaiThresholdDocs();
console.log(`投入先：${PROJECT_ID} の apps/socialInsurance/grades`);
console.log(`内容　：協会けんぽの保険料額表（${GRADES_VALID_FROM}から）${docs.length}等級`);
console.log(`　　　　1等級 ${docs[0].data.standardAmount.toLocaleString()}円 〜 ${docs.length}等級 ${docs.at(-1).data.standardAmount.toLocaleString()}円`);
console.log(`　　　　あわせて gradeThresholds に、最高・最低等級付近の特例の閾値 ${thresholds.length}件（健康保険・厚生年金）`);

if (!shouldWrite) {
  console.log('\n確認だけ行いました（書き込んでいません）。書き込むときは --yes を付けて実行してください。');
  process.exit(0);
}

const { db, col } = openSi();
await putAll(db, col('grades'), docs);
await putAll(db, col('gradeThresholds'), thresholds);
const snap = await col('grades').where('validFrom', '==', GRADES_VALID_FROM).get();
console.log(`\n書き込みました。${GRADES_VALID_FROM}からの等級：${snap.size}件（${docs.length}件なら正常）`);
const t = await col('gradeThresholds').where('validFrom', '==', GRADES_VALID_FROM).get();
console.log(`特例の閾値：${t.size}件（${thresholds.length}件なら正常）`);
