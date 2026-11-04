// エミュレータに、画面の確認用のデータを入れる（本番には入らない）
// 使い方：エミュレータを起動したまま、別のターミナルで node scripts/seed-emulator.mjs
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { kyokaiGradeDocs, kyokaiThresholdDocs } from './data/kyokai-grades.mjs';
import { KYOKAI_INSURER, kyokaiRateDocs, pensionRateDocs } from './data/kyokai-rates.mjs';
import { eligibilityRuleDocs } from './data/eligibility-rules.mjs';

const env = await initializeTestEnvironment({
  projectId: 'kensyu10170', // アプリと同じプロジェクトID（エミュレータの中だけ）
  firestore: { host: '127.0.0.1', port: 8080 },
});

// 前に画面で登録したデータ（標準報酬月額の履歴・届出済みなど）が残らないように、Firestore を空にしてから入れる
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
  // 入社時の報酬月額の内訳（山田さん：合計29.5万円 → 30万円の等級）
  await setDoc(si('employees', 'e001', 'standardRemunerations', 's1'), {
    validFrom: '2024-04', reason: 'acquisition', healthStandard: 300_000, pensionStandard: 300_000,
    remuneration: 295_000,
    remunerationBreakdown: { basic: 250_000, allowances: 20_000, commuting: 15_000, overtime: 10_000 },
  });
  // 会社の設定（保管期間は運営者が決める）
  await setDoc(si('companySettings', 'main'), {
    retentionYears: 2,
    childSupportRounding: 'combined',
    deductionTiming: 'nextMonth',
    payrollCutoff: { day: 'end', paidIn: 'nextMonth' },
    fullTimeWeeklyHours: 40,
    fullTimeMonthlyDays: 20,
    specificApplicable: false,
  });

  // 加入の可能性の確認用：未加入のパート。契約は週25時間（企業規模の基準に当たらないため加入しない）だが、
  // 9・10月の実際の労働時間が月140時間（週32.3時間）で、通常の労働者の4分の3（週30時間）以上が続いた
  await setDoc(si('employees', 'e009'), {
    employeeNumber: '0009', name: '小林 美穂', birthDate: '1988-02-14', officeIds: ['honsha'],
    eligibility: {
      employmentType: 'partTime', weeklyHours: 25, monthlyDays: 20, contractEnd: '', renewalExpected: false, isStudent: false,
      candidate: 'none',
      reasons: [
        '週の所定労働時間が、通常の労働者の4分の3（週30時間）未満',
        '企業規模の基準（厚生年金の被保険者51人以上）に当たらないため、短時間労働者の適用がない（労使で合意した任意特定適用事業所なら加入）',
      ],
    },
  });
  await setDoc(si('employees', 'e009', 'assignments', 'a1'), { validFrom: '2026-04-01', officeId: 'honsha' });
  for (const [ym, hours] of [['2026-08', 100], ['2026-09', 140], ['2026-10', 140]]) {
    await setDoc(si('salaries', `e009_${ym}-25`), {
      employeeId: 'e009', paidDate: `${ym}-25`, yearMonth: ym, officeId: 'honsha',
      fixedWages: hours * 1200, nonFixedWages: 0, paymentBaseDays: 20, retroactiveDiff: null, inKindWages: null, workingHours: hours,
    });
  }

  // 時給単価の確認用：時給の斎藤さん。7月は労働時間が増えて額が上がっただけ（変動にしない）、
  // 8月に時給1,100円→1,500円 → 8〜10月の平均24万円で3等級上がり、11月分から改定の候補になる
  await setDoc(si('employees', 'e010'), { employeeNumber: '0010', name: '斎藤 健', birthDate: '1995-09-01', officeIds: ['honsha'] });
  await setDoc(si('employees', 'e010', 'qualifications', 'q1'), { acquiredDate: '2025-04-01', lostDate: null });
  await setDoc(si('employees', 'e010', 'assignments', 'a1'), { validFrom: '2025-04-01', officeId: 'honsha' });
  await setDoc(si('employees', 'e010', 'insuredTypes', 't1'), { validFrom: '2025-04-01', type: 'partTime' });
  await setDoc(si('employees', 'e010', 'standardRemunerations', 's1'), {
    validFrom: '2025-04', reason: 'acquisition', healthStandard: 180_000, pensionStandard: 180_000,
  });
  for (const [ym, rate, hours] of [['2026-06', 1100, 160], ['2026-07', 1100, 200], ['2026-08', 1500, 160], ['2026-09', 1500, 160], ['2026-10', 1500, 160]]) {
    await setDoc(si('salaries', `e010_${ym}-25`), {
      employeeId: 'e010', paidDate: `${ym}-25`, yearMonth: ym, officeId: 'honsha',
      fixedWages: rate * hours, nonFixedWages: 0, paymentBaseDays: 20, retroactiveDiff: null, inKindWages: null,
      workingHours: hours, hourlyRate: rate,
    });
  }

  // 遡及の可能性の確認用：加藤さん。8月36万 → 9月46万（遡及差額を入れていない）→ 10月38万
  for (const [ym, fixed] of [['2026-08', 360000], ['2026-09', 460000], ['2026-10', 380000]]) {
    await setDoc(si('salaries', `e006_${ym}-25`), {
      employeeId: 'e006', paidDate: `${ym}-25`, yearMonth: ym, officeId: 'honsha',
      fixedWages: fixed, nonFixedWages: 0, paymentBaseDays: 31, retroactiveDiff: null, inKindWages: null,
    });
  }

  // 通知書待ちの確認用：伊藤さんの9月分からの定時決定を、見込みの額（34万円）で先に登録した
  await setDoc(si('employees', 'e005', 'standardRemunerations', 's-2026-09'), {
    validFrom: '2026-09', reason: 'regular', healthStandard: 340_000, pensionStandard: 340_000,
    remuneration: null, provisional: true,
  });

  // 届出の期限の確認用：10月26日に入社した木村さん（資格取得届は10月31日まで）
  await setDoc(si('employees', 'e011'), { employeeNumber: '0011', name: '木村 拓也', birthDate: '1998-04-02', officeIds: ['honsha'] });
  await setDoc(si('employees', 'e011', 'qualifications', 'q1'), { acquiredDate: '2026-10-26', lostDate: null, lostReason: null });
  await setDoc(si('employees', 'e011', 'assignments', 'a1'), { validFrom: '2026-10-26', officeId: 'honsha' });
  await setDoc(si('employees', 'e011', 'insuredTypes', 't1'), { validFrom: '2026-10-26', type: 'general' });
  await setDoc(si('employees', 'e011', 'standardRemunerations', 's1'), {
    validFrom: '2026-10', reason: 'acquisition', healthStandard: 240_000, pensionStandard: 240_000, remuneration: 240_000, provisional: false,
  });

  // 退職者データの消去の確認用：小林さんは2024年3月31日に退職（4月1日喪失）。最後の月次確定は2024年3月分（4月5日に確定）
  // → 保管期間2年がたった（2026年4月5日）ので、消去の処理を動かすと消え、2024年3月分の確定の氏名・社員番号は匿名IDになる
  await setDoc(si('employees', 'e013'), { employeeNumber: '0013', name: '小林 誠', birthDate: '1988-02-14', officeIds: ['honsha'] });
  await setDoc(si('employees', 'e013', 'qualifications', 'q1'), { acquiredDate: '2019-04-01', lostDate: '2024-04-01', lostReason: 'retirement' });
  await setDoc(si('employees', 'e013', 'assignments', 'a1'), { validFrom: '2019-04-01', officeId: 'honsha' });
  await setDoc(si('employees', 'e013', 'standardRemunerations', 's1'), {
    validFrom: '2023-09', reason: 'regular', healthStandard: 240_000, pensionStandard: 240_000, remuneration: null, provisional: false,
  });
  await setDoc(si('salaries', 'e013_2024-03-25'), {
    employeeId: 'e013', paidDate: '2024-03-25', yearMonth: '2024-03', officeId: 'honsha',
    fixedWages: 240000, nonFixedWages: 0, paymentBaseDays: 31, retroactiveDiff: null, inKindWages: null,
  });
  const p = (fullSen) => ({ fullSen, employeeYen: Math.round(fullSen / 200), employerSen: fullSen / 2 });
  await setDoc(si('closings', '2024-03'), { offices: { honsha: Timestamp.fromDate(new Date('2024-04-05T01:00:00Z')) } });
  await setDoc(si('closings', '2024-03', 'offices', 'honsha'), {
    yearMonth: '2024-03', officeId: 'honsha', closedBy: 'seed', closedAt: Timestamp.fromDate(new Date('2024-04-05T01:00:00Z')),
    rows: [{
      employeeId: 'e013', employeeNumber: '0013', name: '小林 誠', insurerId: 'kyokai',
      standard: { health: 240000, pension: 240000 },
      rates: { health: { rate: 9980, share: 500 }, care: null, childSupport: null, pension: { rate: 18300, share: 500 } },
      careLabel: 'none', exempt: false,
      premiums: { health: p(2395200), care: null, childSupport: null, pension: p(4392000) },
    }],
    totals: {
      healthCare: { paymentYen: 23952, employeeTotal: 11976, employerTotal: 11976 },
      childSupport: { paymentYen: 0, employeeTotal: 0, employerTotal: 0 },
      pension: { paymentYen: 43920, employeeTotal: 21960, employerTotal: 21960 },
    },
    bonusRows: [],
    bonusTotals: {
      healthCare: { paymentYen: 0, employeeTotal: 0, employerTotal: 0 },
      childSupport: { paymentYen: 0, employeeTotal: 0, employerTotal: 0 },
      pension: { paymentYen: 0, employeeTotal: 0, employerTotal: 0 },
    },
  });

  // 同月得喪の確認用：中村さんは9月7日入社・9月25日退職（9月26日喪失）。9月分の保険料が1か月分かかり、厚生年金の還付待ちになる
  await setDoc(si('employees', 'e012'), { employeeNumber: '0012', name: '中村 さくら', birthDate: '2001-07-15', officeIds: ['honsha'] });
  await setDoc(si('employees', 'e012', 'qualifications', 'q1'), { acquiredDate: '2026-09-07', lostDate: '2026-09-26', lostReason: 'retirement' });
  await setDoc(si('employees', 'e012', 'assignments', 'a1'), { validFrom: '2026-09-07', officeId: 'honsha' });
  await setDoc(si('employees', 'e012', 'insuredTypes', 't1'), { validFrom: '2026-09-07', type: 'general' });
  await setDoc(si('employees', 'e012', 'standardRemunerations', 's1'), {
    validFrom: '2026-09', reason: 'acquisition', healthStandard: 220_000, pensionStandard: 220_000, remuneration: 220_000, provisional: false,
  });

  // 給与の支払区分：月給者（既定）とパート。佐藤さんは10月1日からパート
  await setDoc(si('payrollGroups', 'monthly'), {
    name: '月給者', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: true,
  });
  await setDoc(si('payrollGroups', 'part'), {
    name: 'パート', cutoffDay: 15, paidIn: 'sameMonth', deductionTiming: 'sameMonth', payDay: 25, isDefault: false,
  });
  await setDoc(si('employees', 'e002', 'payrollAssignments', 'p1'), { validFrom: '2026-10-01', payrollGroupId: 'part' });

  // 賞与（12月10日支給）。高橋さんは育休中なので免除になる
  await setDoc(si('bonuses', 'b-e001-2026-12'), { employeeId: 'e001', paidDate: '2026-12-10', amount: 500000, yearMonth: '2026-12', officeId: 'honsha', bonusTypeId: 'winter', isRemuneration: false });
  // 賞与の種類：四半期賞与は年4回以上支給（報酬扱い）。佐藤さんは前年7月〜当年6月に四半期賞与を4回（計48万円）受けた
  // → 2026年の定時決定の見込みで 48万円 ÷ 12 ＝ 4万円を上乗せする
  await setDoc(si('bonusTypes', 'summer'), { name: '夏季賞与', isRemuneration: false, validFrom: '2020-04' });
  await setDoc(si('bonusTypes', 'winter'), { name: '冬季賞与', isRemuneration: false, validFrom: '2020-04' });
  await setDoc(si('bonusTypes', 'quarterly'), { name: '四半期賞与', isRemuneration: true, validFrom: '2025-04' });
  for (const paidDate of ['2025-07-10', '2025-10-10', '2026-01-10', '2026-04-10']) {
    await setDoc(si('bonuses', `b-e002-${paidDate}`), {
      employeeId: 'e002', paidDate, amount: 120000, yearMonth: paidDate.slice(0, 7), officeId: 'honsha',
      bonusTypeId: 'quarterly', isRemuneration: true,
    });
  }

  // 届け出る賞与額の確認用：山田さんは12月25日に自社製品（現物3万円）を含む10万円の賞与も受ける → 12月の届け出る額は60万円
  await setDoc(si('bonuses', 'b-e001-2026-12-25'), { employeeId: 'e001', paidDate: '2026-12-25', amount: 100000, inKindAmount: 30000, yearMonth: '2026-12', officeId: 'honsha' });
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

  // 鈴木さんの休職（私傷病・10月1日から、終了日未定）。保険料は通常どおりかかり、10月の給与（無給）で控除不足になる
  await setDoc(si('employees', 'e003', 'absences', 'ab1'), { reason: 'sickness', startDate: '2026-10-01', endDate: null });

  // 中村さんの被扶養者（妻、1980年生まれで40〜64歳）
  await setDoc(si('employees', 'e008', 'dependents', 'd1'), { name: '中村 由美', birthDate: '1980-06-01', certifiedDate: '2024-04-01', removedDate: null });

  // 高橋さんは育休中
  await setDoc(si('employees', 'e004', 'leaves', 'l1'), { type: 'childcare', startDate: '2026-09-01', endDate: null });

  // ========== テストデータ追加：30人 ==========
  const lastNames = ['鈴木', '田中', '佐藤', '新田', '中山', '吉田', '渡辺', '伊藤', '山本', '小林', '青田', '赤間', '相馬', '浅野', '阿部', '荒木', '有賀', '安藤', '池田', '石井', '石岡', '石田', '市川', '市村', '稲葉', '稲見', '稲森', '井上', '今井', '芋田'];
  const firstNames = ['太郎', '花子', '一郎', '美咲', '健太', '進', '樹', '由美', '翼', '彩', '拓也', '麻衣', '龍一', '由紀', '大輔', '美佳', '淳平', '千尋', '靖子', '亮太', '優子', '陽一', '結衣', '和也', '知美', '勇気', '春菜', '隆一', '恵美', '琴子'];
  
  for (let i = 0; i < 30; i++) {
    const eid = `e${100 + i}`;
    const empNum = `${100 + i}`.padStart(4, '0');
    const lastName = lastNames[i];
    const firstName = firstNames[i];
    const name = `${lastName} ${firstName}`;
    const birthYear = 1950 + Math.floor(Math.random() * 50);
    const birthMonth = Math.floor(Math.random() * 12) + 1;
    const birthDay = Math.floor(Math.random() * 28) + 1;
    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
    const office = ['honsha', 'osaka'][Math.floor(Math.random() * 2)];
    const std = (Math.floor(Math.random() * 10) + 2) * 50_000;
    
    await setDoc(si('employees', eid), {
      employeeNumber: empNum, name, birthDate, officeIds: [office],
    });
    await setDoc(si('employees', eid, 'qualifications', 'q1'), { acquiredDate: '2024-04-01', lostDate: null });
    await setDoc(si('employees', eid, 'assignments', 'a1'), { validFrom: '2024-04-01', officeId: office });
    await setDoc(si('employees', eid, 'insuredTypes', 't1'), { validFrom: '2024-04-01', type: 'general' });
    await setDoc(si('employees', eid, 'standardRemunerations', 's1'), {
      validFrom: '2024-04', reason: 'acquisition', healthStandard: std, pensionStandard: std,
    });
    
    // 過去数か月の給与を適当に追加（4月以降）
    for (const ym of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      const variation = 0.95 + Math.random() * 0.1;
      const fixed = Math.round(std * variation);
      const nonFixed = Math.floor(Math.random() * 50_000);
      await setDoc(si('salaries', `${eid}_${ym}-25`), {
        employeeId: eid, paidDate: `${ym}-25`, yearMonth: ym, officeId: office,
        fixedWages: fixed, nonFixedWages: nonFixed, paymentBaseDays: 30,
        retroactiveDiff: null, inKindWages: null,
      });
    }
  }
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
// 担当範囲の確認用：大阪支店だけを担当する担当者（osaka@example.com ／ dev-password）
await devAccount({ email: 'osaka@example.com', password: 'dev-password' }, { siRole: 'staff', siScope: 'osaka' });

console.log('エミュレータにデータと開発アカウント（dev@example.com・osaka@example.com）を入れました');
