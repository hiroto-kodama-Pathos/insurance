import { buildKyokaiGrades, buildKyokaiThresholds } from './grade-suggest';
import { findLeaveEndCandidates, findRevisionCandidates, openRevisionCandidates, RevisionEmployee, trackRevisionCandidates } from './revision';
import { SalaryRecord } from './salary';

const grades = buildKyokaiGrades('2020-09');
const thresholds = buildKyokaiThresholds('2020-09');

function employee(std: number, over: Partial<RevisionEmployee> = {}, pensionStd = std): RevisionEmployee {
  return {
    id: 'e1',
    birthDate: '1980-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: std, pensionStandard: pensionStd }],
    ...over,
  };
}

/** 7月から月ごとの [固定的賃金, 非固定的賃金, 支払基礎日数, 遡及差額] */
function salaries(rows: [number, number, number?, number?][], startYm = '2026-07'): SalaryRecord[] {
  const [y, m] = startYm.split('-').map(Number);
  return rows.map(([fixed, nonFixed, days = 30, retro = 0], i) => {
    const t = y * 12 + (m - 1) + i;
    const ym = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    return {
      id: `s${i}`, employeeId: 'e1', paidDate: `${ym}-25`,
      fixedWages: fixed, nonFixedWages: nonFixed, paymentBaseDays: days,
      retroactiveDiff: retro || null, inKindWages: null,
    };
  });
}

