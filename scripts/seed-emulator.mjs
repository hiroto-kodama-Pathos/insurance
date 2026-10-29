// エミュレータに、画面の確認用のデータを入れる（本番には入らない）
// 使い方：エミュレータを起動したまま、別のターミナルで node scripts/seed-emulator.mjs
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { kyokaiGradeDocs, kyokaiThresholdDocs } from './data/kyokai-grades.mjs';
import { KYOKAI_INSURER, kyokaiRateDocs, pensionRateDocs } from './data/kyokai-rates.mjs';

const env = await initializeTestEnvironment({
  projectId: 'kensyu10170', // アプリと同じプロジェクトID（エミュレータの中だけ）
  firestore: { host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const si = (...path) => doc(db, 'apps', 'socialInsurance', ...path);

  // 保険者・料率（本番への投入と同じデータ。47都道府県の料率が入る）
  await setDoc(si('insurers', KYOKAI_INSURER.id), KYOKAI_INSURER.data);
  for (const r of kyokaiRateDocs()) await setDoc(si('insurerRates', r.id), r.data);
  for (const r of pensionRateDocs()) await setDoc(si('pensionRates', r.id), r.data);

  // 適用事業所
  await setDoc(si('offices', 'honsha'), { name: '本社', prefecture: '東京都', insurerId: 'kyokai', isDefault: true });
  await setDoc(si('offices', 'osaka'), { name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' });

  // 組合健保（特定被保険者制度あり）の確認用：名古屋営業所はサンプル健康保険組合に加入
  await setDoc(si('insurers', 'kumiai-sample'), { type: 'kumiai', name: 'サンプル健康保険組合', specialInsuredEnabled: true });
  await setDoc(si('offices', 'nagoya'), { name: '名古屋営業所', prefecture: '愛知県', insurerId: 'kumiai-sample' });
  for (const [id, rateType, validFrom, rate, employeeShare] of [
    ['kumiai-sample-health-2026-03', 'health', '2026-03', 9000, 450],
    ['kumiai-sample-care-2026-03', 'care', '2026-03', 1600, 500],
    ['kumiai-sample-childSupport-2026-04', 'childSupport', '2026-04', 230, 500],
  ]) {
    await setDoc(si('insurerRates', id), { insurerId: 'kumiai-sample', rateType, prefecture: null, validFrom, rate, employeeShare });
  }

  // 協会けんぽの保険料額表の等級（本番への投入と同じデータ）
  for (const g of kyokaiGradeDocs()) {
    await setDoc(si('grades', g.id), g.data);
  }
  for (const t of kyokaiThresholdDocs()) {
    await setDoc(si('gradeThresholds', t.id), t.data);
  }

  // 従業員
  const employees = [
    { id: 'e001', employeeNumber: '0001', name: '山田 太郎', birthDate: '1980-05-10', office: 'honsha', std: 300_000 },
    { id: 'e002', employeeNumber: '0002', name: '佐藤 花子', birthDate: '1995-08-20', office: 'honsha', std: 260_000 },
    { id: 'e003', employeeNumber: '0003', name: '鈴木 一郎', birthDate: '1961-01-15', office: 'osaka', std: 410_000 },
    { id: 'e004', employeeNumber: '0004', name: '高橋 美咲', birthDate: '1990-03-03', office: 'osaka', std: 220_000 },
    // トップの要確認の確認用：今月（2026年10月）に40歳、来月に70歳になる人
    { id: 'e005', employeeNumber: '0005', name: '伊藤 健太', birthDate: '1986-10-20', office: 'honsha', std: 340_000 },
    { id: 'e006', employeeNumber: '0006', name: '加藤 進', birthDate: '1956-11-20', office: 'honsha', std: 360_000 },
    // 休業終了時改定の確認用：育休を6月30日に終え、7月から時短勤務で復帰した人
    { id: 'e007', employeeNumber: '0007', name: '渡辺 さくら', birthDate: '1992-07-07', office: 'honsha', std: 260_000 },
    // 特定被保険者の確認用：本人は35歳だが、45歳の妻を扶養している（名古屋営業所・組合健保）
    { id: 'e008', employeeNumber: '0008', name: '中村 翔', birthDate: '1991-05-10', office: 'nagoya', std: 300_000 },
  ];
  for (const e of employees) {
    await setDoc(si('employees', e.id), {
      employeeNumber: e.employeeNumber, name: e.name, birthDate: e.birthDate, officeIds: [e.office],
    });
    await setDoc(si('employees', e.id, 'qualifications', 'q1'), { acquiredDate: '2024-04-01', lostDate: null });
    await setDoc(si('employees', e.id, 'assignments', 'a1'), { validFrom: '2024-04-01', officeId: e.office });
    await setDoc(si('employees', e.id, 'insuredTypes', 't1'), { validFrom: '2024-04-01', type: 'general' });
    await setDoc(si('employees', e.id, 'standardRemunerations', 's1'), {
      validFrom: '2024-04', reason: 'acquisition', healthStandard: e.std, pensionStandard: e.std,
    });
  }
  // 会社の設定（保管期間は運営者が決める）
  await setDoc(si('companySettings', 'main'), {
    retentionYears: 2,
    childSupportRounding: 'combined',
    deductionTiming: 'nextMonth',
    payrollCutoff: { day: 'end', paidIn: 'nextMonth' },
  });

  // 賞与（12月10日支給）。高橋さんは育休中なので免除になる
  await setDoc(si('bonuses', 'b-e001-2026-12'), { employeeId: 'e001', paidDate: '2026-12-10', amount: 500000, yearMonth: '2026-12', officeId: 'honsha' });
  await setDoc(si('bonuses', 'b-e004-2026-12'), { employeeId: 'e004', paidDate: '2026-12-10', amount: 400000, yearMonth: '2026-12', officeId: 'osaka' });

  // 給与（7〜10月の25日払い）。随時改定の候補の確認用
  // 山田さんは8月に昇給（30万→34万＋残業2万）：8〜10月の平均36万円で3等級上がり、11月分から改定の候補になる
  // 佐藤さんは8月に1万円の昇給：1等級しか変わらないので候補にならない
  const pay = [
    { id: 'e001', fixed: [300000, 340000, 340000, 340000], nonFixed: [0, 20000, 20000, 20000], office: 'honsha' },
    { id: 'e002', fixed: [250000, 260000, 260000, 260000], nonFixed: [0, 10000, 10000, 10000], office: 'honsha' },
  ];
  const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
  for (const p of pay) {
    for (const [i, ym] of months.entries()) {
      const paidDate = `${ym}-25`;
      await setDoc(si('salaries', `${p.id}_${paidDate}`), {
        employeeId: p.id, paidDate, yearMonth: ym, officeId: p.office,
        fixedWages: p.fixed[i], nonFixedWages: p.nonFixed[i], paymentBaseDays: 30,
        retroactiveDiff: null, inKindWages: null,
      });
    }
  }

  // 給与（4〜6月の25日払い）。定時決定の見込みの確認用
  // 山田さん：残業代が増えて平均33万円 → 9月分から34万円の見込み
  // 佐藤さん：25万円のまま → 26万円（同じ等級）の見込み
  // 鈴木さん：5月は欠勤で支払基礎日数10日 → 5月を平均から除く
  const spring = [
    { id: 'e001', office: 'honsha', rows: [[300000, 20000, 30], [300000, 30000, 31], [300000, 40000, 30]] },
    { id: 'e002', office: 'honsha', rows: [[250000, 0, 30], [250000, 0, 31], [250000, 0, 30]] },
    { id: 'e003', office: 'osaka', rows: [[400000, 0, 30], [200000, 0, 10], [400000, 0, 30]] },
  ];
  for (const p of spring) {
    for (const [i, ym] of ['2026-04', '2026-05', '2026-06'].entries()) {
      const [fixed, nonFixed, days] = p.rows[i];
      const paidDate = `${ym}-25`;
      await setDoc(si('salaries', `${p.id}_${paidDate}`), {
        employeeId: p.id, paidDate, yearMonth: ym, officeId: p.office,
        fixedWages: fixed, nonFixedWages: nonFixed, paymentBaseDays: days,
        retroactiveDiff: null, inKindWages: null,
      });
    }
  }

  // 渡辺さん：育休（2025-04-01〜2026-06-30）から7月に時短で復帰。7〜9月の給与24万円（9月は16日で平均から除く）
  // → 1等級下がるので、10月分から（翌年8月分まで）休業終了時改定の候補になる
  await setDoc(si('employees', 'e007', 'leaves', 'l1'), { type: 'childcare', startDate: '2025-04-01', endDate: '2026-06-30' });
  for (const [ym, days] of [['2026-07', 31], ['2026-08', 31], ['2026-09', 16]]) {
    const paidDate = `${ym}-25`;
    await setDoc(si('salaries', `e007_${paidDate}`), {
      employeeId: 'e007', paidDate, yearMonth: ym, officeId: 'honsha',
      fixedWages: 240000, nonFixedWages: 0, paymentBaseDays: days, retroactiveDiff: null, inKindWages: null,
    });
  }

  // 給与から控除できない月の確認用（10月25日払い。翌月控除なので9月分の保険料を控除する）
  // 鈴木さん：休職で無給 → 控除不足、伊藤さん：欠勤が多く6万円 → 注意（保険料が給与の60%超）
  for (const [id, office, fixed, days] of [['e003', 'osaka', 0, 0], ['e005', 'honsha', 60000, 8]]) {
    await setDoc(si('salaries', `${id}_2026-10-25`), {
      employeeId: id, paidDate: '2026-10-25', yearMonth: '2026-10', officeId: office,
      fixedWages: fixed, nonFixedWages: 0, paymentBaseDays: days, retroactiveDiff: null, inKindWages: null,
    });
  }

  // 中村さんの被扶養者（妻、1980年生まれで40〜64歳）
  await setDoc(si('employees', 'e008', 'dependents', 'd1'), { name: '中村 由美', birthDate: '1980-06-01', certifiedDate: '2024-04-01', removedDate: null });

  // 高橋さんは育休中
  await setDoc(si('employees', 'e004', 'leaves', 'l1'), { type: 'childcare', startDate: '2026-09-01', endDate: null });
});

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
let account = await post(`${AUTH}/accounts:signUp?key=fake-api-key`, { ...DEV, returnSecureToken: true });
if (account.error) {
  // すでにある場合はログインして uid を取る
  account = await post(`${AUTH}/accounts:signInWithPassword?key=fake-api-key`, { ...DEV, returnSecureToken: true });
}
await post(
  `${AUTH}/projects/kensyu10170/accounts:update`,
  { localId: account.localId, customAttributes: JSON.stringify({ siRole: 'admin', siScope: 'all' }) },
  { Authorization: 'Bearer owner' },
);

console.log('エミュレータにデータと開発アカウント（dev@example.com）を入れました');
