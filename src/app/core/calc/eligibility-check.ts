// 加入対象の判定の補助（設計書 2.24）
// 入社時の候補（一般の被保険者／短時間労働者／加入しない）を理由つきで示す。最終判断は担当者が行う。
// あわせて、未加入の人の実際の労働時間から「加入の可能性」を、厚生年金の被保険者数から企業規模の基準を見る。
import { isPensionAge } from './age';
import { isInsuredInMonth, Qualification } from './eligibility';
import type { InsuredType } from './insured-type';
import { addMonths } from './salary';
import { CutoffArg, payPeriodEnd, resolveCutoff } from './insured-type';

/** 判定の基準（システム共通マスタ eligibilityRules。改正に合わせて運営者が更新する） */
export type EligibilityRule = {
  /** 適用開始日 'YYYY-MM-DD' */
  validFrom: string;
  /** 一般の被保険者になる所定労働時間・日数の割合（千分率。4分の3 → 750） */
  fullTimeRatio: number;
  /** 短時間労働者の週の所定労働時間の下限 */
  weeklyHours: number;
  /** 短時間労働者の適用の企業規模（厚生年金の被保険者数）の下限。撤廃後は null。アプリは特定適用事業所での使用を前提にするため、判定には使わない（マスタの記録として持つ） */
  companySize: number | null;
  /** 期間を定めた雇用で加入しない期間（2か月以内 → 2） */
  contractMonths: number;
  /** 昼間の学生を短時間労働者の対象外とするか */
  studentExcluded: boolean;
};

export type EmploymentType = 'regular' | 'contract' | 'partTime' | 'arbeit' | 'officer';

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  regular: '正社員',
  contract: '契約社員',
  partTime: 'パート',
  arbeit: 'アルバイト',
  officer: '役員',
};

/** 通常の労働者（正社員）の所定労働時間・日数（会社の設定） */
export type FullTimeStandard = { weeklyHours: number; monthlyDays: number };

export const DEFAULT_FULL_TIME: FullTimeStandard = { weeklyHours: 40, monthlyDays: 20 };

/** 入社時の判定の入力（employees.eligibility に、候補・理由と一緒に保存する） */
export type EligibilityInput = {
  employmentType: EmploymentType;
  /** 週の所定労働時間 */
  weeklyHours: number | null;
  /** 月の所定労働日数 */
  monthlyDays: number | null;
  /** 期間を定めた雇用の契約の終わり（期間の定めがなければ空） */
  contractEnd: string;
  /** 契約を更新する見込みがある（更新の予定・同じ条件で更新した実績など） */
  renewalExpected: boolean;
  /** 昼間の学生（定時制・通信制・休学中・卒業後も引き続き働く予定の人は除く） */
  isStudent: boolean;
};

export const EMPTY_ELIGIBILITY: EligibilityInput = {
  employmentType: 'regular',
  weeklyHours: null,
  monthlyDays: null,
  contractEnd: '',
  renewalExpected: false,
  isStudent: false,
};

export type EligibilityCandidate = 'general' | 'shortTime' | 'none';

/** 保存する判定（入力と、示した候補・理由） */
export type StoredEligibility = EligibilityInput & {
  candidate: EligibilityCandidate;
  reasons: string[];
  /** 契約が変わって判定し直した日（入社時の判定のままなら無い） */
  changedDate?: string | null;
};

export const CANDIDATE_LABEL: Record<EligibilityCandidate, string> = {
  general: '一般の被保険者',
  shortTime: '短時間労働者',
  none: '加入しない',
};

export type EligibilityResult = {
  candidate: EligibilityCandidate;
  reasons: string[];
  /** 候補どおりにするときの被保険者区分（加入しないときは null） */
  insuredType: InsuredType | null;
};

/** その日に使う基準（validFrom がその日以前で最新のもの） */
export function ruleAt(rules: EligibilityRule[], date: string): EligibilityRule | null {
  return [...rules].filter((r) => r.validFrom <= date).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

/** 次に始まる基準（なければ null） */
export function nextRule(rules: EligibilityRule[], date: string): EligibilityRule | null {
  return [...rules].filter((r) => r.validFrom > date).sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0] ?? null;
}