describe('findRevisionCandidates（随時改定の候補）', () => {
  it('固定的賃金が上がり、3か月平均が2等級以上上がる人は候補になる（4か月目から）', () => {
    const c = findRevisionCandidates(
      employee(300_000),
      salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]),
      grades, thresholds,
    );
    expect(c.length).toBe(1);
    expect(c[0].changeMonth).toBe('2026-08');
    expect(c[0].expectedFrom).toBe('2026-11');
    expect(c[0].average).toBe(360_000);
    expect(c[0].health.currentGrade).toBe(22);
    expect(c[0].health.newGrade).toBe(25);
    expect(c[0].expectedHealth).toBe(360_000);
    expect(c[0].expectedPension).toBe(360_000);
    expect(c[0].needsReview).toBe(false);
  });

  it('時給の人は、時給単価が変わった月を変動月にする（労働時間だけ変わった月は変動にしない）', () => {
    // 7月 1,100円×160h、8月 1,100円×200h（額だけ増えた）、9〜11月 1,500円×160h
    const rows: [string, number, number][] = [['2026-07', 1100, 160], ['2026-08', 1100, 200], ['2026-09', 1500, 160], ['2026-10', 1500, 160], ['2026-11', 1500, 160]];
    const list: SalaryRecord[] = rows.map(([ym, rate, h], i) => ({
      id: `h${i}`, employeeId: 'e1', paidDate: `${ym}-25`, fixedWages: rate * h, nonFixedWages: 0, paymentBaseDays: 20,
      retroactiveDiff: null, inKindWages: null, hourlyRate: rate,
    }));
    const c = findRevisionCandidates(employee(180_000), list, grades, thresholds);
    expect(c.map((x) => x.changeMonth)).toEqual(['2026-09']);
    expect(c[0].average).toBe(240_000);
    expect(c[0].notes).toContain('時給単価の変動（1,100円→1,500円）');
  });

  it('担当者が「固定的賃金の変動として登録」した月は、額が変わらなくても変動月として判定する', () => {
    // 手当の新設などで、7月から額は同じでも、8月に変動として登録。8〜10月の残業込みの平均で判定する
    const c = findRevisionCandidates(
      employee(260_000, { fixedWageChanges: [{ yearMonth: '2026-08', direction: 'up', note: '所定労働時間の延長' }] }),
      salaries([[260_000, 0], [260_000, 60_000], [260_000, 60_000], [260_000, 60_000]]),
      grades, thresholds,
    );
    expect(c.map((x) => x.changeMonth)).toEqual(['2026-08']);
    expect(c[0].notes).toContain('固定的賃金の変動として登録：所定労働時間の延長');
  });

  it('現物給与がある月は、届書に通貨・現物を分けて書く旨を出す', () => {
    const list = salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]).map((x, i) => (i === 2 ? { ...x, inKindWages: 30_000 } : x));
    const c = findRevisionCandidates(employee(300_000), list, grades, thresholds);
    expect(c[0].months[1].inKind).toBe(30_000);
    expect(c[0].notes).toContain('現物給与あり（届書に通貨・現物を分けて書く）');
  });

  it('3か月の途中で支払区分の締め日・支払月が変わったら、要確認にする', () => {
    const cutoff = (_id: string, ym: string) => (ym >= '2026-09' ? { day: 15 as const, paidIn: 'sameMonth' as const } : { day: 'end' as const, paidIn: 'nextMonth' as const });
    const c = findRevisionCandidates(employee(300_000), salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]), grades, thresholds, cutoff);
    expect(c[0].needsReview).toBe(true);
    // 末日締め・翌月払い → 15日締め・当月払い：9月は8/1〜9/15の2か月分。変更前の給与の額を入れるまで要確認
    expect(c[0].notes.some((n) => n.includes('9月は支払月の変更（翌月払い→当月払い）で2か月分を払った月'))).toBe(true);
  });

  it('2か月分の月に算定から除く額を入れると、それを除いて平均し、要確認を外す', () => {
    const cutoff = (_id: string, ym: string) => (ym >= '2026-09' ? { day: 'end' as const, paidIn: 'sameMonth' as const } : { day: 'end' as const, paidIn: 'nextMonth' as const });
    const rows = salaries([[300_000, 0], [340_000, 20_000], [700_000, 40_000], [340_000, 20_000]]);
    rows[2].excludedAmount = 380_000;
    const c = findRevisionCandidates(employee(300_000), rows, grades, thresholds, cutoff);
    expect(c[0].average).toBe(360_000);
    expect(c[0].needsReview).toBe(false);
    expect(c[0].notes.some((n) => n.includes('変更前の給与380,000円を除いて平均'))).toBe(true);
  });

  it('一時帰休の月がある候補は要確認にする', () => {
    const e = { ...employee(300_000), absences: [{ reason: 'furlough' as const, startDate: '2026-09-01', endDate: null }] };
    const c = findRevisionCandidates(e, salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]), grades, thresholds);
    expect(c[0].needsReview).toBe(true);
    expect(c[0].notes.some((n) => n.startsWith('一時帰休の月あり（9月・10月。'))).toBe(true);
  });

  it('1等級の差なら候補にならない', () => {
    const c = findRevisionCandidates(
      employee(260_000),
      salaries([[250_000, 0], [260_000, 10_000], [260_000, 10_000], [260_000, 10_000]]),
      grades, thresholds,
    );
    expect(c).toEqual([]);
  });

  it('残業代（非固定的賃金）だけの増減は候補にならない', () => {
    const c = findRevisionCandidates(
      employee(300_000),
      salaries([[300_000, 0], [300_000, 100_000], [300_000, 100_000], [300_000, 100_000]]),
      grades, thresholds,
    );
    expect(c).toEqual([]);
  });

  it('3か月のうち支払基礎日数が17日未満の月があれば候補にならない', () => {
    const c = findRevisionCandidates(
      employee(300_000),
      salaries([[300_000, 0], [360_000, 0], [360_000, 0, 16], [360_000, 0]]),
      grades, thresholds,
    );
    expect(c).toEqual([]);
  });

  it('3か月分の給与がそろっていなければ候補にならない', () => {
    const c = findRevisionCandidates(employee(300_000), salaries([[300_000, 0], [360_000, 0], [360_000, 0]]), grades, thresholds);
    expect(c).toEqual([]);
  });

  it('固定的賃金は上がったが、残業が減って等級が下がる（向きが違う）なら候補にならない', () => {
    const c = findRevisionCandidates(
      employee(360_000),
      salaries([[300_000, 60_000], [310_000, 0], [310_000, 0], [310_000, 0]]),
      grades, thresholds,
    );
    expect(c).toEqual([]);
  });

  it('遡及差額は変動の判定と平均から除く', () => {
    // 8月に昇給後の33万円と、7月分にさかのぼる差額5万円を払った（設計書 2.15）
    const c = findRevisionCandidates(
      employee(280_000),
      salaries([[280_000, 0], [380_000, 0, 31, 50_000], [330_000, 0], [330_000, 0]]),
      grades, thresholds,
    );
    expect(c.length).toBe(1);
    expect(c[0].average).toBe(330_000);
    expect(c[0].notes).toContain('遡及差額を除いて平均');
  });

  it('健康保険だけ当たるときは要確認（厚生年金は上限で等級が変わらない）', () => {
    const c = findRevisionCandidates(
      employee(650_000),
      salaries([[650_000, 0], [750_000, 0], [750_000, 0], [750_000, 0]]),
      grades, thresholds,
    );
    expect(c.length).toBe(1);
    expect(c[0].health.qualifies).toBe(true);
    expect(c[0].pension!.qualifies).toBe(false);
    expect(c[0].needsReview).toBe(true);
    expect(c[0].notes).toContain('健康保険のみ当たる');
    expect(c[0].expectedHealth).toBe(750_000);
    expect(c[0].expectedPension).toBe(650_000);
  });

  it('厚生年金の最高等級の1つ下から、665,000円以上になれば特例で候補になる', () => {
    const c = findRevisionCandidates(
      employee(620_000),
      salaries([[620_000, 0], [670_000, 0], [670_000, 0], [670_000, 0]]),
      grades, thresholds,
    );
    expect(c.length).toBe(1);
    expect(c[0].pension!.diff).toBe(1);
    expect(c[0].pension!.special).toBe(true);
    expect(c[0].pension!.qualifies).toBe(true);
    expect(c[0].expectedPension).toBe(650_000);
    expect(c[0].needsReview).toBe(false);
  });

  it('厚生年金の最高等級の人が下がるときは、決めたときの報酬月額が665,000円以上なら特例で候補になる', () => {
    const e = employee(680_000, {}, 650_000);
    e.standardHistory[0].remuneration = 700_000;
    const c = findRevisionCandidates(e, salaries([[700_000, 0], [630_000, 0], [630_000, 0], [630_000, 0]]), grades, thresholds);
    expect(c.length).toBe(1);
    expect(c[0].pension!.special).toBe(true);
    expect(c[0].expectedPension).toBe(620_000);
  });

  it('70歳以上の人は厚生年金を判定せず、健康保険で当たれば要確認', () => {
    const c = findRevisionCandidates(
      employee(300_000, { birthDate: '1955-01-15' }),
      salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]),
      grades, thresholds,
    );
    expect(c.length).toBe(1);
    expect(c[0].pension).toBeNull();
    expect(c[0].needsReview).toBe(true);
    expect(c[0].expectedPension).toBe(300_000);
  });

  it('3か月の途中で異動した人は判定しない', () => {
    const c = findRevisionCandidates(
      employee(300_000, {
        assignments: [
          { validFrom: '2024-04-01', officeId: 'honsha' },
          { validFrom: '2026-09-01', officeId: 'osaka' },
        ],
      }),
      salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]),
      grades, thresholds,
    );
    expect(c).toEqual([]);
  });

  it('適用見込み月の標準報酬月額を登録済みなら registered になる', () => {
    const e = employee(300_000);
    e.standardHistory.push({ validFrom: '2026-11', healthStandard: 360_000, pensionStandard: 360_000 });
    const c = findRevisionCandidates(e, salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]), grades, thresholds);
    expect(c.length).toBe(1);
    expect(c[0].registered).toBe(true);
    // 判定は登録の前（3か月目まで）の標準報酬月額と比べる
    expect(c[0].health.currentStandard).toBe(300_000);
  });

