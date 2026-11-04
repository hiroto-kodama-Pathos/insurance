// 本番の Firestore（kensyu10170）に、300人の会社を想定したテスト用の従業員を一時的に入れ、確認が終わったら消す
// 人数が多いときの画面の速さ・読み取りの回数を、本番で一度確かめるためのもの。確認が終わったら必ず --remove で消す。
//
// 使い方（鍵の場所の指定は load-grades.mjs の先頭と同じ）：
//   1. 確認だけ（書き込まない）：node scripts/bulk-production.mjs
//        本番の事業所・支払区分・等級表・料率・ログインできるアカウントがそろっているかと、入れる内容を表示する
//   2. 入れる                  ：node scripts/bulk-production.mjs --yes
//   3. 消す（確認だけ）        ：node scripts/bulk-production.mjs --remove
//      消す                    ：node scripts/bulk-production.mjs --remove --yes
//
// 入れた従業員には bulkTest: true の印と、ID「bulktest-001」〜・社員番号「T0001」〜を付ける。
// 消すときは、この印が付いた従業員と、その人の給与・賞与などだけを消す（ほかの従業員には触れない）。
// 確認中に「確定」を押した月があると、確定の記録にテスト用の従業員が残るため、消す前に確定を解除する（スクリプトが知らせる）。
import { getAuth } from 'firebase-admin/auth';
import { buildBulkPeople, printSummary } from './data/bulk-employees.mjs';
import { checkEnvironment, openSi, PROJECT_ID, shouldWrite } from './lib/admin.mjs';

const REMOVE = process.argv.includes('--remove');
const COUNT = 300;
const ID_PREFIX = 'bulktest-';

checkEnvironment();
const { db, col } = openSi();
console.log(`対象：${PROJECT_ID}（本番）の apps/socialInsurance\n`);

/** 社員に紐づく記録（employeeId を持つコレクション） */
const LINKED = ['salaries', 'bonuses', 'filings', 'revisionCandidates', 'adjustments', 'payrollDeductions'];

if (REMOVE) {
  await remove();
} else {
  await add();
}
process.exit(0);

// ---------------------------------------------------------------------------

async function add() {
  // 本番に、画面で確かめるのに必要なものがそろっているか
  const [offices, groups, bonusTypes, grades, rates, pension, employees, users] = await Promise.all([
    col('offices').get(),
    col('payrollGroups').get(),
    col('bonusTypes').get(),
    col('grades').count().get(),
    col('insurerRates').count().get(),
    col('pensionRates').count().get(),
    col('employees').get(),
    getAuth().listUsers(1000),
  ]);
  const siUsers = users.users.filter((u) => u.customClaims?.siRole);
  const testCount = employees.docs.filter((d) => d.get('bulkTest') === true).length;
  console.log('本番の状態');
  console.log(`　事業所：${offices.size}件（${offices.docs.map((d) => d.get('name')).join('・') || 'なし'}）`);
  console.log(`　支払区分：${groups.size}件　賞与の種類：${bonusTypes.size}件`);
  console.log(`　等級表：${grades.data().count}件　料率：${rates.data().count}件　厚生年金の料率：${pension.data().count}件`);
  console.log(`　従業員：${employees.size}人（うちテスト用 ${testCount}人）`);
  console.log(`　第三課題にログインできるアカウント：${siUsers.length}件（${siUsers.map((u) => `${u.email}・${u.customClaims.siRole}`).join('、') || 'なし'}）`);

  const problems = [];
  if (offices.size === 0) problems.push('事業所がありません（設定の画面で登録してください）');
  if (grades.data().count === 0) problems.push('等級表がありません（node scripts/load-grades.mjs --yes）');
  if (rates.data().count === 0 || pension.data().count === 0) problems.push('料率がありません（node scripts/load-rates.mjs --yes）');
  if (siUsers.length === 0) problems.push('第三課題にログインできるアカウントがありません');
  const numbers = new Set(employees.docs.filter((d) => d.get('bulkTest') !== true).map((d) => d.get('employeeNumber')));
  if ([...numbers].some((n) => /^T\d{4}$/.test(n ?? ''))) problems.push('社員番号「T0001」の形の従業員がすでにいます（テスト用の社員番号と重なる）');
  if (problems.length > 0) {
    console.log('\n入れられません：');
    for (const p of problems) console.log(`　・${p}`);
    return;
  }

  // 振り分け：登録済みの事業所に、上から 50・35・15… の重みで分ける
  const weights = [50, 35, 15, 10, 10, 10];
  const officeList = offices.docs.map((d, i) => [d.id, weights[i] ?? 5]);
  const officeName = (id) => offices.docs.find((d) => d.id === id)?.get('name') ?? id;
  const part = groups.docs.find((d) => d.get('isDefault') !== true) ?? null;
  const winter = bonusTypes.docs.find((d) => String(d.get('name')).includes('冬') && d.get('isRemuneration') !== true) ?? null;
  const people = buildBulkPeople({
    count: COUNT,
    offices: officeList,
    partGroupId: part?.id ?? null,
    bonusTypeId: winter?.id ?? null,
    idPrefix: ID_PREFIX,
    numberPrefix: 'T',
    mark: true,
  });
  console.log('\n入れる内容');
  printSummary(people, officeName);
  console.log(`　パートの支払区分：${part ? part.get('name') : 'なし（全員を既定の区分にする）'}　冬の賞与の種類：${winter ? winter.get('name') : 'なし（種類なしで登録）'}`);
  console.log('\n読み取りの目安：一覧を最初に読むたびに、約6,000回（1日の無料枠は5万回）。確かめるのは数回にしてください。');

  if (!shouldWrite) {
    console.log('\n確認だけ行いました（書き込んでいません）。入れるときは --yes を付けて実行してください。');
    return;
  }
  const docs = people.flatMap((p) => p.docs);
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) batch.set(db.doc(['apps', 'socialInsurance', ...d.path].join('/')), d.data);
    await batch.commit();
    process.stdout.write(`\r　書き込み中… ${Math.min(i + 400, docs.length)} / ${docs.length}`);
  }
  console.log(`\n本番に ${COUNT}人を入れました。確かめ終わったら、必ず  node scripts/bulk-production.mjs --remove --yes  で消してください。`);
}