/** 入社日から契約の終わりまでの長さ（月。端数の月は1か月に数える。10/15〜12/14は2か月、10/15〜12/20は3か月） */
export function contractLengthMonths(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  // 終わりの翌日までの月数を数える
  const next = new Date(Date.UTC(y2, m2 - 1, d2 + 1));
  const months = (next.getUTCFullYear() - y1) * 12 + (next.getUTCMonth() + 1 - m1);
  return next.getUTCDate() > d1 ? months + 1 : months;
}

const hours = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

/**
 * 入社時の候補を出す。入力が足りなければ null
 *
 * @param input 判定の入力
 * @param hireDate 入社日（契約期間の長さに使う）
 * @param rules 判定の基準
 * @param fullTime 通常の労働者の所定労働時間・日数
 */
export function judgeEligibility(
  input: EligibilityInput,
  hireDate: string,
  rules: EligibilityRule[],
  fullTime: FullTimeStandard,
): EligibilityResult | null {
  const rule = ruleAt(rules, hireDate);
  if (!rule) return null;
  const reasons: string[] = [];
  const part = input.employmentType === 'partTime' || input.employmentType === 'arbeit';

  // 役員は所定労働時間で判定しない
  if (input.employmentType === 'officer' && !(input.contractEnd && !input.renewalExpected)) {
    reasons.push('法人の役員で、常勤として報酬を受ける人は一般の被保険者（非常勤は勤務の実態で判断する）');
    return { candidate: 'general', reasons, insuredType: 'general' };
  }
  // 正社員は通常の労働者そのものなので、所定労働時間・日数を入れなくても一般の被保険者。
  // 所定労働時間が短い正社員（短時間正社員）は、時間と日数を入れて判定する
  if (input.employmentType === 'regular' && input.weeklyHours === null && input.monthlyDays === null && !input.contractEnd) {
    reasons.push('正社員は通常の労働者のため一般の被保険者（所定労働時間が短い正社員は、時間と日数を入れて判定する）');
    return { candidate: 'general', reasons, insuredType: 'general' };
  }
  if (input.weeklyHours === null || input.monthlyDays === null) return null;

  // 2か月以内の期間を定めた雇用で、更新の見込みがない
  if (input.contractEnd && !input.renewalExpected && contractLengthMonths(hireDate, input.contractEnd) <= rule.contractMonths) {
    reasons.push(
      `${rule.contractMonths}か月以内の期間を定めた雇用で、更新の見込みがない（期間を超えて使用されたら、その日から加入）`,
    );
    return { candidate: 'none', reasons, insuredType: null };
  }

  if (input.employmentType === 'officer') {
    reasons.push('法人の役員で、常勤として報酬を受ける人は一般の被保険者（非常勤は勤務の実態で判断する）');
    return { candidate: 'general', reasons, insuredType: 'general' };
  }

  const ratio = rule.fullTimeRatio / 1000;
  const minHours = fullTime.weeklyHours * ratio;
  const minDays = fullTime.monthlyDays * ratio;
  const hoursOk = input.weeklyHours >= minHours;
  const daysOk = input.monthlyDays >= minDays;
  if (hoursOk && daysOk) {
    reasons.push(
      `週${hours(input.weeklyHours)}時間・月${hours(input.monthlyDays)}日で、通常の労働者（週${hours(fullTime.weeklyHours)}時間・月${hours(fullTime.monthlyDays)}日）の4分の3以上`,
    );
    // パート・アルバイトで4分の3以上の人は、定時決定・随時改定で短時間就労者の扱いになる
    if (part) reasons.push('パート・アルバイトのため、被保険者区分は短時間就労者（支払基礎日数の15日以上の扱いがある）');
    return { candidate: 'general', reasons, insuredType: part ? 'partTime' : 'general' };
  }
  reasons.push(
    !hoursOk
      ? `週の所定労働時間が、通常の労働者の4分の3（週${hours(minHours)}時間）未満`
      : `月の所定労働日数が、通常の労働者の4分の3（月${hours(minDays)}日）未満`,
  );

  if (input.weeklyHours < rule.weeklyHours) {
    reasons.push(`週の所定労働時間が${rule.weeklyHours}時間未満のため、短時間労働者にも当たらない`);
    return { candidate: 'none', reasons, insuredType: null };
  }
  if (rule.studentExcluded && input.isStudent) {
    reasons.push('昼間の学生は短時間労働者の対象外（定時制・通信制・休学中・卒業後も引き続き働く予定の人は対象）');
    return { candidate: 'none', reasons, insuredType: null };
  }
  // 企業規模の要件は判定しない（このアプリは、要件を満たす特定適用事業所での使用を前提にする。設計書 2.24）
  reasons.push(`週${rule.weeklyHours}時間以上のため短時間労働者（特定適用事業所を前提）`);
  return { candidate: 'shortTime', reasons, insuredType: 'shortTime' };
}