describe('被保険者区分による支払基礎日数の基準', () => {
  const rows = salaries([[150_000, 0, 12], [200_000, 0, 12], [200_000, 0, 12], [200_000, 0, 12]]);

  it('短時間労働者は、3か月とも11日以上なら候補になる（一般被保険者なら17日未満で候補にならない）', () => {
    expect(findRevisionCandidates(employee(150_000), rows, grades, thresholds)).toEqual([]);
    const e = employee(150_000, { insuredTypes: [{ validFrom: '2024-04-01', type: 'shortTime' }] });
    const c = findRevisionCandidates(e, rows, grades, thresholds);
    expect(c.length).toBe(1);
    expect(c[0].notes).not.toContain('区分変更あり（備考欄に記入）');
  });

  it('3か月の途中で区分が変わった人は「区分変更あり」', () => {
    const e = employee(300_000, { insuredTypes: [{ validFrom: '2026-08-15', type: 'shortTime' }] });
    const c = findRevisionCandidates(e, salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]), grades, thresholds);
    expect(c[0].notes).toContain('区分変更あり（備考欄に記入）');
  });

  it('特定減額特例対象者は要確認', () => {
    const e = employee(300_000, { insuredTypes: [{ validFrom: '2024-04-01', type: 'specialReduction' }] });
    const c = findRevisionCandidates(e, salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]), grades, thresholds);
    expect(c[0].needsReview).toBe(true);
  });
});

