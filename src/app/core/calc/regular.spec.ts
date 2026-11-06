import { buildKyokaiGrades, buildKyokaiThresholds } from './grade-suggest';
import { estimateRegular, estimateRegularAll, matchesRegularStatus, RegularEmployee, registrableRegular } from './regular';
import { SalaryRecord } from './salary';

const grades = buildKyokaiGrades('2020-09');
const thresholds = buildKyokaiThresholds('2020-09');

function employee(over: Partial<RegularEmployee> = {}): RegularEmployee {
  return {
    id: 'e1',
    birthDate: '1980-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
    leaves: [],
    ...over,
  };
}

/** [支払月, 固定的賃金, 非固定的賃金, 支払基礎日数] */
function pay(rows: [string, number, number, number?][], employeeId = 'e1'): SalaryRecord[] {
  return rows.map(([ym, fixed, nonFixed, days = 30]) => ({
    id: `${employeeId}_${ym}`, employeeId, paidDate: `${ym}-25`, fixedWages: fixed, nonFixedWages: nonFixed,
    paymentBaseDays: days, retroactiveDiff: null, inKindWages: null,
  }));
}

const AMJ = (fixed: number, nonFixed: number[]): [string, number, number][] =>
  ['2026-04', '2026-05', '2026-06'].map((ym, i) => [ym, fixed, nonFixed[i]]);

