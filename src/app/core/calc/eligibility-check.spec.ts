import {
  contractLengthMonths, DEFAULT_FULL_TIME, EligibilityInput, EligibilityRule, EMPTY_ELIGIBILITY,
  findEnrollmentPossibilities, judgeEligibility, nextRule, ruleAt, weeklyFromMonthly,
} from './eligibility-check';

const rules: EligibilityRule[] = [
  { validFrom: '2024-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 51, contractMonths: 2, studentExcluded: true },
  { validFrom: '2027-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 36, contractMonths: 2, studentExcluded: true },
  { validFrom: '2035-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: null, contractMonths: 2, studentExcluded: true },
];
const input = (x: Partial<EligibilityInput>): EligibilityInput => ({ ...EMPTY_ELIGIBILITY, weeklyHours: 40, monthlyDays: 20, ...x });
const judge = (x: Partial<EligibilityInput>, date = '2026-10-01') =>
  judgeEligibility(input(x), date, rules, DEFAULT_FULL_TIME)!;

describe('判定の基準', () => {
  it('その日の基準と、次に始まる基準', () => {
    expect(ruleAt(rules, '2026-10-01')!.companySize).toBe(51);
    expect(ruleAt(rules, '2027-10-01')!.companySize).toBe(36);
    expect(nextRule(rules, '2026-10-01')!.validFrom).toBe('2027-10-01');
    expect(ruleAt(rules, '2020-01-01')).toBeNull();
  });

  it('契約期間の長さ（端数の月は1か月に数える）', () => {
    expect(contractLengthMonths('2026-10-01', '2026-11-30')).toBe(2);
    expect(contractLengthMonths('2026-10-15', '2026-12-14')).toBe(2);
    expect(contractLengthMonths('2026-10-15', '2026-12-20')).toBe(3);
    expect(contractLengthMonths('2026-01-31', '2026-03-30')).toBe(2);
  });
});

describe('入社時の判定', () => {
  it('通常の労働者の4分の3以上なら一般の被保険者', () => {
    const r = judge({ weeklyHours: 30, monthlyDays: 15 });
    expect(r.candidate).toBe('general');
    expect(r.insuredType).toBe('general');
    expect(r.reasons[0]).toContain('4分の3以上');
  });

  it('パートで4分の3以上なら、一般の被保険者で区分は短時間就労者', () => {
    const r = judge({ employmentType: 'partTime', weeklyHours: 32, monthlyDays: 18 });
    expect(r.candidate).toBe('general');
    expect(r.insuredType).toBe('partTime');
  });

  it('4分の3未満で週20時間以上なら短時間労働者（特定適用事業所を前提にし、企業規模は判定しない）', () => {
    const r = judge({ employmentType: 'partTime', weeklyHours: 25, monthlyDays: 20 });
    expect(r.candidate).toBe('shortTime');
    expect(r.insuredType).toBe('shortTime');
    expect(r.reasons.at(-1)).toContain('特定適用事業所を前提');
  });

  it('日数が4分の3未満でも、短時間労働者の判定になる', () => {
    expect(judge({ weeklyHours: 30, monthlyDays: 12 }).candidate).toBe('shortTime');
  });

  it('週20時間未満・昼間の学生は加入しない', () => {
    expect(judge({ weeklyHours: 19.5 }).candidate).toBe('none');
    const student = judge({ employmentType: 'arbeit', weeklyHours: 25, isStudent: true });
    expect(student.candidate).toBe('none');
    expect(student.reasons.at(-1)).toContain('学生');
  });

  it('学生でも4分の3以上なら一般の被保険者', () => {
    expect(judge({ employmentType: 'arbeit', weeklyHours: 32, monthlyDays: 16, isStudent: true }).candidate).toBe('general');
  });

  it('2か月以内の期間を定めた雇用で更新の見込みがなければ加入しない（見込みがあれば加入）', () => {
    expect(judge({ contractEnd: '2026-11-30' }).candidate).toBe('none');
    expect(judge({ contractEnd: '2026-11-30', renewalExpected: true }).candidate).toBe('general');
    expect(judge({ contractEnd: '2026-12-31' }).candidate).toBe('general');
  });

  it('役員は一般の被保険者（実態を確かめる）', () => {
    const r = judge({ employmentType: 'officer', weeklyHours: 10, monthlyDays: 5 });
    expect(r.candidate).toBe('general');
    expect(r.reasons[0]).toContain('役員');
  });

  it('時間・日数が入っていなければ判定しない', () => {
    expect(judgeEligibility({ ...EMPTY_ELIGIBILITY, weeklyHours: 30 }, '2026-10-01', rules, DEFAULT_FULL_TIME)).toBeNull();
  });
});

describe('加入の可能性', () => {
  const notInsured = { id: 'p1', qualifications: [] };
  const hours = (ym: string, h: number) => ({ employeeId: 'p1', paidDate: `${ym}-25`, workingHours: h });

  it('月の労働時間を週あたりにする', () => {
    expect(weeklyFromMonthly(86.7)).toBeCloseTo(20.01, 2);
  });

  it('未加入の人が2か月続けて週20時間以上なら、3か月目から加入の可能性', () => {
    const r = findEnrollmentPossibilities([notInsured], [hours('2026-08', 70), hours('2026-09', 90), hours('2026-10', 95)], rules, DEFAULT_FULL_TIME);
    expect(r).toEqual([{ employeeId: 'p1', months: ['2026-09', '2026-10'], weekly: [expect.any(Number), expect.any(Number)], threshold: 20, fromMonth: '2026-11' }]);
  });

  it('1か月だけ・間が空いた月・すでに加入した人は出さない', () => {
    expect(findEnrollmentPossibilities([notInsured], [hours('2026-08', 90), hours('2026-10', 90)], rules, DEFAULT_FULL_TIME)).toEqual([]);
    const insured = { id: 'p1', qualifications: [{ acquiredDate: '2026-11-01', lostDate: null }] };
    expect(findEnrollmentPossibilities([insured], [hours('2026-09', 90), hours('2026-10', 90)], rules, DEFAULT_FULL_TIME)).toEqual([]);
  });

  it('昼間の学生は、通常の労働者の4分の3（週30時間）で比べる', () => {
    const h = [hours('2026-09', 100), hours('2026-10', 100)]; // 週23時間
    const student = { ...notInsured, eligibility: { isStudent: true } };
    expect(findEnrollmentPossibilities([student], h, rules, DEFAULT_FULL_TIME)).toEqual([]);
    const full = [hours('2026-09', 140), hours('2026-10', 140)]; // 週32時間
    expect(findEnrollmentPossibilities([student], full, rules, DEFAULT_FULL_TIME)[0].threshold).toBe(30);
  });
  it('労働時間は働いた月で数える：月末締め・翌月払いなら、5月・6月に払う給与の労働時間は4月・5月分で、6月から加入の可能性', () => {
    const h = [hours('2026-05', 95), hours('2026-06', 95)]; // 支払日は5月・6月
    const nextMonthPay = findEnrollmentPossibilities([notInsured], h, rules, DEFAULT_FULL_TIME, { day: 'end', paidIn: 'nextMonth' });
    expect(nextMonthPay.map((p) => [p.months, p.fromMonth])).toEqual([[['2026-04', '2026-05'], '2026-06']]);
    // 当月締め・当月払いなら、支払月と働いた月は同じ
    const sameMonthPay = findEnrollmentPossibilities([notInsured], h, rules, DEFAULT_FULL_TIME, { day: 'end', paidIn: 'sameMonth' });
    expect(sameMonthPay.map((p) => [p.months, p.fromMonth])).toEqual([[['2026-05', '2026-06'], '2026-07']]);
    // 人ごとの支払区分（関数）でも求める
    const perPerson = findEnrollmentPossibilities([notInsured], h, rules, DEFAULT_FULL_TIME, () => ({ day: 'end', paidIn: 'nextMonth' }));
    expect(perPerson[0].fromMonth).toBe('2026-06');
  });
});

describe('正社員・役員は所定労働時間・日数がなくても判定する', () => {
  const rules = [{ validFrom: '2024-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 51, contractMonths: 2, studentExcluded: true }];
  const base = { employmentType: 'regular' as const, weeklyHours: null, monthlyDays: null, contractEnd: '', renewalExpected: false, isStudent: false };
  it('正社員は空欄なら一般の被保険者。時間を入れた短時間正社員は時間で判定する', () => {
    expect(judgeEligibility(base, '2026-11-01', rules, { weeklyHours: 40, monthlyDays: 20 })?.candidate).toBe('general');
    expect(judgeEligibility({ ...base, weeklyHours: 24, monthlyDays: 15 }, '2026-11-01', rules, { weeklyHours: 40, monthlyDays: 20 })?.candidate).toBe('shortTime');
  });
  it('役員は空欄でも一般の被保険者。パートは空欄なら判定しない', () => {
    expect(judgeEligibility({ ...base, employmentType: 'officer' }, '2026-11-01', rules, { weeklyHours: 40, monthlyDays: 20 })?.candidate).toBe('general');
    expect(judgeEligibility({ ...base, employmentType: 'partTime' }, '2026-11-01', rules, { weeklyHours: 40, monthlyDays: 20 })).toBeNull();
  });
});