describe('findLeaveEndCandidates（休業終了時改定の候補）', () => {
  // 育休を3月31日に終え、4月1日に時短勤務で復帰（設計書 2.17 の例）
  const leave = { type: 'childcare' as const, startDate: '2025-04-01', endDate: '2026-03-31', workedDays: null };
  const back = salaries([[240_000, 0], [240_000, 0], [240_000, 0, 16]], '2026-04');

  it('復帰した月から3か月の平均で1等級以上下がれば候補（4か月目の7月分から、翌年8月分まで）', () => {
    const c = findLeaveEndCandidates(employee(260_000, { leaves: [leave] }), back, grades);
    expect(c.length).toBe(1);
    expect(c[0].type).toBe('leaveEnd');
    expect(c[0].changeMonth).toBe('2026-04');
    expect(c[0].expectedFrom).toBe('2026-07');
    expect(c[0].expectedUntil).toBe('2027-08');
    expect(c[0].excludedMonths).toEqual(['2026-06']);
    expect(c[0].average).toBe(240_000);
    expect(c[0].health.diff).toBe(-1);
    expect(c[0].notes).toContain('申出により改定可能');
  });

  it('1〜6月に改定する人は、当年8月まで', () => {
    const l = { ...leave, endDate: '2025-12-31' };
    const c = findLeaveEndCandidates(employee(260_000, { leaves: [l] }), salaries([[240_000, 0], [240_000, 0], [240_000, 0]], '2026-01'), grades);
    expect(c[0].expectedFrom).toBe('2026-04');
    expect(c[0].expectedUntil).toBe('2026-08');
  });

  it('等級が変わらなければ候補にならない。3か月分そろっていなければ候補にならない', () => {
    expect(findLeaveEndCandidates(employee(240_000, { leaves: [leave] }), back, grades)).toEqual([]);
    expect(findLeaveEndCandidates(employee(260_000, { leaves: [leave] }), back.slice(0, 2), grades)).toEqual([]);
  });

  it('産休に続けて育休を取った場合は、産休の終了時には判定しない', () => {
    const maternity = { type: 'maternity' as const, startDate: '2025-01-10', endDate: '2025-05-06', workedDays: null };
    const childcare = { type: 'childcare' as const, startDate: '2025-05-07', endDate: '2026-03-31', workedDays: null };
    const c = findLeaveEndCandidates(employee(260_000, { leaves: [maternity, childcare] }), back, grades);
    expect(c.map((x) => x.changeMonth)).toEqual(['2026-04']);
    expect(c[0].leaveType).toBe('childcare');
  });

  it('終わった休業の種類を持つ（産休だけで復帰した人は maternity。届書の名前に使う）', () => {
    const maternity = { type: 'maternity' as const, startDate: '2025-12-20', endDate: '2026-03-31', workedDays: null };
    const c = findLeaveEndCandidates(employee(260_000, { leaves: [maternity] }), back, grades);
    expect(c.map((x) => [x.type, x.leaveType])).toEqual([['leaveEnd', 'maternity']]);
  });

  it('候補の一覧にも、随時改定と同じように出る（ID は種類つき）', () => {
    const c = trackRevisionCandidates([employee(260_000, { leaves: [leave] })], back, grades, thresholds);
    expect(c.map((x) => x.id)).toEqual(['e1_2026-04_leaveEnd']);
  });
});

