// 随時改定の候補（設計書 2.13・2.14・2.15・3.7）
// 候補はあくまで見込み。担当者が「見込みどおり登録」をするまで、標準報酬月額も保険料も変わらない。
import { isPensionAge } from './age';
import { isInsuredInMonth, Leave, nextDay, Qualification } from './eligibility';
import { findEffective, StandardHistory } from './employee-month';
import { GradeRow, suggestStandards } from './grade-suggest';
import { Assignment } from './office';
import { DEFAULT_CUTOFF, InsuredTypeHistory, minBaseDays, PayrollCutoff, typeForPayMonth } from './insured-type';
import { addMonths, detectFixedWageChanges, payMonths, PayMonth, SalaryRecord } from './salary';

/** 最高等級・最低等級付近の特例の閾値（gradeThresholds。等級表の版・保険ごと） */
export type GradeThreshold = {
  validFrom: string;
  insuranceType: 'health' | 'pension';
  /** 最高等級の番号 */
  maxGrade: number;
  /** 最高等級の上の仮の等級の下限 */
  upper: number;
  /** 最低等級の下の仮の等級の上限 */
  lower: number;
  /** 最高等級の報酬月額の下限 */
  topLower: number;
  /** 2等級の報酬月額の下限 */
  secondLower: number;
};

/** 一般被保険者の支払基礎日数の基準（短時間労働者は11日。insured-type.ts の minBaseDays） */
export const BASE_DAYS_GENERAL = 17;

/** 健康保険・厚生年金それぞれの判定 */
export type SideJudgement = {
  currentStandard: number;
  currentGrade: number;
  newStandard: number;
  newGrade: number;
  /** 等級の差（見込み − 今） */
  diff: number;
  /** 最高・最低等級付近の特例で候補になった */
  special: boolean;
  /** 改定の条件に当たる */
  qualifies: boolean;
};

export type RevisionCandidate = {
  /** revision：随時改定 / leaveEnd：休業終了時改定（本人の申出があれば改定できる） */
  type: 'revision' | 'leaveEnd';
  employeeId: string;
  /** 変動月（変わった固定的賃金を支払った月）。休業終了時改定は、休業終了日の翌日が属する月 */
  changeMonth: string;
  direction: 'up' | 'down';
  /** 変動月から3か月の給与 */
  months: PayMonth[];
  /** 3か月の報酬の平均（円未満切り捨て） */
  average: number;
  /** 適用見込み月（変動月から4か月目） */
  expectedFrom: string;
  /** 休業終了時改定で、適用される最終月（1〜6月改定は当年8月、7〜12月改定は翌年8月）。随時改定は null */
  expectedUntil: string | null;
  /** 3か月のうち、支払基礎日数が足りず平均から除いた月（休業終了時改定だけ） */
  excludedMonths: string[];
  health: SideJudgement;
  /** 70歳以上の人は厚生年金を判定しない（null） */
  pension: SideJudgement | null;
  /** 片方だけ当たる・70歳以上など、担当者の確認が要る */
  needsReview: boolean;
  notes: string[];
  /** 見込みどおりに登録する値（当たらない側は今の値） */
  expectedHealth: number;
  expectedPension: number;
  /** 適用見込み月の標準報酬月額の履歴がすでにある */
  registered: boolean;
};

export type RevisionEmployee = {
  id: string;
  birthDate: string;
  qualifications: Qualification[];
  assignments: Assignment[];
  standardHistory: StandardHistory[];
  insuredTypes?: InsuredTypeHistory[];
  leaves?: Leave[];
};

function tableAt(grades: GradeRow[], ym: string): GradeRow[] {
  const v = grades.map((g) => g.validFrom).filter((x) => x <= ym).sort().at(-1);
  return v ? grades.filter((g) => g.validFrom === v) : [];
}

