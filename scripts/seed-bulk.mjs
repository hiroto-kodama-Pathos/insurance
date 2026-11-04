// エミュレータに、300人の会社を想定した従業員を追加する（本番には入らない）
// 画面の速さ・表の見やすさ・検索や絞り込みを、人数が多い状態で確かめるためのデータ。
//
// 使い方（エミュレータを起動し、先に seed-emulator.mjs を入れてから）：
//   node scripts/seed-bulk.mjs              … 300人を追加する
//   node scripts/seed-bulk.mjs --count 100  … 人数を変える
//   node scripts/seed-bulk.mjs --dry-run    … 書き込まずに、作る内容の内訳だけを表示する
//
// seed-emulator.mjs と違い、Firestore を空にしない（e001〜e013 などの確認用の人はそのまま残る）。
// 何度実行しても同じ人が同じ内容で上書きされる（乱数の種を固定しているため）。
// 追加した人だけを消したいときは、seed-emulator.mjs を入れ直す（最初に Firestore を空にする）。
import { buildBulkPeople, printSummary } from './data/bulk-employees.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const countArg = args.indexOf('--count');
const COUNT = countArg >= 0 ? Number(args[countArg + 1]) : 300;
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 2000) {
  console.error('--count は 1〜2000 の整数で指定してください');
  process.exit(1);
}

const people = buildBulkPeople({
  count: COUNT,
  offices: [['honsha', 50], ['osaka', 35], ['nagoya', 15]], // 本社・大阪支店・名古屋営業所（組合健保）
  partGroupId: 'part',
  bonusTypeId: 'winter',
  idPrefix: 'b',
  numberPrefix: '',
  mark: false,
});
const allDocs = people.flatMap((p) => p.docs);
const OFFICE_LABEL = { honsha: '本社', osaka: '大阪支店', nagoya: '名古屋営業所' };
printSummary(people, (id) => OFFICE_LABEL[id] ?? id);

if (DRY_RUN) {
  console.log('（--dry-run のため書き込みません）');
  process.exit(0);
}

// ---- エミュレータに書き込む ----
const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, writeBatch } = await import('firebase/firestore');
const env = await initializeTestEnvironment({
  projectId: 'kensyu10170',
  firestore: { host: '127.0.0.1', port: 8080 },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // 1回の書き込みは500件までなので、400件ずつまとめて書く（1件ずつより速い）
  for (let i = 0; i < allDocs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of allDocs.slice(i, i + 400)) batch.set(doc(db, 'apps', 'socialInsurance', ...d.path), d.data);
    await batch.commit();
    process.stdout.write(`\r　書き込み中… ${Math.min(i + 400, allDocs.length)} / ${allDocs.length}`);
  }
});
await env.cleanup();
console.log(`\nエミュレータに ${COUNT}人を追加しました`);