describe('候補の対応状況', () => {
  const rows = salaries([[300_000, 0], [360_000, 0], [360_000, 0], [360_000, 0]]);

  it('保存した状態がなければ未対応、保存した状態があればそれを使う', () => {
    expect(trackRevisionCandidates([employee(300_000)], rows, grades, thresholds)[0].status).toBe('open');
    const filed = trackRevisionCandidates([employee(300_000)], rows, grades, thresholds, [{ id: 'e1_2026-08_revision', status: 'filed' }]);
    expect(filed[0].id).toBe('e1_2026-08_revision');
    expect(filed[0].status).toBe('filed');
  });

  it('適用見込み月の履歴があれば、保存した状態より登録済みを優先する', () => {
    const e = employee(300_000);
    e.standardHistory.push({ validFrom: '2026-11', healthStandard: 360_000, pensionStandard: 360_000 });
    const c = trackRevisionCandidates([e], rows, grades, thresholds, [{ id: 'e1_2026-08_revision', status: 'filed' }]);
    expect(c[0].status).toBe('registered');
  });

  it('対応が残っているのは未対応と届出済みだけ（確認済み・登録済みは出さない）', () => {
    expect(openRevisionCandidates([employee(300_000)], rows, grades, thresholds, [{ id: 'e1_2026-08_revision', status: 'filed' }]).length).toBe(1);
    expect(openRevisionCandidates([employee(300_000)], rows, grades, thresholds, [{ id: 'e1_2026-08_revision', status: 'dismissed' }])).toEqual([]);
  });
});
});

// ---- 漏れていた分岐：候補にならない場合と、注記（カバレッジで見つけた範囲） ----
describe('随時改定：候補にならない場合', () => {
  // 7月 30万円、8〜10月 36万円（34万円＋残業2万円）：健康保険 22等級→25等級で、ふつうなら候補になる形
  const up = salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]);

  it('3か月のうち資格のない月がある（10月1日に資格喪失）', () => {
    expect(findRevisionCandidates(employee(300_000), up, grades, thresholds)).toHaveLength(1);
    const lost = employee(300_000, { qualifications: [{ acquiredDate: '2024-04-01', lostDate: '2026-10-01' }] });
    expect(findRevisionCandidates(lost, up, grades, thresholds)).toEqual([]);
  });

  it('3か月目の時点の標準報酬月額が登録されていない', () => {
    const none = employee(300_000, { standardHistory: [{ validFrom: '2026-11', healthStandard: 300_000, pensionStandard: 300_000 }] });
    expect(findRevisionCandidates(none, up, grades, thresholds)).toEqual([]);
  });

  it('適用見込み月（11月）に使える等級表がない', () => {
    expect(findRevisionCandidates(employee(300_000), up, buildKyokaiGrades('2027-01'), thresholds)).toEqual([]);
  });

  it('今の標準報酬月額が等級表にない額（健康保険・厚生年金のどちらでも）', () => {
    expect(findRevisionCandidates(employee(305_000), up, grades, thresholds)).toEqual([]);
    // 5.8万円は健康保険の1等級だが、厚生年金の等級にはない
    expect(findRevisionCandidates(employee(300_000, {}, 58_000), up, grades, thresholds)).toEqual([]);
  });
});

describe('随時改定：注記', () => {
  it('厚生年金だけが当たるときは要確認（健康保険は等級が変わらない）', () => {
    // 健康保険36万円（25等級）・厚生年金30万円（19等級）の人が、平均36万円になる
    const c = findRevisionCandidates(
      employee(360_000, {}, 300_000),
      salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]),
      grades, thresholds,
    );
    expect(c).toHaveLength(1);
    expect(c[0].health.qualifies).toBe(false);
    expect(c[0].pension!.qualifies).toBe(true);
    expect(c[0].notes).toContain('厚生年金のみ当たる');
    expect(c[0].needsReview).toBe(true);
    expect(c[0].expectedHealth).toBe(360_000); // 健康保険は今のまま
    expect(c[0].expectedPension).toBe(360_000);
  });

  it('「固定的賃金の変動として登録」で内容を空にしたときは、内容なしの注記', () => {
    const c = findRevisionCandidates(
      employee(260_000, { fixedWageChanges: [{ yearMonth: '2026-08', direction: 'up', note: '' }] }),
      salaries([[260_000, 0], [260_000, 60_000], [260_000, 60_000], [260_000, 60_000]]),
      grades, thresholds,
    );
    expect(c[0].notes).toContain('固定的賃金の変動として登録');
  });

  it('変動月そのものが締め日の変更月なら、随時改定の対象外かもしれないので要確認', () => {
    // 8月支払から、末日締め → 15日締め（どちらも翌月払い）。8月は期間が短い月
    const cutoff = (_id: string, ym: string) => (ym >= '2026-08' ? { day: 15 as const, paidIn: 'nextMonth' as const } : { day: 'end' as const, paidIn: 'nextMonth' as const });
    const c = findRevisionCandidates(employee(300_000), salaries([[300_000, 0], [340_000, 20_000], [340_000, 20_000], [340_000, 20_000]]), grades, thresholds, cutoff);
    expect(c[0].changeMonth).toBe('2026-08');
    expect(c[0].needsReview).toBe(true);
    expect(c[0].notes).toContain('変動月が支払月・締め日の変更月（締め日の変更で額が動いただけなら随時改定の対象外）');
  });
});

