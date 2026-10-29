// tests/rules.test.mjs
// 使い方：エミュレータを起動したまま、別のターミナルで node tests/rules.test.mjs
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});
await testEnv.clearFirestore();

const SI = 'apps/socialInsurance';
// テスト用の初期データ（ルールを通さずに入れる）
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `${SI}/insurers/kyokai`), { type: 'kyokai', name: '全国健康保険協会' });
  await setDoc(doc(db, `${SI}/insurers/k1`), { type: 'kumiai', name: '〇〇健康保険組合' });
  await setDoc(doc(db, `${SI}/insurerRates/kyokai-tokyo`), { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 });
  await setDoc(doc(db, `${SI}/insurerRates/k1-health`), { insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9000, employeeShare: 500 });
  await setDoc(doc(db, `${SI}/companySettings/main`), { retentionYears: 2, childSupportRounding: 'combined' });
});

const admin  = testEnv.authenticatedContext('a1', { siRole: 'admin' }).firestore();
const staff  = testEnv.authenticatedContext('u1', { siRole: 'staff' }).firestore();
const noRole = testEnv.authenticatedContext('u2', {}).firestore();
const guest  = testEnv.unauthenticatedContext().firestore();

let failed = 0;
async function check(label, promise) {
  try {
    await promise;
    console.log(`OK  ${label}`);
  } catch (e) {
    failed++;
    console.log(`NG  ${label}\n    ${e.message}`);
  }
}

// ---- 従業員（これまでと同じ） ----
const emp = `${SI}/employees/e1`;
await check('担当者は従業員を書ける', assertSucceeds(setDoc(doc(staff, emp), { name: 'テスト' })));
await check('担当者は従業員を読める', assertSucceeds(getDoc(doc(staff, emp))));
await check('siRoleなしは読めない', assertFails(getDoc(doc(noRole, emp))));
await check('未ログインは読めない', assertFails(getDoc(doc(guest, emp))));
await check('親のドキュメント自体は閉じている', assertFails(getDoc(doc(staff, SI))));
await check('第二課題のデータは読めない', assertFails(getDoc(doc(staff, 'organizations/x'))));

