// 人数の多い会社を想定した、テスト用の従業員を作る（エミュレータ用 seed-bulk.mjs と、本番の確認用 bulk-production.mjs で共通）
// 乱数の種を固定しているので、同じ引数なら何度作っても同じ内容になる。
import { kyokaiGradeDocs } from './kyokai-grades.mjs';

/**
 * @param {object} o
 * @param {number} o.count 人数
 * @param {[string, number][]} o.offices [事業所ID, 重み] の一覧
 * @param {string|null} o.partGroupId パートの支払区分のID（なければ null。支払区分の履歴を作らない）
 * @param {string|null} o.bonusTypeId 冬の賞与の種類のID（なければ null）
 * @param {string} o.idPrefix 従業員IDの頭（例：'b' → b001）
 * @param {string} o.numberPrefix 社員番号の頭（'' → 1001〜、'T' → T0001〜）
 * @param {boolean} o.mark 従業員の文書に bulkTest: true を付ける（本番で、消すときの目印にする）
 */
export function buildBulkPeople({ count, offices, partGroupId, bonusTypeId, idPrefix, numberPrefix, mark }) {
  // ---- 乱数（種を固定して、毎回同じデータにする） ----
  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(300);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  /** 重みつきで選ぶ：[[値, 重み], …] */
  const weighted = (pairs) => {
    const total = pairs.reduce((t, [, w]) => t + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs.at(-1)[0];
  };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const round1000 = (n) => Math.round(n / 1000) * 1000;

  // ---- 名前 ----
  const FAMILY = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水', '山崎', '森', '池田', '橋本', '阿部', '石川', '山下', '中島', '石井', '小川', '前田', '岡田', '長谷川', '藤田', '後藤', '近藤', '村上', '遠藤', '青木', '坂本'];
  const GIVEN = ['翔太', '大輔', '健一', '拓也', '直樹', '亮', '剛', '誠', '和也', '隆', '陽菜', '結衣', '美咲', '彩', '真由美', '恵', '愛', '優子', '舞', '千尋', '蓮', '湊', '悠真', '大和', '葵', '凛', '芽依', '紗希', '智子', '裕子'];

  // ---- 標準報酬月額（協会けんぽの等級表から決める） ----
  const GRADES = kyokaiGradeDocs().map((g) => g.data);
  /** 報酬月額から健康保険の標準報酬月額を決める */
  function healthStandard(pay) {
    return GRADES.findLast((g) => pay >= g.lowerLimit).standardAmount;
  }
  /** 厚生年金は 8.8万円〜65万円の範囲に収める */
  const pensionStandard = (health) => Math.min(650_000, Math.max(88_000, health));

  // ---- 振り分け ----
  const OFFICES = offices;
  const SALARY_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const monthsAfter = (ym, from) => ym >= from;

  /** 1人分のドキュメント（パスと中身）を作る */
  function buildPerson(i) {
    const id = `${idPrefix}${pad(i, 3)}`;
    const employeeNumber = numberPrefix ? `${numberPrefix}${pad(i, 4)}` : String(1000 + i);
    const name = `${pick(FAMILY)} ${pick(GIVEN)}`;
    const office = weighted(OFFICES);
    const birthDate = `${int(1958, 2005)}-${pad(int(1, 12))}-${pad(int(1, 28))}`;
    // 種類：一般の正社員が多く、短時間労働者・パートの区分、未加入、退職者を少し混ぜる
    const kind = weighted([['general', 78], ['shortTime', 8], ['partGroup', 6], ['uninsured', 4], ['retired', 2], ['childcare', 2]]);
    const joinYear = int(2015, 2026);
    const joinMonth = joinYear === 2026 ? int(1, 9) : int(1, 12);
    const acquiredDate = `${joinYear}-${pad(joinMonth)}-01`;
    const acquiredYm = acquiredDate.slice(0, 7);
    const docs = [];
    const put = (path, data) => docs.push({ path, data });

    put(['employees', id], { employeeNumber, name, birthDate, officeIds: [office], ...(mark ? { bulkTest: true } : {}) });
    put(['employees', id, 'assignments', 'a1'], { validFrom: acquiredDate, officeId: office });

    // 未加入（パート・アルバイト）：時給で働き、労働時間を入れる。1割ほどは2か月続けて週20時間を超える
    if (kind === 'uninsured') {
      const rate = pick([1100, 1150, 1200, 1300]);
      const busy = rand() < 0.4;
      for (const ym of SALARY_MONTHS) {
        if (!monthsAfter(ym, acquiredYm)) continue;
        const hours = busy && ym >= '2026-09' ? int(90, 100) : int(40, 75);
        put(['salaries', `${id}_${ym}-25`], {
          employeeId: id, paidDate: `${ym}-25`, yearMonth: ym, officeId: office,
          fixedWages: hours * rate, nonFixedWages: 0, paymentBaseDays: int(10, 16),
          retroactiveDiff: null, inKindWages: null, workingHours: hours, hourlyRate: rate,
        });
      }
      if (partGroupId) put(['employees', id, 'payrollAssignments', 'p1'], { validFrom: acquiredDate, payrollGroupId: partGroupId });
      return { id, office, kind, docs, bonus: null };
    }

    // 加入している人：入社時の給与から標準報酬月額を決める
    const isPart = kind === 'shortTime' || kind === 'partGroup';
    let fixed = isPart ? round1000(int(110, 180) * 1000) : round1000(weighted([[int(200, 280), 45], [int(280, 400), 40], [int(400, 650), 15]]) * 1000);
    const overtime = isPart ? 0 : weighted([[0, 30], [int(10, 40) * 1000, 70]]);
    const std = healthStandard(fixed + overtime);
    put(['employees', id, 'qualifications', 'q1'], kind === 'retired'
      ? { acquiredDate, lostDate: `2026-${pad(int(6, 10))}-01`, lostReason: 'retirement' }
      : { acquiredDate, lostDate: null });
    put(['employees', id, 'insuredTypes', 't1'], { validFrom: acquiredDate, type: kind === 'shortTime' ? 'shortTime' : 'general' });
    put(['employees', id, 'standardRemunerations', 's1'], {
      validFrom: acquiredYm, reason: 'acquisition', healthStandard: std, pensionStandard: pensionStandard(std),
      remuneration: fixed + overtime,
    });
    if (isPart && partGroupId) put(['employees', id, 'payrollAssignments', 'p1'], { validFrom: acquiredDate, payrollGroupId: partGroupId });
    // 3割ほどは配偶者を扶養している
    if (!isPart && rand() < 0.3) {
      put(['employees', id, 'dependents', 'd1'], {
        name: `${name.split(' ')[0]} ${pick(GIVEN)}`, birthDate: `${int(1960, 2000)}-${pad(int(1, 12))}-${pad(int(1, 28))}`,
        certifiedDate: acquiredDate, removedDate: null,
      });
    }
    // 育休中の人（9月から）
    if (kind === 'childcare') put(['employees', id, 'leaves', 'l1'], { type: 'childcare', startDate: '2026-09-01', endDate: null });

    // 給与（4〜10月の25日払い）。6%ほどは8月に昇給し、随時改定の候補になる
    const raised = !isPart && kind !== 'retired' && rand() < 0.06;
    const lostYm = kind === 'retired' ? docs.find((d) => d.path[2] === 'qualifications').data.lostDate.slice(0, 7) : null;
    for (const ym of SALARY_MONTHS) {
      if (!monthsAfter(ym, acquiredYm)) continue;
      if (lostYm && ym >= lostYm) break;
      if (kind === 'childcare' && ym >= '2026-09') break; // 育休中は無給
      const f = raised && ym >= '2026-08' ? fixed + 60_000 : fixed;
      const days = isPart ? int(17, 22) : [30, 31][int(0, 1)];
      put(['salaries', `${id}_${ym}-25`], {
        employeeId: id, paidDate: `${ym}-25`, yearMonth: ym, officeId: office,
        fixedWages: f, nonFixedWages: overtime === 0 ? 0 : round1000(overtime * (0.6 + rand() * 0.8)), paymentBaseDays: days,
        retroactiveDiff: null, inKindWages: null,
      });
    }

    // 冬の賞与（12月10日）：正社員だけ。基本給の1.2〜2か月分
    const bonus = !isPart && kind !== 'retired'
      ? { employeeId: id, paidDate: '2026-12-10', amount: round1000(fixed * (1.2 + rand() * 0.8)), yearMonth: '2026-12', officeId: office, bonusTypeId, isRemuneration: false }
      : null;
    if (bonus) put(['bonuses', `b-${id}-2026-12`], bonus);
    return { id, office, kind, docs, bonus, raised };
  }

  return Array.from({ length: count }, (_, k) => buildPerson(k + 1));
}

export const KIND_LABEL = {
  general: '一般（正社員）', shortTime: '短時間労働者', partGroup: 'パートの支払区分（一般）',
  uninsured: '未加入（時給・労働時間あり）', retired: '退職済み（2026年6〜10月）', childcare: '育休中（9月から）',
};

/** 内訳を表示する */
export function printSummary(people, officeName = (id) => id) {
  const tally = (key) => people.reduce((m, p) => ((m[p[key]] = (m[p[key]] ?? 0) + 1), m), {});
  const docs = people.flatMap((p) => p.docs);
  console.log(`従業員 ${people.length}人（社員番号 ${people[0].docs[0].data.employeeNumber}〜${people.at(-1).docs[0].data.employeeNumber}、ID ${people[0].id}〜）`);
  console.log('　事業所：' + Object.entries(tally('office')).map(([k, n]) => `${officeName(k)} ${n}人`).join('・'));
  console.log('　種類　：' + Object.entries(tally('kind')).map(([k, n]) => `${KIND_LABEL[k]} ${n}人`).join('・'));
  console.log(`　8月に昇給（随時改定の候補）：${people.filter((p) => p.raised).length}人`);
  console.log(`　冬の賞与（2026-12-10）：${people.filter((p) => p.bonus).length}人`);
  console.log(`　書き込むドキュメント：${docs.length}件`);
}
