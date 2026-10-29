// 定時決定の見込み（設計書 2.13・2.13.1・3.7）
// 4〜6月に支払った報酬の平均から、9月分からの標準報酬月額を見込む。
// 一覧はあくまで見込みの表示。担当者が「見込みどおり登録」や一括登録をするまで、標準報酬月額も保険料も変わらない。
import { isPensionAge } from './age';
import { monthEnd } from './date';
import { isInsuredInMonth, Leave, Qualification } from './eligibility';
import { findEffective } from './employee-month';
import { GradeRow, suggestStandards } from './grade-suggest';
import { DEFAULT_CUTOFF, minBaseDays, PayrollCutoff, typeForPayMonth } from './insured-type';
import { findRevisionCandidates, GradeThreshold, RevisionEmployee } from './revision';
import { addMonths, payMonths, PayMonth, SalaryRecord } from './salary';

/** 4〜6月の各月の扱い */
export type RegularMonth = {
  yearMonth: string;
  pay: PayMonth | null;
  /** 平均に使うか */
  used: boolean;
  /** 平均から除いた理由（使う月は null） */
  excludedReason: string | null;
};

export type RegularSide = { currentStandard: number; newStandard: number; currentGrade: number | null; newGrade: number };

export type RegularEstimate = {
  employeeId: string;
  year: number;
  months: RegularMonth[];
  /** 平均（円未満切り捨て）。使える月がなければ null（従前の標準報酬月額のまま） */
  average: number | null;
  health: RegularSide | null;
  /** 70歳以上の人は厚生年金の標準報酬月額がない（null） */
  pension: RegularSide | null;
  /** 7〜9月に随時改定がある（定時決定の対象外。印を付ける） */
  revisionInJulSep: boolean;
  /** 報酬が大きく下がった月がある（休職など。除くかは担当者が判断） */
  needsReview: boolean;
  /** 年間平均の特例の候補（前年7月〜当年6月の平均との差が2等級以上） */
  annualAverageCandidate: boolean;
  /** 算定基礎届の備考に書くこと・画面の注意 */
  notes: string[];
  /** 見込みどおりに登録する値 */
  expectedHealth: number;
  expectedPension: number;
  /** 9月分からの標準報酬月額の履歴がすでにある */
  registered: boolean;
};

export type RegularEmployee = RevisionEmployee & { leaves: Leave[] };

/** 固定的賃金が前月までの月から2割以上下がった月を「大きく下がった」とみなす */
export const BIG_DROP_RATIO = 0.8;

function gradeOf(table: GradeRow[], standard: number, type: 'health' | 'pension'): number | null {
  const row = table.find((g) => g.standardAmount === standard && (type === 'health' || g.pensionGrade !== null));
  if (!row) return null;
  return type === 'health' ? row.healthGrade : row.pensionGrade;
}

function onLeave(leaves: Leave[], ym: string): boolean {
  const from = `${ym}-01`;
  const to = monthEnd(ym);
  return leaves.some((l) => l.startDate <= to && (l.endDate === null || l.endDate >= from));
}

/** 7月1日に被保険者で、6月1日より前に資格を取った人が対象 */
export function isRegularTarget(qualifications: Qualification[], year: number): boolean {
  const july1 = `${year}-07-01`;
  return qualifications.some(
    (q) => q.acquiredDate < `${year}-06-01` && (q.lostDate === null || q.lostDate > july1),
  );
}

/**
 * 1人分の定時決定の見込み。対象外（6月1日以降の資格取得、7月1日に資格がない）の人は null
 */
