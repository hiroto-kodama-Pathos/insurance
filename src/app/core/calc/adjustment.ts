// さかのぼる改定の差額（設計書 2.20）
// 確定した月の結果（closings）は書き換えない。確定時の結果と、今のデータで計算し直した結果を比べて差額を出す。
// 差額は毎回計算し、担当者が精算した記録（精算月と精算した額）だけを保存する。
import { ClosedRow, OfficeClosing } from './closing';
import { calcEmployeeMonth, EmployeeData, EmployeeMonthResult, Masters } from './employee-month';
import { ChildSupportRounding } from './monthly-premium';

export type InsuranceKey = 'health' | 'care' | 'childSupport' | 'pension';
export const INSURANCE_KEYS: InsuranceKey[] = ['health', 'care', 'childSupport', 'pension'];

/** 保険ごとの差額（正は追加で控除・納付、負は返金） */
export type PremiumDiff = { employeeYen: number; employerSen: number; fullSen: number };
export type Diffs = Record<InsuranceKey, PremiumDiff>;

/**
 * standard：標準報酬月額のさかのぼる改定 / transfer：確定後に登録した異動（元と異動先の2件）
 * leave：確定後の休業の登録・変更 / added：確定後に資格・所属を登録した（資格取得届の遅れなど）
 * other：適用除外など、そのほかの変更
 */
export type AdjustmentCause = 'standard' | 'transfer' | 'leave' | 'added' | 'other';

export type Adjustment = {
  /** 従業員ID_対象月_事業所ID */
  id: string;
  employeeId: string;
  yearMonth: string;
  officeId: string;
  cause: AdjustmentCause;
  beforeStandard: { health: number; pension: number } | null;
  afterStandard: { health: number; pension: number } | null;
  diffs: Diffs;
  /** 本人負担の差額の合計（円） */
  employeeTotal: number;
};

/** 担当者が精算した記録（adjustments に保存する）。精算したあとにまた変わり、もう一度精算したら1件ずつ足す */
export type SettlementRecord = { id: string; entries: { settledMonth: string; diffs: Diffs }[] };

function sumDiffs(list: Diffs[]): Diffs {
  const d = emptyDiffs();
  for (const x of list)
    for (const k of INSURANCE_KEYS) {
      d[k].employeeYen += x[k].employeeYen;
      d[k].employerSen += x[k].employerSen;
      d[k].fullSen += x[k].fullSen;
    }
  return d;
}

export type TrackedAdjustment = Adjustment & {
  /** 精算した給与の月（まだ精算していない差額が残っていれば null） */
  settledMonth: string | null;
  /** 精算したあとにまた変わった場合は、残りの差額（前の精算との差） */
  remaining: Diffs;
  remainingEmployeeTotal: number;
};

const zero = (): PremiumDiff => ({ employeeYen: 0, employerSen: 0, fullSen: 0 });
export const emptyDiffs = (): Diffs => ({ health: zero(), care: zero(), childSupport: zero(), pension: zero() });

function stored(row: ClosedRow | null, k: InsuranceKey): PremiumDiff {
  const p = row?.premiums[k];
  return p ? { employeeYen: p.employeeYen, employerSen: p.employerSen, fullSen: p.fullSen } : zero();
}

function liveOf(r: EmployeeMonthResult | null, k: InsuranceKey): PremiumDiff {
  const p = r && r.status === 'ok' ? r.premium?.[k] : null;
  return p ? { employeeYen: Number(p.employeeYen), employerSen: Number(p.employerSen), fullSen: Number(p.fullSen) } : zero();
}

function diffOf(before: ClosedRow | null, after: EmployeeMonthResult | null): Diffs {
  const d = emptyDiffs();
  for (const k of INSURANCE_KEYS) {
    const b = stored(before, k);
    const a = liveOf(after, k);
    d[k] = { employeeYen: a.employeeYen - b.employeeYen, employerSen: a.employerSen - b.employerSen, fullSen: a.fullSen - b.fullSen };
  }
  return d;
}

export function isZero(d: Diffs): boolean {
  return INSURANCE_KEYS.every((k) => d[k].employeeYen === 0 && d[k].employerSen === 0 && d[k].fullSen === 0);
}

export function employeeTotalOf(d: Diffs): number {
  return INSURANCE_KEYS.reduce((t, k) => t + d[k].employeeYen, 0);
}

function subtract(a: Diffs, b: Diffs): Diffs {
  const d = emptyDiffs();
  for (const k of INSURANCE_KEYS)
    d[k] = { employeeYen: a[k].employeeYen - b[k].employeeYen, employerSen: a[k].employerSen - b[k].employerSen, fullSen: a[k].fullSen - b[k].fullSen };
  return d;
}