describe('休業終了時改定：候補にならない場合と注記', () => {
  const leave = { type: 'childcare' as const, startDate: '2025-04-01', endDate: '2026-03-31', workedDays: null };
  const back = salaries([[240_000, 0], [240_000, 0], [240_000, 0, 16]], '2026-04');

  it('休業の終了日が決まっていない', () => {
    expect(findLeaveEndCandidates(employee(260_000, { leaves: [{ ...leave, endDate: null }] }), back, grades)).toEqual([]);
  });

  it('復帰後の3か月に、資格のない月がある・異動がある', () => {
    const lost = employee(260_000, { leaves: [leave], qualifications: [{ acquiredDate: '2024-04-01', lostDate: '2026-06-01' }] });
    expect(findLeaveEndCandidates(lost, back, grades)).toEqual([]);
    const moved = employee(260_000, {
      leaves: [leave],
      assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-05-01', officeId: 'osaka' }],
    });
    expect(findLeaveEndCandidates(moved, back, grades)).toEqual([]);
  });

  it('標準報酬月額が未登録・等級表がない・今の額が等級表にない', () => {
    const none = employee(260_000, { leaves: [leave], standardHistory: [{ validFrom: '2026-07', healthStandard: 260_000, pensionStandard: 260_000 }] });
    expect(findLeaveEndCandidates(none, back, grades)).toEqual([]);
    expect(findLeaveEndCandidates(employee(260_000, { leaves: [leave] }), back, buildKyokaiGrades('2026-08'))).toEqual([]);
    expect(findLeaveEndCandidates(employee(265_000, { leaves: [leave] }), back, grades)).toEqual([]);
    expect(findLeaveEndCandidates(employee(260_000, { leaves: [leave] }, 58_000), back, grades)).toEqual([]);
  });

  it('短時間就労者は、17日以上の月がなければ15日以上の月で平均する。15日未満しかなければ候補にならない', () => {
    const part = { leaves: [leave], insuredTypes: [{ validFrom: '2024-04-01', type: 'partTime' as const }] };
    const c = findLeaveEndCandidates(employee(260_000, part), salaries([[240_000, 0, 16], [240_000, 0, 15], [240_000, 0, 16]], '2026-04'), grades);
    expect(c).toHaveLength(1);
    expect(c[0].notes).toContain('短時間就労者（15日以上17日未満の月で平均）');
    expect(c[0].excludedMonths).toEqual([]);
    expect(findLeaveEndCandidates(employee(260_000, part), salaries([[240_000, 0, 14], [240_000, 0, 14], [240_000, 0, 14]], '2026-04'), grades)).toEqual([]);
    // 一般の被保険者は、17日未満の月だけなら候補にならない（15日以上でも）
    expect(findLeaveEndCandidates(employee(260_000, { leaves: [leave] }), salaries([[240_000, 0, 16], [240_000, 0, 15], [240_000, 0, 16]], '2026-04'), grades)).toEqual([]);
  });

  it('70歳以上の人は厚生年金を判定せず「健康保険のみ」。厚生年金だけが当たるときも要確認', () => {
    const old = findLeaveEndCandidates(employee(260_000, { leaves: [leave], birthDate: '1955-04-10' }), back, grades);
    expect(old[0].pension).toBeNull();
    expect(old[0].notes).toContain('健康保険のみ（70歳以上のため厚生年金は判定しない）');
    expect(old[0].needsReview).toBe(true);
    // 健康保険24万円（等級は変わらない）・厚生年金26万円（1等級下がる）
    const p = findLeaveEndCandidates(employee(240_000, { leaves: [leave] }, 260_000), back, grades);
    expect(p[0].notes).toContain('厚生年金のみ当たる');
    expect(p[0].needsReview).toBe(true);
  });
});