function judge(
  type: 'health' | 'pension',
  currentStandard: number,
  newGrade: number,
  newStandard: number,
  table: GradeRow[],
  t: GradeThreshold | null,
  direction: 'up' | 'down',
  average: number,
  previousRemuneration: number | null,
): SideJudgement | null {
  const row = table.find(
    (g) => g.standardAmount === currentStandard && (type === 'health' || g.pensionGrade !== null),
  );
  if (!row) return null;
  const currentGrade = type === 'health' ? row.healthGrade : row.pensionGrade!;
  const diff = newGrade - currentGrade;
  const normal = direction === 'up' ? diff >= 2 : diff <= -2;
  let special = false;
  if (!normal && t) {
    special =
      direction === 'up'
        ? (currentGrade === t.maxGrade - 1 && average >= t.upper) ||
          (currentGrade === 1 && previousRemuneration !== null && previousRemuneration < t.lower && average >= t.secondLower)
        : (currentGrade === t.maxGrade && previousRemuneration !== null && previousRemuneration >= t.upper && average < t.topLower) ||
          (currentGrade === 2 && average < t.lower);
  }
  return { currentStandard, currentGrade, newStandard, newGrade, diff, special, qualifies: normal || special };
}

/**
 * 1人分の随時改定の候補（健康保険・厚生年金のどちらかが条件に当たるもの）
 *
 * - 固定的賃金（遡及差額を除く）が前月から変わった支払月を変動月とする
 * - 変動月から3か月とも、給与があり、支払基礎日数が17日以上、資格がある
 * - 3か月の平均で求めた等級と今の等級に2等級以上の差（最高・最低等級付近は特例）があり、変動の向きと一致する
 * - 3か月の途中で異動した人は判定しない（異動先で決め直すため）
 */
export function findRevisionCandidates(
  employee: RevisionEmployee,
  salaries: SalaryRecord[],
  grades: GradeRow[],
  thresholds: GradeThreshold[],
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): RevisionCandidate[] {
  const months = payMonths(salaries.filter((s) => s.employeeId === employee.id));
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  const transfers = [...employee.assignments].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).slice(1);

  return detectFixedWageChanges(months).flatMap((change) => {
    const yms = [0, 1, 2].map((i) => addMonths(change.yearMonth, i));
    const three = yms.map((ym) => byMonth.get(ym));
    // 支払基礎日数の基準は、各月の締め日時点の被保険者区分で選ぶ（短時間労働者は11日、ほかは17日）
    const types = yms.map((ym) => typeForPayMonth(employee.insuredTypes, ym, cutoff));
    if (three.some((m, i) => !m || m.days < minBaseDays(types[i]))) return [];
    if (yms.some((ym) => !isInsuredInMonth(employee.qualifications, ym))) return [];
    if (transfers.some((a) => yms.includes(a.validFrom.slice(0, 7)))) return [];

    const expectedFrom = addMonths(change.yearMonth, 3);
    const current = findEffective(employee.standardHistory, yms[2]);
    if (!current) return [];
    const table = tableAt(grades, expectedFrom);
    const total = three.reduce((s, m) => s + m!.total, 0);
    const average = Math.floor(total / 3);
    const suggestion = suggestStandards(average, grades, expectedFrom, '');
    if (!suggestion || table.length === 0) return [];

    const thresholdOf = (type: 'health' | 'pension') =>
      findEffective(thresholds.filter((t) => t.insuranceType === type), expectedFrom);
    const prevRem = current.remuneration ?? null;
    const health = judge(
      'health', current.healthStandard, suggestion.healthGrade, suggestion.healthStandard,
      table, thresholdOf('health'), change.direction, average, prevRem,
    );
    if (!health) return [];
    // 3か月の途中で70歳になる人も、厚生年金は判定しない
    const pensionJudged = employee.birthDate !== '' && isPensionAge(employee.birthDate, yms[2]);
    const pension = pensionJudged
      ? judge(
          'pension', current.pensionStandard, suggestion.pensionGrade, suggestion.pensionStandard,
          table, thresholdOf('pension'), change.direction, average, prevRem,
        )
      : null;
    if (pensionJudged && !pension) return [];
    if (!health.qualifies && !pension?.qualifies) return [];

    const notes: string[] = [];
    let needsReview = false;
    if (types.includes('specialReduction')) {
      needsReview = true;
      notes.push('特定減額特例対象者（自動では判定しないため、内容を確かめる）');
    }
    const before = typeForPayMonth(employee.insuredTypes, addMonths(change.yearMonth, -1), cutoff);
    if (types.some((t) => t !== before)) notes.push('区分変更あり（備考欄に記入）');
    if (!pensionJudged) {
      needsReview = true;
      notes.push('健康保険のみ（70歳以上のため厚生年金は判定しない。70歳以上被用者の月額変更届も必要）');
    } else if (health.qualifies !== pension!.qualifies) {
      needsReview = true;
      notes.push(health.qualifies ? '健康保険のみ当たる' : '厚生年金のみ当たる');
    }
    if (health.special || pension?.special) notes.push('最高・最低等級付近の特例');
    if (three.some((m) => m!.retroactive > 0)) notes.push('遡及差額を除いて平均');

    return [
      {
        type: 'revision' as const,
        employeeId: employee.id,
        changeMonth: change.yearMonth,
        direction: change.direction,
        months: three as PayMonth[],
        average,
        expectedFrom,
        expectedUntil: null,
        excludedMonths: [],
        health,
        pension,
        needsReview,
        notes,
        expectedHealth: health.qualifies ? health.newStandard : health.currentStandard,
        expectedPension: pension?.qualifies ? pension.newStandard : current.pensionStandard,
        registered: employee.standardHistory.some((h) => h.validFrom === expectedFrom),
      },
    ];
  });
}