// ---- 加入の可能性（未加入の人の実際の労働時間） ----

/** 月の労働時間を週あたりにする（月 × 12 ÷ 52） */
export function weeklyFromMonthly(monthlyHours: number): number {
  return (monthlyHours * 12) / 52;
}

export type WorkingHoursRecord = { employeeId: string; paidDate: string; workingHours?: number | null };

export type EnrollmentPossibility = {
  employeeId: string;
  /** 週の基準以上が続いた2か月 */
  months: [string, string];
  /** 各月の週あたりの労働時間 */
  weekly: [number, number];
  /** 比べた週の時間（昼間の学生は、通常の労働者の4分の3） */
  threshold: number;
  /** 加入の可能性がある月（3か月目） */
  fromMonth: string;
};

/**
 * 未加入の月の実際の労働時間が、2か月続けて週の基準以上になった人
 * 基準は短時間労働者の週の時間。昼間の学生は、通常の労働者の4分の3（一般の被保険者）で比べる。
 * 同じ人で何度も当たるときは、いちばん新しいものだけを出す
 *
 * 労働時間は、働いた月（給与の計算期間の締め日の月）で数える。給与の支払月ではない
 * （月末締め・翌月25日払いなら、5月25日に払う給与の労働時間は4月分）。
 * cutoff を渡さなければ、支払月をそのまま働いた月とみなす（当月締め・当月払いと同じ）
 */
export function findEnrollmentPossibilities(
  employees: { id: string; qualifications: Qualification[]; eligibility?: { isStudent: boolean } | null }[],
  salaries: WorkingHoursRecord[],
  rules: EligibilityRule[],
  fullTime: FullTimeStandard,
  cutoff?: CutoffArg,
): EnrollmentPossibility[] {
  const workMonth = (employeeId: string, paidDate: string): string => {
    const paidMonth = paidDate.slice(0, 7);
    return cutoff ? payPeriodEnd(paidMonth, resolveCutoff(cutoff, employeeId, paidMonth)).slice(0, 7) : paidMonth;
  };
  return employees.flatMap((e) => {
    const byMonth = new Map<string, number>();
    for (const s of salaries) {
      if (s.employeeId !== e.id || s.workingHours === null || s.workingHours === undefined) continue;
      const ym = workMonth(e.id, s.paidDate);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + s.workingHours);
    }
    const hits = [...byMonth.keys()].sort().flatMap((ym) => {
      const prev = addMonths(ym, -1);
      if (!byMonth.has(prev)) return [];
      if (isInsuredInMonth(e.qualifications, prev) || isInsuredInMonth(e.qualifications, ym)) return [];
      const rule = ruleAt(rules, `${ym}-01`);
      if (!rule) return [];
      // 特定適用事業所を前提に、短時間労働者の基準で比べる（昼間の学生は短時間労働者の対象外）
      const shortTimeApplies = !(rule.studentExcluded && e.eligibility?.isStudent);
      const threshold = shortTimeApplies ? rule.weeklyHours : (fullTime.weeklyHours * rule.fullTimeRatio) / 1000;
      const w: [number, number] = [weeklyFromMonthly(byMonth.get(prev)!), weeklyFromMonthly(byMonth.get(ym)!)];
      if (w[0] < threshold || w[1] < threshold) return [];
      const fromMonth = addMonths(ym, 1);
      // 3か月目にすでに加入していれば出さない
      if (isInsuredInMonth(e.qualifications, fromMonth)) return [];
      return [{ employeeId: e.id, months: [prev, ym] as [string, string], weekly: w, threshold, fromMonth }];
    });
    return hits.length ? [hits.at(-1)!] : [];
  });
}