async function remove() {
  const tests = await col('employees').where('bulkTest', '==', true).get();
  // 念のため、IDの形も確かめる（印だけで消さない）
  const targets = tests.docs.filter((d) => d.id.startsWith(ID_PREFIX));
  const ids = new Set(targets.map((d) => d.id));
  console.log(`消す従業員：${targets.length}人（bulkTest の印があり、IDが ${ID_PREFIX} で始まる人）`);
  if (targets.length === 0) return;

  // 確定の記録にテスト用の従業員が入っていないか
  const closed = [];
  for (const month of (await col('closings').get()).docs) {
    for (const office of (await month.ref.collection('offices').get()).docs) {
      const rows = [...(office.get('rows') ?? []), ...(office.get('bonusRows') ?? [])];
      if (rows.some((r) => ids.has(r.employeeId))) closed.push(`${month.id}・${office.id}`);
    }
  }
  if (closed.length > 0) {
    console.log('\n次の月は、テスト用の従業員を含めて確定されています。月次保険料一覧で「確定を解除」してから、やり直してください：');
    for (const c of closed) console.log(`　・${c}`);
    return;
  }

  // 紐づく記録（給与・賞与・届出済み・改定の候補の状態・差額の精算・控除額）
  const linked = [];
  const idList = [...ids];
  for (const name of LINKED) {
    for (let i = 0; i < idList.length; i += 30) {
      const snap = await col(name).where('employeeId', 'in', idList.slice(i, i + 30)).get();
      linked.push(...snap.docs.map((d) => d.ref));
    }
  }
  console.log(`紐づく記録：${linked.length}件（${LINKED.join('・')}）`);

  if (!shouldWrite) {
    console.log('\n確認だけ行いました（消していません）。消すときは --remove --yes を付けて実行してください。');
    return;
  }
  for (let i = 0; i < linked.length; i += 400) {
    const batch = db.batch();
    for (const ref of linked.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  let n = 0;
  for (const d of targets) {
    await db.recursiveDelete(d.ref); // 従業員と、その下の履歴（資格・標準報酬月額など）をまとめて消す
    process.stdout.write(`\r　消しています… ${++n} / ${targets.length}`);
  }
  console.log(`\nテスト用の従業員 ${targets.length}人と、紐づく記録 ${linked.length}件を消しました。`);
}