/**
 * 休業終了時改定の候補（設計書 2.17）
 *
 * - 産前産後休業・育児休業の終了日の翌日が属する月から3か月分の給与がそろった人
 * - 支払基礎日数が基準以上の月が1か月以上あること（基準未満の月は平均から除く）
 * - 平均で求めた等級と今の等級に1等級以上の差がある（上がる場合も下がる場合も）
 * - 産休に続けて育休を取った場合は、産休の終了時には判定しない（育休の終了時に判定する）
 * - 本人の申出があるときだけ届け出るので、「申出により改定可能」として出す
 */
export function findLeaveEndCandidates(
  employee: RevisionEmployee,
  salaries: SalaryRecord[],
  grades: GradeRow[],
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): RevisionCandidate[] {
  const leaves = employee.leaves ?? [];
  const byMonth = new Map(payMonths(salaries.filter((s) => s.employeeId === employee.id)).map((m) => [m.yearMonth, m]));
  const transfers = [...employee.assignments].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).slice(1);

  return leaves.flatMap((leave) => {
    if (!leave.endDate) return [];
    const resume = nextDay(leave.endDate);
    // 続けて別の休業を取った（産休→育休など）なら、この休業の終了時には判定しない
    if (leaves.some((l) => l !== leave && l.startDate <= resume && l.startDate > leave.startDate)) return [];
    const start = resume.slice(0, 7);
    const yms = [0, 1, 2].map((i) => addMonths(start, i));
    const three = yms.map((ym) => byMonth.get(ym));
    if (three.some((m) => !m)) return [];
    if (yms.some((ym) => !isInsuredInMonth(employee.qualifications, ym))) return [];
    if (transfers.some((a) => yms.includes(a.validFrom.slice(0, 7)))) return [];

    const types = yms.map((ym) => typeForPayMonth(employee.insuredTypes, ym, cutoff));
    let used = three.filter((m, i) => m!.days >= minBaseDays(types[i])) as PayMonth[];
    const notes: string[] = ['申出により改定可能'];
    if (used.length === 0) {
      // 短時間就労者は、17日以上の月がなければ15日以上17日未満の月で平均する
      used = three.filter((m, i) => types[i] === 'partTime' && m!.days >= 15) as PayMonth[];
      if (used.length === 0) return [];
      notes.push('短時間就労者（15日以上17日未満の月で平均）');
    }
    const excludedMonths = (three as PayMonth[]).filter((m) => !used.includes(m)).map((m) => m.yearMonth);

    const expectedFrom = addMonths(start, 3);
    const current = findEffective(employee.standardHistory, yms[2]);
    if (!current) return [];
    const table = tableAt(grades, expectedFrom);
    const average = Math.floor(used.reduce((t, m) => t + m.total, 0) / used.length);
    const s = suggestStandards(average, grades, expectedFrom, '');
    if (!s || table.length === 0) return [];

    const side = (type: 'health' | 'pension', currentStandard: number, newGrade: number, newStandard: number): SideJudgement | null => {
      const row = table.find((g) => g.standardAmount === currentStandard && (type === 'health' || g.pensionGrade !== null));
      if (!row) return null;
      const currentGrade = type === 'health' ? row.healthGrade : row.pensionGrade!;
      const diff = newGrade - currentGrade;
      return { currentStandard, currentGrade, newStandard, newGrade, diff, special: false, qualifies: diff !== 0 };
    };
    const health = side('health', current.healthStandard, s.healthGrade, s.healthStandard);
    if (!health) return [];
    const pensionJudged = employee.birthDate === '' || isPensionAge(employee.birthDate, yms[2]);
    const pension = pensionJudged ? side('pension', current.pensionStandard, s.pensionGrade, s.pensionStandard) : null;
    if (pensionJudged && !pension) return [];
    if (!health.qualifies && !pension?.qualifies) return [];

    let needsReview = false;
    if (!pensionJudged) {
      needsReview = true;
      notes.push('健康保険のみ（70歳以上のため厚生年金は判定しない）');
    } else if (health.qualifies !== pension!.qualifies) {
      needsReview = true;
      notes.push(health.qualifies ? '健康保険のみ当たる' : '厚生年金のみ当たる');
    }
    if (excludedMonths.length > 0) notes.push(`支払基礎日数が足りない月を除いて平均（${excludedMonths.join('・')}）`);
    if (types.includes('specialReduction')) {
      needsReview = true;
      notes.push('特定減額特例対象者（自動では判定しないため、内容を確かめる）');
    }
    const fromMonth = Number(expectedFrom.slice(5));
    const fromYear = Number(expectedFrom.slice(0, 4));
    const expectedUntil = `${fromMonth <= 6 ? fromYear : fromYear + 1}-08`;

    return [
      {
        type: 'leaveEnd' as const,
        employeeId: employee.id,
        changeMonth: start,
        direction: health.diff < 0 || (!health.qualifies && pension!.diff < 0) ? ('down' as const) : ('up' as const),
        months: three as PayMonth[],
        average,
        expectedFrom,
        expectedUntil,
        excludedMonths,
        health,
        pension,
        needsReview,
        notes,
        expectedHealth: health.qualifies ? health.newStandard : health.currentStandard,
        expectedPension: pension?.qualifies ? pension.newStandard : current.pensionStandard,
        registered: employee.standardHistory.some((h) => h.validFrom === expectedFrom),
      },
    ];
  });
}