// ---- システム共通マスタ ----
await check('担当者は厚生年金の料率を読める', assertSucceeds(getDoc(doc(staff, `${SI}/pensionRates/2017-09`))));
await check('管理者でも厚生年金の料率は書けない', assertFails(setDoc(doc(admin, `${SI}/pensionRates/2017-09`), { rate: 1 })));
await check('管理者でも等級表は書けない', assertFails(setDoc(doc(admin, `${SI}/grades/g1`), { standardAmount: 1 })));
await check('管理者でも協会けんぽの料率は変えられない', assertFails(updateDoc(doc(admin, `${SI}/insurerRates/kyokai-tokyo`), { rate: 1 })));
await check('管理者でも協会けんぽの料率を足せない', assertFails(setDoc(doc(admin, `${SI}/insurerRates/x`), { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2027-03', rate: 1, employeeShare: 500 })));
await check('管理者でも協会けんぽ（保険者）は変えられない', assertFails(updateDoc(doc(admin, `${SI}/insurers/kyokai`), { name: 'x' })));

// ---- 会社ごとのマスタ ----
await check('管理者は組合健保を足せる', assertSucceeds(setDoc(doc(admin, `${SI}/insurers/k2`), { type: 'kumiai', name: '△△健康保険組合', specialInsuredEnabled: false })));
await check('協会けんぽとしては足せない', assertFails(setDoc(doc(admin, `${SI}/insurers/k3`), { type: 'kyokai', name: 'x' })));
await check('担当者は組合健保を足せない', assertFails(setDoc(doc(staff, `${SI}/insurers/k4`), { type: 'kumiai', name: 'x' })));
await check('管理者は組合健保の料率を足せる', assertSucceeds(setDoc(doc(admin, `${SI}/insurerRates/k1-care`), { insurerId: 'k1', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1800, employeeShare: 500 })));
await check('管理者は組合健保の料率を直せる', assertSucceeds(updateDoc(doc(admin, `${SI}/insurerRates/k1-health`), { rate: 9500 })));
await check('料率の保険者を協会けんぽに付け替えられない', assertFails(updateDoc(doc(admin, `${SI}/insurerRates/k1-health`), { insurerId: 'kyokai' })));
await check('担当者は料率を書けない', assertFails(updateDoc(doc(staff, `${SI}/insurerRates/k1-health`), { rate: 1 })));
await check('管理者は事業所を足せる', assertSucceeds(setDoc(doc(admin, `${SI}/offices/nagoya`), { name: '名古屋', prefecture: '愛知県', insurerId: 'kyokai', isDefault: false })));
await check('ない保険者の事業所は足せない', assertFails(setDoc(doc(admin, `${SI}/offices/x`), { name: 'x', prefecture: '', insurerId: 'none', isDefault: false })));
await check('担当者は事業所を足せない', assertFails(setDoc(doc(staff, `${SI}/offices/y`), { name: 'y', prefecture: '', insurerId: 'kyokai', isDefault: false })));
await check('管理者でも事業所は消せない', assertFails(deleteDoc(doc(admin, `${SI}/offices/nagoya`))));

// ---- 会社の設定 ----
const settings = `${SI}/companySettings/main`;
await check('担当者は会社の設定を読める', assertSucceeds(getDoc(doc(staff, settings))));
await check('管理者は端数処理を変えられる', assertSucceeds(setDoc(doc(admin, settings), { childSupportRounding: 'separate' }, { merge: true })));
await check('管理者でも保管期間は変えられない', assertFails(setDoc(doc(admin, settings), { retentionYears: 10 }, { merge: true })));
await check('担当者は会社の設定を変えられない', assertFails(setDoc(doc(staff, settings), { childSupportRounding: 'combined' }, { merge: true })));


// ---- 月次確定 ----
const osakaStaff = testEnv.authenticatedContext('u3', { siRole: 'staff', siScope: 'osaka' }).firestore();
const allStaff = testEnv.authenticatedContext('u4', { siRole: 'staff', siScope: 'all' }).firestore();
const closing = (uid, officeId) => ({ yearMonth: '2026-10', officeId, closedBy: uid, rows: [], totals: {} });
const closedDoc = (o) => `${SI}/closings/2026-10/offices/${o}`;
await check('全担当は本社を確定できる', assertSucceeds(setDoc(doc(allStaff, closedDoc('honsha')), closing('u4', 'honsha'))));
await check('確定した結果は書き換えられない', assertFails(updateDoc(doc(allStaff, closedDoc('honsha')), { rows: [1] })));
await check('大阪の担当者は本社を確定できない', assertFails(setDoc(doc(osakaStaff, closedDoc('honsha2')), closing('u3', 'honsha2'))));
await check('大阪の担当者は大阪を確定できる', assertSucceeds(setDoc(doc(osakaStaff, closedDoc('osaka')), closing('u3', 'osaka'))));
await check('ほかの人の名前では確定できない', assertFails(setDoc(doc(allStaff, closedDoc('nagoya')), closing('u1', 'nagoya'))));
await check('パスと違う事業所IDでは確定できない', assertFails(setDoc(doc(allStaff, closedDoc('nagoya')), closing('u4', 'osaka'))));
await check('大阪の担当者は本社の確定を解除できない', assertFails(deleteDoc(doc(osakaStaff, closedDoc('honsha')))));
await check('全担当は本社の確定を解除できる', assertSucceeds(deleteDoc(doc(allStaff, closedDoc('honsha')))));
const parent = `${SI}/closings/2026-10`;
await check('大阪の担当者は親に大阪の確定日時を書ける', assertSucceeds(setDoc(doc(osakaStaff, parent), { offices: { osaka: 1 } }, { merge: true })));
await check('大阪の担当者は親に本社の確定日時を書けない', assertFails(setDoc(doc(osakaStaff, parent), { offices: { honsha: 1 } }, { merge: true })));
await check('親にほかの項目は書けない', assertFails(setDoc(doc(allStaff, parent), { memo: 'x' }, { merge: true })));


// ---- 賞与（確定済みの月は登録・削除できない） ----
const bonus = (ym, day, office) => ({ employeeId: 'e1', paidDate: `${ym}-${day}`, amount: 500000, yearMonth: ym, officeId: office });
await check('未確定の月の賞与は登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/bonuses/b1`), bonus('2026-11', '10', 'honsha'))));
await check('支給日と支給月が合わない賞与は登録できない', assertFails(setDoc(doc(staff, `${SI}/bonuses/b2`), { ...bonus('2026-11', '10', 'honsha'), paidDate: '2026-12-10' })));
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `${SI}/closings/2026-11/offices/honsha`), { yearMonth: '2026-11', officeId: 'honsha' });
});
await check('確定済みの月の賞与は登録できない', assertFails(setDoc(doc(staff, `${SI}/bonuses/b3`), bonus('2026-11', '20', 'honsha'))));
await check('確定済みの月の賞与は削除できない', assertFails(deleteDoc(doc(staff, `${SI}/bonuses/b1`))));
await check('同じ月でも未確定の事業所なら登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/bonuses/b4`), bonus('2026-11', '20', 'osaka'))));
await check('賞与の書き換えはできない', assertFails(updateDoc(doc(staff, `${SI}/bonuses/b4`), { amount: 1 })));
await check('未確定の事業所の賞与は削除できる', assertSucceeds(deleteDoc(doc(staff, `${SI}/bonuses/b4`))));
await check('確定済みの月の賞与でも、全事業所の合計は登録できる', assertSucceeds(updateDoc(doc(staff, `${SI}/bonuses/b1`), { totalAmount: 800000 })));
await check('全事業所の合計は、自社の賞与額より大きくないと登録できない', assertFails(updateDoc(doc(staff, `${SI}/bonuses/b1`), { totalAmount: 400000 })));
await check('全事業所の合計と一緒に賞与額は変えられない', assertFails(updateDoc(doc(staff, `${SI}/bonuses/b1`), { totalAmount: 900000, amount: 1 })));

// ---- 給与（確定済みの月は登録・上書き・削除できない。2026-11 の本社は上で確定済み） ----
const salary = (paidDate, office, fixed = 300000) => ({
  employeeId: 'e1', paidDate, yearMonth: paidDate.slice(0, 7), officeId: office,
  fixedWages: fixed, nonFixedWages: 0, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
});
await check('未確定の月の給与は登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/salaries/e1_2026-10-25`), salary('2026-10-25', 'honsha'))));
await check('未確定の月の給与は上書きできる', assertSucceeds(setDoc(doc(staff, `${SI}/salaries/e1_2026-10-25`), salary('2026-10-25', 'honsha', 340000))));
await check('ドキュメントIDが 従業員ID_支払日 でない給与は登録できない', assertFails(setDoc(doc(staff, `${SI}/salaries/x1`), salary('2026-10-25', 'honsha'))));
await check('支払日と支払月が合わない給与は登録できない', assertFails(setDoc(doc(staff, `${SI}/salaries/e1_2026-10-20`), { ...salary('2026-10-20', 'honsha'), yearMonth: '2026-09' })));
await check('支払基礎日数が32日の給与は登録できない', assertFails(setDoc(doc(staff, `${SI}/salaries/e1_2026-10-26`), { ...salary('2026-10-26', 'honsha'), paymentBaseDays: 32 })));
await check('確定済みの月の給与は登録できない', assertFails(setDoc(doc(staff, `${SI}/salaries/e1_2026-11-25`), salary('2026-11-25', 'honsha'))));
await check('同じ月でも未確定の事業所なら給与を登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/salaries/e1_2026-11-20`), salary('2026-11-20', 'osaka'))));
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `${SI}/salaries/e1_2026-11-24`), salary('2026-11-24', 'honsha'));
});
await check('確定済みの月の給与は上書きできない', assertFails(setDoc(doc(staff, `${SI}/salaries/e1_2026-11-24`), salary('2026-11-24', 'honsha', 1))));
await check('確定済みの月の給与は削除できない', assertFails(deleteDoc(doc(staff, `${SI}/salaries/e1_2026-11-24`))));
await check('未確定の月の給与は削除できる', assertSucceeds(deleteDoc(doc(staff, `${SI}/salaries/e1_2026-10-25`))));

await testEnv.cleanup();
console.log(failed === 0 ? 'すべて期待どおりです' : `${failed}件が期待と違います`);
process.exit(failed === 0 ? 0 : 1);
