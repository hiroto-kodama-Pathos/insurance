// トップ：今月の要確認（設計書 2.7・3章 トップ）
// 給与計算の前に、年齢で保険料が切り替わる人・保険料を計算できない人・前月の確定漏れに気づけるようにする。
import { absenceDeductionNote } from '../../core/calc/absence';
import { pendingRefunds as findPendingRefunds } from '../../core/calc/same-month';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AgeAlert, ageAlerts } from '../../core/calc/age-alerts';
import { age70Notice, Age70Status } from '../../core/calc/age70';
import { calcEmployeeMonth, EmployeeMonthResult, Masters } from '../../core/calc/employee-month';
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { OfficeClosing } from '../../core/calc/closing';
import { GradeRow } from '../../core/calc/grade-suggest';
import { CandidateStatusRecord, GradeThreshold, openRevisionCandidates, trackRevisionCandidates } from '../../core/calc/revision';
import { addDays, findFilings, urgentFilings } from '../../core/calc/filing';
import { standardChangeLabel } from '../../core/calc/employee-month';
import { BonusRecord } from '../../core/calc/bonus-premium';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { FilingRepository } from '../../core/repository/filing-repository';
import { today } from '../filings/filing-list';
import { detectRetroactivePossibilities, payMonths, SalaryRecord } from '../../core/calc/salary';
import { estimateRegularAll, registrableRegular } from '../../core/calc/regular';
import { checkDeduction } from '../../core/calc/deduction';
import { cutoffResolver, legacyGroup, PayrollGroup, payrollGroupAt } from '../../core/calc/payroll-group';
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
import { EligibilityRule, findEnrollmentPossibilities } from '../../core/calc/eligibility-check';
import { DateLabelPipe, YearMonthPipe } from '../../core/ui/year-month.pipe';

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

type AlertRow = AgeAlert & { employee: EmployeeRecord; notice: Age70Status | null };

/**
 * トップの欄。上から、頻度が高く重要度も高い順（設計書 3.10）
 *   1. 前月分の未確定：毎月。確定しないと給与の支払・納付書との照合に進めない
 *   2. 保険料を計算できない人：入社のたびに起き、今月の控除額が出せない
 *   3. 標準報酬月額が変わる人・4. 年齢で切り替わる人：毎月起き、今月の控除額が変わる
 *   5. 届出の期限：入社・退職のたびに起き、期限（5日以内など）がある
 *   6. 控除しきれない人：退職・休職のときに起き、給与を払う前に本人と調整が要る
 *   7. 通知書待ち以降：月によって起きる、確認・後追いの項目
 */
export type HomeSection = 'unclosed' | 'problems' | 'standardChanges' | 'age' | 'filings' | 'deductions' | 'provisional' | 'enrollment' | 'retroactive' | 'refunds';
export const HOME_SECTION_LABEL: Record<HomeSection, string> = {
  unclosed: '前月分で確定していない適用事業所',
  problems: '今月の保険料を計算できない人',
  standardChanges: '今月から標準報酬月額が変わる人',
  age: '年齢で保険料が切り替わる人',
  filings: '期限が近い・過ぎた届出',
  deductions: '今月の給与で控除しきれない人',
  provisional: '通知書待ちの標準報酬月額',
  enrollment: '加入の可能性がある人',
  retroactive: '遡及の可能性がある給与',
  refunds: '同月得喪の還付待ち',
};
const HOME_SECTIONS = Object.keys(HOME_SECTION_LABEL) as HomeSection[];