/**
 * 候補の対応状況（設計書 2.13 候補の対応状況）
 * - open：未対応（候補に出た） / filed：届出済み（決定通知書を待っている）
 * - registered：登録済み（適用見込み月の標準報酬月額を登録した。履歴から自動で決まる）
 * - dismissed：確認済み（届出が不要だった、見込みと違う月で対応した、など）
 */
export type CandidateStatus = 'open' | 'filed' | 'registered' | 'dismissed';

/** revisionCandidates に保存する、担当者が切り替えた状態 */
export type CandidateStatusRecord = { id: string; status: 'open' | 'filed' | 'dismissed' };

export type TrackedCandidate = RevisionCandidate & { id: string; status: CandidateStatus };

/** 候補を見分けるID（同じ人・同じ変動月の随時改定は1件） */
export function candidateId(c: Pick<RevisionCandidate, 'employeeId' | 'changeMonth' | 'type'>): string {
  return `${c.employeeId}_${c.changeMonth}_${c.type}`;
}

/** 全員分の候補に、対応状況を付ける（登録済みは履歴で決まり、保存した状態より優先する） */
export function trackRevisionCandidates(
  employees: RevisionEmployee[],
  salaries: SalaryRecord[],
  grades: GradeRow[],
  thresholds: GradeThreshold[],
  statuses: CandidateStatusRecord[] = [],
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): TrackedCandidate[] {
  const saved = new Map(statuses.map((s) => [s.id, s.status]));
  return employees
    .flatMap((e) => [
      ...findRevisionCandidates(e, salaries, grades, thresholds, cutoff),
      ...findLeaveEndCandidates(e, salaries, grades, cutoff),
    ])
    .map((c) => {
      const id = candidateId(c);
      const status: CandidateStatus = c.registered ? 'registered' : (saved.get(id) ?? 'open');
      return { ...c, id, status };
    })
    .sort((a, b) => b.expectedFrom.localeCompare(a.expectedFrom));
}

/** 対応が残っている候補（未対応・届出済み）。要確認アラートと候補一覧に出す */
export function openRevisionCandidates(
  employees: RevisionEmployee[],
  salaries: SalaryRecord[],
  grades: GradeRow[],
  thresholds: GradeThreshold[],
  statuses: CandidateStatusRecord[] = [],
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): TrackedCandidate[] {
  return trackRevisionCandidates(employees, salaries, grades, thresholds, statuses, cutoff).filter(
    (c) => c.status === 'open' || c.status === 'filed',
  );
}