export function estimateRegular(
  employee: RegularEmployee,
  salaries: SalaryRecord[],
  grades: GradeRow[],
  thresholds: GradeThreshold[],
  year: number,
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): RegularEstimate | null {
  if (!isRegularTarget(employee.qualifications, year)) return null;
  const mine = salaries.filter((s) => s.employeeId === employee.id);
  const months = payMonths(mine);
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  const applyFrom = `${year}-09`;
  const current = findEffective(employee.standardHistory, `${year}-08`);
  if (!current) return null;

  const notes: string[] = [];
  let needsReview = false;
  const ymList = [4, 5, 6].map((m) => `${year}-${String(m).padStart(2, '0')}`);
  // 支払基礎日数の基準は、各月の締め日時点の被保険者区分で選ぶ
  const types = ymList.map((ym) => typeForPayMonth(employee.insuredTypes, ym, cutoff));
  /** 短時間就労者で、15日以上17日未満の月（17日以上の月がないときだけ平均に使う） */
  const partTime15: string[] = [];
  const result: RegularMonth[] = ymList.map((ym, i) => {
    const pay = byMonth.get(ym) ?? null;
    const min = minBaseDays(types[i]);
    const reason = (() => {
      const q = employee.qualifications.find((x) => x.acquiredDate.startsWith(ym));
      if (q && !q.acquiredDate.endsWith('-01')) return '月の途中で資格を取った月';
      if (!isInsuredInMonth(employee.qualifications, ym)) return '資格のない月';
      if (!pay) return onLeave(employee.leaves, ym) ? '休業中（給与なし）' : '給与なし';
      if (pay.total === 0 && onLeave(employee.leaves, ym)) return '休業中で報酬なし';
      if (pay.days < min) {
        if (types[i] === 'partTime' && pay.days >= 15) partTime15.push(ym);
        return `支払基礎日数が${min}日未満`;
      }
      return null;
    })();
    if (pay && reason === null) {
      // 前月までの固定的賃金より大きく下がった月（休職など）
      const prev = byMonth.get(addMonths(ym, -1));
      if (prev && prev.fixed > 0 && pay.fixed < prev.fixed * BIG_DROP_RATIO) needsReview = true;
    }
    return { yearMonth: ym, pay, used: reason === null, excludedReason: reason };
  });
  if (needsReview) notes.push('報酬が大きく下がった月あり（休職などなら平均から除くか確認）');
  if (result.some((m) => m.excludedReason === '月の途中で資格を取った月')) notes.push('途中入社');
  if (result.some((m) => m.pay && m.pay.retroactive > 0)) notes.push('遡及差額を除いて平均');

  // 短時間就労者：17日以上の月がなければ、15日以上17日未満の月で平均する
  if (!result.some((m) => m.used) && partTime15.length > 0) {
    for (const m of result)
      if (partTime15.includes(m.yearMonth)) {
        m.used = true;
        m.excludedReason = null;
      }
    notes.push('短時間就労者（15日以上17日未満の月で平均）');
  }
  if (types.includes('specialReduction')) {
    needsReview = true;
    notes.push('特定減額特例対象者（自動では判定しないため、内容を確かめる）');
  }
  const before = typeForPayMonth(employee.insuredTypes, `${year}-03`, cutoff);
  if (types.some((t) => t !== before)) notes.push('区分変更あり（備考欄に記入）');

  const used = result.filter((m) => m.used);
  const average = used.length > 0 ? Math.floor(used.reduce((s, m) => s + m.pay!.total, 0) / used.length) : null;

  const pensionJudged = employee.birthDate === '' || isPensionAge(employee.birthDate, applyFrom);
  if (!pensionJudged) notes.push('70歳以上被用者');

  const v = grades.map((g) => g.validFrom).filter((x) => x <= applyFrom).sort().at(-1);
  const table = v ? grades.filter((g) => g.validFrom === v) : [];
  let health: RegularSide | null = null;
  let pension: RegularSide | null = null;
  let annualAverageCandidate = false;
  if (average === null) {
    notes.push('平均に使える月がないため、従前の標準報酬月額のまま');
  } else {
    const s = suggestStandards(average, grades, applyFrom, '');
    if (s) {
      health = {
        currentStandard: current.healthStandard,
        currentGrade: gradeOf(table, current.healthStandard, 'health'),
        newStandard: s.healthStandard,
        newGrade: s.healthGrade,
      };
      if (pensionJudged)
        pension = {
          currentStandard: current.pensionStandard,
          currentGrade: gradeOf(table, current.pensionStandard, 'pension'),
          newStandard: s.pensionStandard,
          newGrade: s.pensionGrade,
        };
      // 年間平均の特例：前年7月〜当年6月の給与が12か月そろっている人だけ判定する
      const annualYms = Array.from({ length: 12 }, (_, i) => addMonths(`${year - 1}-07`, i));
      if (annualYms.every((ym) => byMonth.has(ym))) {
        const annualUsed = annualYms
          .map((ym) => byMonth.get(ym)!)
          .filter(
            (m) =>
              m.days >= minBaseDays(typeForPayMonth(employee.insuredTypes, m.yearMonth, cutoff)) &&
              isInsuredInMonth(employee.qualifications, m.yearMonth),
          );
        if (annualUsed.length > 0) {
          const annualAvg = Math.floor(annualUsed.reduce((t, m) => t + m.total, 0) / annualUsed.length);
          const a = suggestStandards(annualAvg, grades, applyFrom, '');
          if (a && Math.abs(a.healthGrade - s.healthGrade) >= 2) {
            annualAverageCandidate = true;
            notes.push(`年間平均の特例の候補（年間平均 ${annualAvg.toLocaleString('ja-JP')}円）`);
          }
        }
      }
    }
  }

  // 7〜9月に随時改定がある人は、定時決定の対象外（印を付ける）
  const julSep = [`${year}-07`, `${year}-08`, `${year}-09`];
  const revisionInJulSep =
    employee.standardHistory.some((h) => julSep.includes(h.validFrom) && h.validFrom !== applyFrom) ||
    findRevisionCandidates(employee, salaries, grades, thresholds, cutoff).some((c) => julSep.includes(c.expectedFrom));
  if (revisionInJulSep) notes.unshift('7〜9月に随時改定があるため定時決定の対象外');

  return {
    employeeId: employee.id,
    year,
    months: result,
    average,
    health,
    pension,
    revisionInJulSep,
    needsReview,
    annualAverageCandidate,
    notes,
    expectedHealth: health?.newStandard ?? current.healthStandard,
    expectedPension: pension?.newStandard ?? current.pensionStandard,
    registered: employee.standardHistory.some((h) => h.validFrom === applyFrom),
  };
}

/** 全員分の見込み（対象外の人は除く） */
export function estimateRegularAll(
  employees: RegularEmployee[],
  salaries: SalaryRecord[],
  grades: GradeRow[],
  thresholds: GradeThreshold[],
  year: number,
  cutoff: PayrollCutoff = DEFAULT_CUTOFF,
): RegularEstimate[] {
  return employees.flatMap((e) => {
    const r = estimateRegular(e, salaries, grades, thresholds, year, cutoff);
    return r ? [r] : [];
  });
}

/** 一括登録できる見込み（未登録で、7〜9月の随時改定がなく、平均が出た人） */
export function registrableRegular(list: RegularEstimate[]): RegularEstimate[] {
  return list.filter((r) => !r.registered && !r.revisionInJulSep && r.average !== null);
}

