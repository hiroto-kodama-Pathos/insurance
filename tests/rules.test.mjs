// tests/rules.test.mjs
// 使い方：エミュレータを起動したまま、別のターミナルで node tests/rules.test.mjs
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where, writeBatch } from 'firebase/firestore';

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

// 管理者の担当範囲は常に全担当（アカウントの発行の関数が siScope: 'all' を付ける）
const admin  = testEnv.authenticatedContext('a1', { siRole: 'admin', siScope: 'all' }).firestore();
const staff  = testEnv.authenticatedContext('u1', { siRole: 'staff', siScope: 'all' }).firestore();
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
await check('担当者は従業員を書ける', assertSucceeds(setDoc(doc(staff, emp), { name: 'テスト', officeIds: ['honsha'] })));
await check('担当者は従業員を読める', assertSucceeds(getDoc(doc(staff, emp))));
await check('siRoleなしは読めない', assertFails(getDoc(doc(noRole, emp))));
await check('未ログインは読めない', assertFails(getDoc(doc(guest, emp))));
await check('親のドキュメント自体は閉じている', assertFails(getDoc(doc(staff, SI))));
await check('第二課題のデータは読めない', assertFails(getDoc(doc(staff, 'organizations/x'))));

// ---- システム共通マスタ ----
await check('担当者は厚生年金の料率を読める', assertSucceeds(getDoc(doc(staff, `${SI}/pensionRates/2017-09`))));
await check('管理者でも厚生年金の料率は書けない', assertFails(setDoc(doc(admin, `${SI}/pensionRates/2017-09`), { rate: 1 })));
await check('管理者でも加入対象の判定の基準は書けない', assertFails(setDoc(doc(admin, `${SI}/eligibilityRules/2027-10-01`), { companySize: 1 })));
await check('担当者は加入対象の判定の基準を読める', assertSucceeds(getDoc(doc(staff, `${SI}/eligibilityRules/2027-10-01`))));
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
await check('うち現物つきの賞与は登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/bonuses/b5`), { ...bonus('2026-11', '05', 'honsha'), inKindAmount: 50000 })));
await check('うち現物が賞与額より大きい賞与は登録できない', assertFails(setDoc(doc(staff, `${SI}/bonuses/b6`), { ...bonus('2026-11', '05', 'honsha'), inKindAmount: 600000 })));
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

// ---- 給与の支払区分（管理者だけが追加・変更。削除はできない） ----
const group = { name: '月給者', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: true };
await check('管理者は支払区分を追加できる', assertSucceeds(setDoc(doc(admin, `${SI}/payrollGroups/g1`), group)));
await check('担当者は支払区分を追加できない', assertFails(setDoc(doc(staff, `${SI}/payrollGroups/g2`), group)));
await check('担当者は支払区分を読める', assertSucceeds(getDoc(doc(staff, `${SI}/payrollGroups/g1`))));
await check('締め日が31日の支払区分は登録できない', assertFails(setDoc(doc(admin, `${SI}/payrollGroups/g3`), { ...group, cutoffDay: 31 })));
await check('控除のタイミングが不正な支払区分は登録できない', assertFails(setDoc(doc(admin, `${SI}/payrollGroups/g3`), { ...group, deductionTiming: 'x' })));
await check('管理者でも支払区分は削除できない', assertFails(deleteDoc(doc(admin, `${SI}/payrollGroups/g1`))));
await check('担当者は従業員の支払区分の履歴を登録できる', assertSucceeds(setDoc(doc(staff, `${SI}/employees/e1/payrollAssignments/p1`), { validFrom: '2026-10-01', payrollGroupId: 'g1' })));

// ---- 届出済みの記録 ----
await check('担当者は届出済みにできる', assertSucceeds(setDoc(doc(staff, `${SI}/filings/e1_acquisition_2026-10-01`), { employeeId: 'e1', kind: 'acquisition', trigger: '2026-10-01', officeId: 'honsha', filedBy: 'u1' })));
await check('担当者は未対応に戻せる', assertSucceeds(deleteDoc(doc(staff, `${SI}/filings/e1_acquisition_2026-10-01`))));
await check('ログインしていない人は届出済みにできない', assertFails(setDoc(doc(guest, `${SI}/filings/x`), { kind: 'loss' })));

// ---- 賞与の種類 ----
await check('管理者は賞与の種類を追加できる', assertSucceeds(setDoc(doc(admin, `${SI}/bonusTypes/t1`), { name: '四半期賞与', isRemuneration: true, validFrom: '2026-04' })));
await check('担当者は賞与の種類を追加できない', assertFails(setDoc(doc(staff, `${SI}/bonusTypes/t2`), { name: '決算賞与', isRemuneration: false, validFrom: '2026-04' })));
await check('管理者でも賞与の種類は削除できない', assertFails(deleteDoc(doc(admin, `${SI}/bonusTypes/t1`))));

// ---- 照合（納付書の金額・給与の控除額） ----
const lines = { healthCare: 65110, childSupport: 1518, pension: 120780 };
await check('担当者は納付書の金額を保存できる', assertSucceeds(setDoc(doc(allStaff, `${SI}/reconciliations/2026-10_honsha`), { yearMonth: '2026-10', officeId: 'honsha', lines })));
await check('ドキュメントIDが月_事業所でない納付書の金額は保存できない', assertFails(setDoc(doc(allStaff, `${SI}/reconciliations/x`), { yearMonth: '2026-10', officeId: 'honsha', lines })));
await check('マイナスの納付書の金額は保存できない', assertFails(setDoc(doc(allStaff, `${SI}/reconciliations/2026-10_honsha`), { yearMonth: '2026-10', officeId: 'honsha', lines: { ...lines, pension: -1 } })));
await check('納付書にない欄は保存できない', assertFails(setDoc(doc(allStaff, `${SI}/reconciliations/2026-10_honsha`), { yearMonth: '2026-10', officeId: 'honsha', lines: { ...lines, care: 1 } })));
await check('大阪の担当者は本社の納付書の金額を保存できない', assertFails(setDoc(doc(osakaStaff, `${SI}/reconciliations/2026-10_honsha`), { yearMonth: '2026-10', officeId: 'honsha', lines })));
await check('担当者は納付書の金額を消せる', assertSucceeds(deleteDoc(doc(allStaff, `${SI}/reconciliations/2026-10_honsha`))));
const ded = { employeeId: 'e1', officeId: 'honsha', yearMonth: '2026-10', health: 14775, childSupport: 345, pension: 27450 };
await check('担当者は給与の控除額を保存できる', assertSucceeds(setDoc(doc(staff, `${SI}/payrollDeductions/e1_2026-10`), ded)));
await check('ドキュメントIDが従業員_月でない控除額は保存できない', assertFails(setDoc(doc(staff, `${SI}/payrollDeductions/e1`), ded)));
await check('小数の控除額は保存できない', assertFails(setDoc(doc(staff, `${SI}/payrollDeductions/e1_2026-10`), { ...ded, health: 1.5 })));
await check('ログインしていない人は控除額を読めない', assertFails(getDoc(doc(guest, `${SI}/payrollDeductions/e1_2026-10`))));

// ---- 退職者データの消去の記録 ----
await check('担当者は消去の記録を書けない', assertFails(setDoc(doc(allStaff, `${SI}/purgeLogs/x`), { purgedCount: 0 })));
await check('管理者も消去の記録を書けない（Cloud Functions だけ）', assertFails(setDoc(doc(admin, `${SI}/purgeLogs/x`), { purgedCount: 0 })));
await check('担当者は消去の記録を読める', assertSucceeds(getDoc(doc(allStaff, `${SI}/purgeLogs/x`))));

// ---- 担当範囲での読み書きの制限（特定の適用事業所の担当者） ----
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `${SI}/employees/sH`), { name: '本社の人', officeIds: ['honsha'] });
  await setDoc(doc(db, `${SI}/employees/sO`), { name: '大阪の人', officeIds: ['osaka'] });
  // 大阪から本社に異動した人（これまでの所属に大阪を含む）
  await setDoc(doc(db, `${SI}/employees/sM`), { name: '異動した人', officeIds: ['osaka', 'honsha'] });
  await setDoc(doc(db, `${SI}/employees/sH/qualifications/q1`), { acquiredDate: '2020-04-01', lostDate: null });
  await setDoc(doc(db, `${SI}/employees/sO/qualifications/q1`), { acquiredDate: '2020-04-01', lostDate: null });
  await setDoc(doc(db, `${SI}/salaries/sH_2026-08-25`), { employeeId: 'sH', paidDate: '2026-08-25', yearMonth: '2026-08', officeId: 'honsha', fixedWages: 1, nonFixedWages: 0, paymentBaseDays: 30 });
  await setDoc(doc(db, `${SI}/salaries/sO_2026-08-25`), { employeeId: 'sO', paidDate: '2026-08-25', yearMonth: '2026-08', officeId: 'osaka', fixedWages: 1, nonFixedWages: 0, paymentBaseDays: 30 });
  await setDoc(doc(db, `${SI}/filings/sH_acquisition_2026-10-01`), { employeeId: 'sH', officeId: 'honsha', kind: 'acquisition' });
  await setDoc(doc(db, `${SI}/filings/sO_acquisition_2026-10-01`), { employeeId: 'sO', officeId: 'osaka', kind: 'acquisition' });
});
await check('大阪の担当者は大阪の従業員を読める', assertSucceeds(getDoc(doc(osakaStaff, `${SI}/employees/sO`))));
await check('大阪の担当者は、大阪から異動した人も読める', assertSucceeds(getDoc(doc(osakaStaff, `${SI}/employees/sM`))));
await check('大阪の担当者は本社の従業員を読めない', assertFails(getDoc(doc(osakaStaff, `${SI}/employees/sH`))));
await check('大阪の担当者は、大阪で絞り込んだ従業員の一覧を読める', assertSucceeds(getDocs(query(collection(osakaStaff, `${SI}/employees`), where('officeIds', 'array-contains', 'osaka')))));
await check('大阪の担当者は、絞り込まない従業員の一覧を読めない', assertFails(getDocs(collection(osakaStaff, `${SI}/employees`))));
await check('大阪の担当者は大阪の従業員の資格を読める', assertSucceeds(getDocs(collection(osakaStaff, `${SI}/employees/sO/qualifications`))));
await check('大阪の担当者は本社の従業員の資格を読めない', assertFails(getDocs(collection(osakaStaff, `${SI}/employees/sH/qualifications`))));
await check('全担当は本社の従業員を読める', assertSucceeds(getDoc(doc(allStaff, `${SI}/employees/sH`))));
await check('大阪の担当者は、大阪で絞り込んだ給与を読める', assertSucceeds(getDocs(query(collection(osakaStaff, `${SI}/salaries`), where('officeId', '==', 'osaka')))));
await check('大阪の担当者は、絞り込まない給与を読めない', assertFails(getDocs(collection(osakaStaff, `${SI}/salaries`))));
await check('大阪の担当者は本社の給与を登録できない', assertFails(setDoc(doc(osakaStaff, `${SI}/salaries/sH_2026-09-25`), { employeeId: 'sH', paidDate: '2026-09-25', yearMonth: '2026-09', officeId: 'honsha', fixedWages: 1, nonFixedWages: 0, paymentBaseDays: 30 })));
await check('大阪の担当者は大阪の届出済みを読める', assertSucceeds(getDoc(doc(osakaStaff, `${SI}/filings/sO_acquisition_2026-10-01`))));
await check('大阪の担当者は本社の届出済みを読めない', assertFails(getDoc(doc(osakaStaff, `${SI}/filings/sH_acquisition_2026-10-01`))));
{
  const b = writeBatch(osakaStaff);
  b.set(doc(osakaStaff, `${SI}/employees/sNew`), { name: '新しい人', officeIds: ['osaka'] });
  b.set(doc(osakaStaff, `${SI}/employees/sNew/assignments/a1`), { validFrom: '2026-11-01', officeId: 'osaka' });
  b.set(doc(osakaStaff, `${SI}/employees/sNew/qualifications/q1`), { acquiredDate: '2026-11-01', lostDate: null });
  await check('大阪の担当者は、大阪の所属で従業員を登録できる（同じ書き込みでサブコレクションも）', assertSucceeds(b.commit()));
}
await check('大阪の担当者は、本社の所属で従業員を登録できない', assertFails(setDoc(doc(osakaStaff, `${SI}/employees/sNew2`), { name: 'x', officeIds: ['honsha'] })));
await check('大阪の担当者は、所属事業所の一覧を変えられない（異動は全担当）', assertFails(updateDoc(doc(osakaStaff, `${SI}/employees/sO`), { officeIds: ['osaka', 'honsha'] })));
await check('大阪の担当者は、本社への所属の履歴を作れない', assertFails(setDoc(doc(osakaStaff, `${SI}/employees/sO/assignments/a2`), { validFrom: '2026-12-01', officeId: 'honsha' })));
await check('大阪の担当者も、大阪の従業員の名前は直せる', assertSucceeds(updateDoc(doc(osakaStaff, `${SI}/employees/sO`), { name: '大阪の人（直した）' })));
await check('担当者は従業員を削除できない（Cloud Functions だけ）', assertFails(deleteDoc(doc(allStaff, `${SI}/employees/sH`))));
await check('全担当は異動できる（所属事業所の一覧に足す）', assertSucceeds(updateDoc(doc(allStaff, `${SI}/employees/sO`), { officeIds: ['osaka', 'honsha'] })));