@Component({
  imports: [RouterLink, NgTemplateOutlet, YearMonthPipe, DateLabelPipe],
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
  private readonly bonusRepo = inject(BonusRepository);
  private readonly filingRepo = inject(FilingRepository);
  protected readonly today = signal(today());
  private readonly bonuses = signal<BonusRecord[]>([]);
  private readonly filedIds = signal<Set<string>>(new Set());

  /** 期限が近い・過ぎた届出（未対応のうち、期限が7日以内・過ぎたもの・期限の日がないもの） */
  protected readonly urgentFilings = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const candidates = trackRevisionCandidates(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.statuses(), this.cutoff());
    const list = findFilings(this.employees(), this.bonuses(), this.salaries(), this.grades(), candidates, m.offices, this.today());
    return urgentFilings(list, this.filedIds(), this.today());
  });
  protected readonly overdueFilings = computed(() => this.urgentFilings().filter((f) => f.deadline !== null && f.deadline < this.today()).length);

  /** 今月から標準報酬月額が変わる人（変わった側を出す） */
  protected readonly standardChanges = computed(() =>
    this.employees().flatMap((e) => {
      const label = standardChangeLabel(e.standardHistory, this.thisMonth());
      return label ? [{ employee: e, label }] : [];
    }),
  );
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
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  /** 人と支払月ごとの締め日（その人の支払区分） */
  private readonly cutoff = computed(() => cutoffResolver(this.groups(), this.employees()));
  private readonly prevClosings = signal<OfficeClosing[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  private readonly statuses = signal<CandidateStatusRecord[]>([]);
  private readonly eligibilityRules = signal<EligibilityRule[]>([]);
  private readonly settings = signal<CompanySettings>(DEFAULT_SETTINGS);


  /** 通知書待ちの標準報酬月額（見込みの額を先に登録した人） */
  protected readonly provisionalStandards = computed(() =>
    this.employees()
      .flatMap((e) =>
        e.standardHistory
          .filter((s) => s.provisional)
          .map((s) => ({ employee: e, validFrom: s.validFrom, healthStandard: s.healthStandard, pensionStandard: s.pensionStandard })),
      )
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber) || a.validFrom.localeCompare(b.validFrom)),
  );

  /** 同月得喪で、厚生年金保険料の還付を待っている人（設計書 2.27） */
  protected readonly pendingRefunds = computed(() => findPendingRefunds(this.employees()));

  /** 遡及の可能性（遡及差額を入れていないのに、遡及昇給のような動きがある。前々月・前月の支払い） */
  protected readonly retroactivePossibilities = computed(() => {
    const from = addMonths(this.thisMonth(), -2);
    return this.employees().flatMap((e) =>
      detectRetroactivePossibilities(payMonths(this.salaries().filter((s) => s.employeeId === e.id)))
        .filter((r) => r.yearMonth >= from)
        .map((r) => ({ ...r, employee: e })),
    );
  });

  /** 未加入の人で、実際の労働時間が2か月続けて基準以上になった人（設計書 2.24） */
  protected readonly enrollmentPossibilities = computed(() => {
    const s = this.settings();
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return findEnrollmentPossibilities(
      this.employees(),
      this.salaries(),
      this.eligibilityRules(),
      { weeklyHours: s.fullTimeWeeklyHours, monthlyDays: s.fullTimeMonthlyDays },
      // 労働時間は、支払区分の締め日から働いた月を求めて数える（翌月払いなら支払月の前月）
      this.cutoff(),
    )
      // 3か月目が今月・来月までの人を出す（古い月の分は、もう確かめ終わっているはず）
      .filter((p) => p.fromMonth >= this.thisMonth() && p.fromMonth <= this.nextMonth())
      .map((p) => ({ ...p, employee: byId.get(p.employeeId)!, weeklyHours: p.weekly.map((w) => w.toFixed(1)) }));
  });

  private withEmployee(alerts: AgeAlert[]): AlertRow[] {
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return alerts
      .map((a) => {
        const employee = byId.get(a.employeeId)!;
        // 70歳は、厚生年金保険料がなくなることに加えて、70歳到達届の要否を出す（設計書 2.2）
        if (a.kind !== 'pensionEnd') return { ...a, employee, notice: null };
        const notice = age70Notice(employee, this.salaries(), this.grades());
        return { ...a, employee, notice: notice?.status ?? null, message: notice ? `この月の分から厚生年金保険料がなくなります。${notice.message}` : a.message };
      })
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
    const groupOf = (e: EmployeeRecord) => payrollGroupAt(this.groups(), e.payrollAssignments, `${payYm}-01`);
    return this.employees()
      .map((e) => ({
        employee: e,
        check: checkDeduction(e.id, e.qualifications, payYm, groupOf(e).deductionTiming, this.salaries(), (ym) => {
          const p = calcEmployeeMonth(e, m, ym, this.rounding()).premium;
          return p ? Number([p.health, p.care, p.childSupport, p.pension].reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n)) : 0;
        }, settledAmountFor(e.id, payYm, this.settlements()), groupOf(e).paidIn === 'sameMonth'),
        note: absenceDeductionNote(e.absences, payYm),
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
      // 年齢による切り替えは、欄と同じく今月と来月の人を数える（来月の人だけでも「確かめることはありません」と出さない）
      this.ageThisMonth().length + this.ageNextMonth().length + this.problems().length + this.unclosedPrev().length + this.revisions().length + this.regularPending() + this.deductionAlerts().length + this.openAdjustments().length + this.enrollmentPossibilities().length + this.retroactivePossibilities().length + this.provisionalStandards().length + this.pendingRefunds().length + this.urgentFilings().length + this.standardChanges().length,
  );

  /** 欄ごとの件数 */
  protected readonly sectionCounts = computed<Record<HomeSection, number>>(() => ({
    unclosed: this.unclosedPrev().length,
    problems: this.problems().length,
    standardChanges: this.standardChanges().length,
    age: this.ageThisMonth().length + this.ageNextMonth().length,
    filings: this.urgentFilings().length,
    deductions: this.deductionAlerts().length,
    provisional: this.provisionalStandards().length,
    enrollment: this.enrollmentPossibilities().length,
    retroactive: this.retroactivePossibilities().length,
    refunds: this.pendingRefunds().length,
  }));
  /** 確かめることがある欄（上に出す） */
  protected readonly activeSections = computed(() => HOME_SECTIONS.filter((k) => this.sectionCounts()[k] > 0));
  /** 確かめることがない欄（たたんで下に出す） */
  protected readonly clearSections = computed(() => HOME_SECTIONS.filter((k) => this.sectionCounts()[k] === 0));
  protected readonly sectionLabel = HOME_SECTION_LABEL;
  protected readonly clearLabels = computed(() => this.clearSections().map((k) => HOME_SECTION_LABEL[k]).join('・'));
  /** たたんだ欄を開いているか */
  protected readonly clearOpen = signal(false);

  protected hasItems(k: HomeSection): boolean {
    return this.sectionCounts()[k] > 0;
  }

  /** チップを押したら、その欄へ移る（たたんだ欄なら開いてから） */
  protected goTo(section: HomeSection): void {
    if (this.sectionCounts()[section] === 0) this.clearOpen.set(true);
    setTimeout(() => {
      const el = document.getElementById(`sec-${section}`) as HTMLDetailsElement | null;
      if (el) {
        el.open = true; // セクションを開く
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, closings, salaries, grades, thresholds, statuses, settlements, recentClosings, rules] = await Promise.all([
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
        this.masterRepo.loadEligibilityRules(),
      ]);
      const [bonuses, filed] = await Promise.all([
        this.bonusRepo.loadRange(addDays(this.today(), -200), addDays(this.today(), 90)),
        this.filingRepo.loadFiledIds(),
      ]);
      this.bonuses.set(bonuses);
      this.filedIds.set(filed);
      this.eligibilityRules.set(rules);
      this.settings.set(settings);
      this.settlements.set(settlements);
      this.recentClosings.set(recentClosings);
      this.statuses.set(statuses);
      this.salaries.set(salaries);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.groups.set(await this.settingsRepo.loadPayrollGroups());
      this.prevClosings.set(closings);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }
}