describe('estimateRegular（定時決定の見込み）', () => {
  it('4〜6月の平均から9月分からの等級を見込む', () => {
    const r = estimateRegular(employee(), pay(AMJ(300_000, [20_000, 30_000, 40_000])), grades, thresholds, 2026)!;
    expect(r.average).toBe(330_000);
    expect(r.health).toEqual({ currentStandard: 300_000, currentGrade: 22, newStandard: 340_000, newGrade: 24 });
    expect(r.pension!.newStandard).toBe(340_000);
    expect(r.expectedHealth).toBe(340_000);
    expect(r.months.every((m) => m.used)).toBe(true);
    expect(r.registered).toBe(false);
  });

  it('年4回以上支給する賞与（報酬扱い）は、前年7月〜当年6月の合計 ÷ 12 を上乗せする（48万円 → 4万円で34万円）', () => {
    const bonuses = ['2025-07-10', '2025-10-10', '2026-01-10', '2026-04-10'].map((paidDate) => ({ employeeId: 'e1', paidDate, amount: 120_000, isRemuneration: true }));
    const [r] = estimateRegularAll([employee()], pay(AMJ(300_000, [0, 0, 0])), grades, thresholds, 2026, undefined, bonuses);
    expect(r.average).toBe(340_000);
    expect(r.expectedHealth).toBe(340_000);
    expect(r.notes).toContain('年4回以上の賞与を上乗せ（480,000円 ÷ 12 ＝ 40,000円）');
  });

  it('等級が変わらない人も一覧に出す（全員の標準報酬月額を決め直すため）', () => {
    const r = estimateRegular(employee(), pay(AMJ(300_000, [0, 0, 0])), grades, thresholds, 2026)!;
    expect(r.health!.newGrade).toBe(r.health!.currentGrade);
  });

  it('支払基礎日数が17日未満の月は平均から除く', () => {
    const rows = pay([['2026-04', 300_000, 0], ['2026-05', 150_000, 0, 10], ['2026-06', 300_000, 0]]);
    const r = estimateRegular(employee(), rows, grades, thresholds, 2026)!;
    expect(r.months[1]).toMatchObject({ used: false, excludedReason: '支払基礎日数が17日未満' });
    expect(r.average).toBe(300_000);
  });

  it('6月1日以降に資格を取った人は対象外、5月の途中で取った人はその月を除いて「途中入社」', () => {
    expect(estimateRegular(employee({ qualifications: [{ acquiredDate: '2026-06-01', lostDate: null }] }), pay(AMJ(300_000, [0, 0, 0])), grades, thresholds, 2026)).toBeNull();
    const r = estimateRegular(
      employee({ qualifications: [{ acquiredDate: '2026-05-15', lostDate: null }], standardHistory: [{ validFrom: '2026-05', healthStandard: 300_000, pensionStandard: 300_000 }] }),
      pay([['2026-05', 150_000, 0, 17], ['2026-06', 320_000, 0]]),
      grades, thresholds, 2026,
    )!;
    expect(r.months.map((m) => m.excludedReason)).toEqual(['資格のない月', '月の途中で資格を取った月', null]);
    expect(r.average).toBe(320_000);
    expect(r.notes).toContain('途中入社');
  });

  it('平均に使える月がなければ、従前の標準報酬月額のまま', () => {
    const r = estimateRegular(employee({ leaves: [{ type: 'childcare', startDate: '2026-03-01', endDate: null, workedDays: null }] }), [], grades, thresholds, 2026)!;
    expect(r.average).toBeNull();
    expect(r.months[0].excludedReason).toBe('休業中（給与なし）');
    expect(r.expectedHealth).toBe(300_000);
    expect(registrableRegular([r])).toEqual([]);
  });

  it('報酬が大きく下がった月がある人は要確認', () => {
    const r = estimateRegular(employee(), pay([['2026-04', 300_000, 0], ['2026-05', 200_000, 0], ['2026-06', 300_000, 0]]), grades, thresholds, 2026)!;
    expect(r.needsReview).toBe(true);
  });

  it('締め日を遅らせて暦日を超えた月は、算定から除く額を入れると、それを除いて平均する', () => {
    // 5月の給与から、20日締め→25日締め（5月は36日分で、30万円＋5日分の5万円）
    const cutoff = (_id: string, ym: string) => (ym >= '2026-05' ? { day: 25 as const, paidIn: 'nextMonth' as const } : { day: 20 as const, paidIn: 'nextMonth' as const });
    const rows = pay([['2026-04', 300_000, 0], ['2026-05', 350_000, 0, 31], ['2026-06', 300_000, 0]]);
    const before = estimateRegular(employee(), rows, grades, thresholds, 2026, cutoff)!;
    expect(before.needsReview).toBe(true);
    expect(before.notes.join()).toContain('「算定から除く額」に入れる');
    expect(before.notes.join()).toContain('5月の算定から除く額が未入力');
    // 0円と入れたら（除く額がない）、担当者の判断として要確認を外す
    rows[1].excludedAmount = 0;
    expect(estimateRegular(employee(), rows, grades, thresholds, 2026, cutoff)!.notes.join()).not.toContain('未入力');
    rows[1].excludedAmount = 50_000;
    const after = estimateRegular(employee(), rows, grades, thresholds, 2026, cutoff)!;
    expect(after.average).toBe(300_000);
    expect(after.needsReview).toBe(false);
    expect(after.notes.join()).toContain('50,000円を除いて平均');
  });

  it('当月払い→翌月払いに変えた月は、平均から除く', () => {
    const cutoff = (_id: string, ym: string) => ({ day: 'end' as const, paidIn: ym >= '2026-05' ? ('nextMonth' as const) : ('sameMonth' as const) });
    const r = estimateRegular(employee(), pay([['2026-04', 300_000, 0], ['2026-05', 100_000, 0], ['2026-06', 300_000, 0]]), grades, thresholds, 2026, cutoff)!;
    expect(r.months[1]).toMatchObject({ used: false, excludedReason: '支払月の変更月（当月払い→翌月払い）' });
    expect(r.average).toBe(300_000);
    expect(r.needsReview).toBe(false);
  });

  it('一時帰休の月がある人は要確認。7月1日に続いているかで扱いを分けて出す', () => {
    const rows = pay(AMJ(300_000, [0, 0, 0]));
    const ongoing = estimateRegular(employee({ absences: [{ reason: 'furlough', startDate: '2026-05-01', endDate: null }] }), rows, grades, thresholds, 2026)!;
    expect(ongoing.needsReview).toBe(true);
    expect(ongoing.notes).toContain('一時帰休の月あり（5月・6月）。7月1日に一時帰休が続いているため、休業手当を含めて算定する');
    const ended = estimateRegular(employee({ absences: [{ reason: 'furlough', startDate: '2026-05-01', endDate: '2026-05-31' }] }), rows, grades, thresholds, 2026)!;
    expect(ended.notes.join()).toContain('5月）。7月1日には解消しているため、休業手当を受けた月を除いて算定するか確かめる');
    // 一時帰休は「休職の期間にかかる月」と二重に出さない
    expect(ended.notes.join()).not.toContain('休職の期間にかかる月');
  });

  it('休職の期間にかかる月がある人は要確認（報酬が下がっていなくても）', () => {
    const e = employee({ absences: [{ reason: 'sickness', startDate: '2026-05-20', endDate: '2026-06-10' }] });
    const r = estimateRegular(e, pay(AMJ(300_000, [0, 0, 0])), grades, thresholds, 2026)!;
    expect(r.needsReview).toBe(true);
    expect(r.notes).toContain('休職の期間にかかる月あり（5月・6月。報酬が大きく下がっていれば平均から除くか確認）');
  });

  it('7〜9月に随時改定がある人は印を付け、一括登録の対象にしない', () => {
    // 4月に昇給し、4〜6月がそろって7月分から随時改定の見込み
    const rows = pay([['2026-03', 260_000, 0], ...AMJ(360_000, [0, 0, 0])]);
    const e = employee({ standardHistory: [{ validFrom: '2024-04', healthStandard: 260_000, pensionStandard: 260_000 }] });
    const r = estimateRegular(e, rows, grades, thresholds, 2026)!;
    expect(r.revisionInJulSep).toBe(true);
    expect(r.notes[0]).toContain('定時決定の対象外');
    expect(registrableRegular([r])).toEqual([]);
  });

  it('4〜6月だけ報酬が高い人は、年間平均の特例の候補', () => {
    const rows: [string, number, number][] = [];
    for (let i = 0; i < 12; i++) {
      const ym = i < 6 ? `2025-${String(7 + i).padStart(2, '0')}` : `2026-${String(i - 5).padStart(2, '0')}`;
      const busy = ['2026-04', '2026-05', '2026-06'].includes(ym);
      rows.push([ym, 300_000, busy ? 200_000 : 0]);
    }
    const r = estimateRegular(employee(), pay(rows), grades, thresholds, 2026)!;
    expect(r.annualAverageCandidate).toBe(true);
    expect(r.notes.some((n) => n.startsWith('年間平均の特例の候補'))).toBe(true);
  });

  it('70歳以上の人は厚生年金を見込まない', () => {
    const r = estimateRegular(employee({ birthDate: '1955-01-15' }), pay(AMJ(340_000, [0, 0, 0])), grades, thresholds, 2026)!;
    expect(r.pension).toBeNull();
    expect(r.notes).toContain('70歳以上被用者');
    expect(r.expectedPension).toBe(300_000);
  });

  it('9月分からの履歴があれば登録済み。一括登録は未登録の人だけ', () => {
    const e = employee();
    e.standardHistory.push({ validFrom: '2026-09', healthStandard: 340_000, pensionStandard: 340_000 });
    const list = estimateRegularAll(
      [e, employee({ id: 'e2' })],
      [...pay(AMJ(300_000, [20_000, 30_000, 40_000])), ...pay(AMJ(300_000, [0, 0, 0]), 'e2')],
      grades, thresholds, 2026,
    );
    expect(list.map((r) => r.registered)).toEqual([true, false]);
    expect(registrableRegular(list).map((r) => r.employeeId)).toEqual(['e2']);
  });

  it('短時間就労者は、17日以上の月がなければ15日以上17日未満の月で平均する', () => {
    const e = employee({ insuredTypes: [{ validFrom: '2024-04-01', type: 'partTime' }] });
    const rows = pay([['2026-04', 120_000, 0, 16], ['2026-05', 110_000, 0, 15], ['2026-06', 50_000, 0, 8]]);
    const r = estimateRegular(e, rows, grades, thresholds, 2026)!;
    expect(r.months.map((m) => m.used)).toEqual([true, true, false]);
    expect(r.average).toBe(115_000);
    expect(r.notes).toContain('短時間就労者（15日以上17日未満の月で平均）');
    // 一般被保険者なら使える月がない
    expect(estimateRegular(employee(), rows, grades, thresholds, 2026)!.average).toBeNull();
  });

  it('短時間労働者は11日以上の月で平均する', () => {
    const e = employee({ insuredTypes: [{ validFrom: '2024-04-01', type: 'shortTime' }] });
    const r = estimateRegular(e, pay([['2026-04', 100_000, 0, 12], ['2026-05', 100_000, 0, 10], ['2026-06', 120_000, 0, 11]]), grades, thresholds, 2026)!;
    expect(r.months.map((m) => m.excludedReason)).toEqual([null, '支払基礎日数が11日未満', null]);
    expect(r.average).toBe(110_000);
  });

  it('特定減額特例対象者も短時間労働者と同じく11日以上の月で平均する（11〜16日の月を除かない）。内容の確認を求める', () => {
    const e = employee({ insuredTypes: [{ validFrom: '2024-04-01', type: 'specialReduction' }] });
    const r = estimateRegular(e, pay([['2026-04', 80_000, 0, 12], ['2026-05', 80_000, 0, 10], ['2026-06', 84_000, 0, 16]]), grades, thresholds, 2026)!;
    expect(r.months.map((m) => m.excludedReason)).toEqual([null, '支払基礎日数が11日未満', null]);
    expect(r.average).toBe(82_000);
    expect(r.needsReview).toBe(true);
    expect(r.notes.some((n) => n.startsWith('特定減額特例対象者'))).toBe(true);
  });
});