// ---- 給与の算定から除く額（支払月・締め日の変更月） ----
// 2026-11 の本社は前のテストで確定済みにしているので、確定していない 2027-01 で確かめる
const salX = { employeeId: 'sH', paidDate: '2027-01-25', yearMonth: '2027-01', officeId: 'honsha', fixedWages: 500000, nonFixedWages: 0, paymentBaseDays: 30 };
await check('算定から除く額つきの給与を登録できる', assertSucceeds(setDoc(doc(allStaff, `${SI}/salaries/sH_2027-01-25`), { ...salX, excludedAmount: 250000 })));
await check('算定から除く額が空（null）の給与も登録できる', assertSucceeds(setDoc(doc(allStaff, `${SI}/salaries/sH_2027-01-26`), { ...salX, paidDate: '2027-01-26', excludedAmount: null })));
await check('支払った額より多い算定から除く額は登録できない', assertFails(setDoc(doc(allStaff, `${SI}/salaries/sH_2027-01-25`), { ...salX, excludedAmount: 600000 })));
await check('マイナスの算定から除く額は登録できない', assertFails(setDoc(doc(allStaff, `${SI}/salaries/sH_2027-01-25`), { ...salX, excludedAmount: -1 })));

await testEnv.cleanup();
console.log(failed === 0 ? 'すべて期待どおりです' : `${failed}件が期待と違います`);
process.exit(failed === 0 ? 0 : 1);