/**
 * 確定済みの月の差額を求める
 *
 * - 確定時と同じ事業所なら、確定時の料率で計算し直し、変わった条件（標準報酬月額・休業・適用除外）の分だけを差額にする
 * - 確定後に異動を登録した人は、元の事業所に確定額を取り消すマイナス、異動先（確定済みのとき）に正しい額のプラスを出す
 * - 確定に含まれていない人が、確定済みの事業所でその月に保険料がかかるようになった場合は、プラスの差額を出す
 */
export function findAdjustments(
  employees: EmployeeData[],
  masters: Masters,
  closings: OfficeClosing[],
  rounding: ChildSupportRounding = 'combined',
): Adjustment[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const closed = new Map(closings.map((c) => [`${c.yearMonth}|${c.officeId}`, c]));
  const inClosing = new Set(closings.flatMap((c) => c.rows.map((r) => `${c.yearMonth}|${r.employeeId}`)));
  const out: Adjustment[] = [];
  const push = (a: Omit<Adjustment, 'id' | 'employeeTotal'>) => {
    if (isZero(a.diffs)) return;
    out.push({ ...a, id: `${a.employeeId}_${a.yearMonth}_${a.officeId}`, employeeTotal: employeeTotalOf(a.diffs) });
  };

  for (const c of closings) {
    for (const row of c.rows) {
      const e = byId.get(row.employeeId);
      if (!e) continue;
      const live = calcEmployeeMonth(e, masters, c.yearMonth, rounding, { officeId: c.officeId, rates: row.rates });
      const sameOffice = live.status !== 'notInsured' && live.officeId === c.officeId;
      if (sameOffice) {
        const changedStandard =
          live.standard !== null && (live.standard.health !== row.standard.health || live.standard.pension !== row.standard.pension);
        const cause: AdjustmentCause = changedStandard ? 'standard' : (live.premium?.exempt ?? false) !== row.exempt ? 'leave' : 'other';
        push({
          employeeId: e.id, yearMonth: c.yearMonth, officeId: c.officeId, cause,
          beforeStandard: row.standard, afterStandard: live.standard, diffs: diffOf(row, live),
        });
        continue;
      }
      // 確定後に異動・資格の喪失を登録した：元の事業所は確定額を取り消す
      push({
        employeeId: e.id, yearMonth: c.yearMonth, officeId: c.officeId, cause: live.status === 'notInsured' ? 'other' : 'transfer',
        beforeStandard: row.standard, afterStandard: null, diffs: diffOf(row, null),
      });
      // 異動先が確定済みで、その確定に含まれていなければ、正しい額をプラスで出す
      // （異動先が未確定なら、異動先を確定するときに一緒に保存される）
      if (live.officeId && closed.has(`${c.yearMonth}|${live.officeId}`) && live.status === 'ok') {
        push({
          employeeId: e.id, yearMonth: c.yearMonth, officeId: live.officeId, cause: 'transfer',
          beforeStandard: null, afterStandard: live.standard, diffs: diffOf(null, live),
        });
      }
    }
  }

  // 確定に含まれていない人が、確定済みの事業所で保険料がかかるようになった（資格取得届の遅れなど）
  const months = [...new Set(closings.map((c) => c.yearMonth))];
  for (const ym of months) {
    for (const e of employees) {
      if (inClosing.has(`${ym}|${e.id}`)) continue;
      const live = calcEmployeeMonth(e, masters, ym, rounding);
      if (live.status !== 'ok' || !live.officeId || !closed.has(`${ym}|${live.officeId}`)) continue;
      push({
        employeeId: e.id, yearMonth: ym, officeId: live.officeId, cause: 'added',
        beforeStandard: null, afterStandard: live.standard, diffs: diffOf(null, live),
      });
    }
  }
  return out.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.employeeId.localeCompare(b.employeeId));
}

/** 精算の記録を付ける。精算したあとにまた変わった分は、残りの差額として未精算に戻す */
export function trackAdjustments(list: Adjustment[], settlements: SettlementRecord[]): TrackedAdjustment[] {
  const byId = new Map(settlements.map((s) => [s.id, s]));
  return list.map((a) => {
    const s = byId.get(a.id);
    const remaining = s ? subtract(a.diffs, sumDiffs(s.entries.map((x) => x.diffs))) : a.diffs;
    const settled = s !== undefined && s.entries.length > 0 && isZero(remaining);
    return {
      ...a,
      settledMonth: settled ? s!.entries.at(-1)!.settledMonth : null,
      remaining,
      remainingEmployeeTotal: employeeTotalOf(remaining),
    };
  });
}

/** 精算した給与の月に、本人から追加で控除する（返金する）差額の合計（控除不足の判定に使う） */
export function settledAmountFor(employeeId: string, payYm: string, settlements: SettlementRecord[]): number {
  return settlements
    .filter((s) => s.id.startsWith(`${employeeId}_`))
    .flatMap((s) => s.entries)
    .filter((x) => x.settledMonth === payYm)
    .reduce((t, x) => t + employeeTotalOf(x.diffs), 0);
}