describe('定時決定の一覧の絞り込み', () => {
  const side = (current: number, next: number) => ({ currentStandard: current, newStandard: next, currentGrade: null, newGrade: 1 });
  const base = { health: side(300_000, 300_000), pension: side(300_000, 300_000), needsReview: false, annualAverageCandidate: false, registered: false, revisionInJulSep: false };

  it('等級が変わる人：健康保険か厚生年金のどちらかが変わる', () => {
    expect(matchesRegularStatus(base, 'changed')).toBe(false);
    expect(matchesRegularStatus({ ...base, pension: side(300_000, 320_000) }, 'changed')).toBe(true);
    expect(matchesRegularStatus({ ...base, pension: null }, 'changed')).toBe(false);
  });

  it('要確認・年間平均の特例の候補、まだ登録していない人、対象外の人', () => {
    expect(matchesRegularStatus({ ...base, annualAverageCandidate: true }, 'review')).toBe(true);
    expect(matchesRegularStatus({ ...base, registered: true }, 'unregistered')).toBe(false);
    expect(matchesRegularStatus({ ...base, revisionInJulSep: true }, 'unregistered')).toBe(false);
    expect(matchesRegularStatus({ ...base, revisionInJulSep: true }, 'excluded')).toBe(true);
    expect(matchesRegularStatus(base, '')).toBe(true);
  });
});
