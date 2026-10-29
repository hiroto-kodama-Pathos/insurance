// トップ：今月の要確認（設計書 2.7・3章 トップ）
// 給与計算の前に、年齢で保険料が切り替わる人・保険料を計算できない人・前月の確定漏れに気づけるようにする。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgeAlert, ageAlerts } from '../../core/calc/age-alerts';
import { calcEmployeeMonth, EmployeeMonthResult, Masters } from '../../core/calc/employee-month';
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { OfficeClosing } from '../../core/calc/closing';
import { GradeRow } from '../../core/calc/grade-suggest';
import { CandidateStatusRecord, GradeThreshold, openRevisionCandidates } from '../../core/calc/revision';
import { SalaryRecord } from '../../core/calc/salary';
import { estimateRegularAll, registrableRegular } from '../../core/calc/regular';
import { checkDeduction, DeductionTiming } from '../../core/calc/deduction';
import { findAdjustments, SettlementRecord, settledAmountFor, trackAdjustments } from '../../core/calc/adjustment';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { ADJUSTMENT_LOOKBACK_MONTHS } from '../adjustments/adjustment-list';
import { REVISION_LOOKBACK_MONTHS } from '../revisions/revision-list';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { CompanySettings, DEFAULT_SETTINGS } from '../../core/calc/settings';

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const PROBLEM_LABEL: Partial<Record<EmployeeMonthResult['status'], string>> = {
  noStandard: '標準報酬月額が未登録',
  missingRate: '料率が未登録',
  noOffice: '所属事業所が未登録',
};

type AlertRow = AgeAlert & { employee: EmployeeRecord };

@Component({
  imports: [RouterLink],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly revisionRepo = inject(RevisionRepository);
  private readonly adjustmentRepo = inject(AdjustmentRepository);
  private readonly settlements = signal<SettlementRecord[]>([]);
  private readonly recentClosings = signal<OfficeClosing[]>([]);

  protected readonly thisMonth = signal(currentMonth());
  protected readonly nextMonth = computed(() => addMonths(this.thisMonth(), 1));
  protected readonly prevMonth = computed(() => addMonths(this.thisMonth(), -1));

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  private readonly rounding = signal<ChildSupportRounding>('combined');
  private readonly cutoff = signal<CompanySettings['payrollCutoff']>(DEFAULT_SETTINGS.payrollCutoff);
  private readonly timing = signal<DeductionTiming>(DEFAULT_SETTINGS.deductionTiming);
  private readonly prevClosings = signal<OfficeClosing[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  private readonly statuses = signal<CandidateStatusRecord[]>([]);

  private withEmployee(alerts: AgeAlert[]): AlertRow[] {
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return alerts
      .map((a) => ({ ...a, employee: byId.get(a.employeeId)! }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  }

  /** 今月・来月に年齢で保険料が切り替わる人 */
  protected readonly ageThisMonth = computed(() => this.withEmployee(ageAlerts(this.employees(), this.thisMonth())));
  protected readonly ageNextMonth = computed(() => this.withEmployee(ageAlerts(this.employees(), this.nextMonth())));

  /** 今月の保険料を計算できない人 */
  protected readonly problems = computed(() => {
    const m = this.masters();
    if (!m) return [];
    return this.employees()
      .map((e) => ({ employee: e, status: calcEmployeeMonth(e, m, this.thisMonth(), this.rounding()).status }))
      .filter((x) => PROBLEM_LABEL[x.status])
      .map((x) => ({ ...x, label: PROBLEM_LABEL[x.status]! }))
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  });

  /** 前月に保険料がかかる人がいるのに、確定していない事業所 */
  protected readonly unclosedPrev = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const used = new Set(
      this.employees()
        .map((e) => calcEmployeeMonth(e, m, this.prevMonth(), this.rounding()))
        .filter((r) => r.status === 'ok' && r.officeId)
        .map((r) => r.officeId!),
    );
    const closed = new Set(this.prevClosings().map((c) => c.officeId));
    return m.offices.filter((o) => used.has(o.id) && !closed.has(o.id));
  });

  /** 随時改定の候補（対応が残っているもの：未対応・届出済み） */
  protected readonly revisions = computed(() =>
    openRevisionCandidates(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.statuses(), this.cutoff()),
  );
  protected readonly revisionReviewCount = computed(() => this.revisions().filter((c) => c.needsReview).length);
  protected readonly revisionFiledCount = computed(() => this.revisions().filter((c) => c.status === 'filed').length);

  /** 7〜9月は、定時決定の見込みをまだ登録していない人（9月分から変わるため） */
  protected readonly regularSeason = computed(() => ['07', '08', '09'].includes(this.thisMonth().slice(5)));
  protected readonly regularPending = computed(() =>
    this.regularSeason()
      ? registrableRegular(
          estimateRegularAll(this.employees(), this.salaries(), this.grades(), this.thresholds(), Number(this.thisMonth().slice(0, 4)), this.cutoff()),
        ).length
      : 0,
  );

  /** 今月支払う給与で、本人負担を控除しきれない人・保険料の割合が高い人（給与を入れた人だけ） */
  protected readonly deductionAlerts = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const payYm = this.thisMonth();
    return this.employees()
      .map((e) => ({
        employee: e,
        check: checkDeduction(e.id, e.qualifications, payYm, this.timing(), this.salaries(), (ym) => {
          const p = calcEmployeeMonth(e, m, ym, this.rounding()).premium;
          return p ? Number([p.health, p.care, p.childSupport, p.pension].reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n)) : 0;
        }, settledAmountFor(e.id, payYm, this.settlements())),
      }))
      .filter((x) => x.check.status === 'shortage' || x.check.status === 'caution')
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  });
  protected readonly shortageCount = computed(() => this.deductionAlerts().filter((x) => x.check.status === 'shortage').length);

  /** 未精算のさかのぼる差額 */
  protected readonly openAdjustments = computed(() => {
    const m = this.masters();
    if (!m) return [];
    return trackAdjustments(findAdjustments(this.employees(), m, this.recentClosings(), this.rounding()), this.settlements()).filter(
      (a) => a.settledMonth === null,
    );
  });

  protected readonly total = computed(
    () =>
      this.ageThisMonth().length + this.problems().length + this.unclosedPrev().length + this.revisions().length + this.regularPending() + this.deductionAlerts().length + this.openAdjustments().length,
  );

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, closings, salaries, grades, thresholds, statuses, settlements, recentClosings] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
        this.closingRepo.loadMonth(this.prevMonth()),
        this.salaryRepo.loadRange(addMonths(this.thisMonth(), -(REVISION_LOOKBACK_MONTHS - 1)), this.thisMonth()),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.revisionRepo.loadStatuses(),
        this.adjustmentRepo.loadSettlements(),
        this.closingRepo.loadRecent(this.thisMonth(), ADJUSTMENT_LOOKBACK_MONTHS),
      ]);
      this.settlements.set(settlements);
      this.recentClosings.set(recentClosings);
      this.statuses.set(statuses);
      this.salaries.set(salaries);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.cutoff.set(settings.payrollCutoff);
      this.timing.set(settings.deductionTiming);
      this.prevClosings.set(closings);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }
}
