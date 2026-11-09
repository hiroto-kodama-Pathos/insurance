// 従業員の詳細（設計書 3.1）：資格・所属事業所・標準報酬月額・休業の履歴と、保険料の推移
import { UsablePipe } from '../../../core/ui/usable.pipe';
import { Confirm } from '../../../core/ui/confirm';
import { NoticeMessage } from '../../../core/ui/notice-message';
import { retirementPreview } from '../../../core/calc/deduction';
import {
  CANDIDATE_LABEL,
  EligibilityInput,
  EligibilityRule,
  EMPLOYMENT_TYPE_LABEL,
  EMPTY_ELIGIBILITY,
  EmploymentType,
  judgeEligibility,
  StoredEligibility,
} from '../../../core/calc/eligibility-check';
import { checkEligibilityInput, hoursOptional } from '../../../core/calc/new-employee';
import { BREAKDOWN_KEYS, BREAKDOWN_LABEL, BreakdownKey, breakdownTotal, checkBreakdown, EMPTY_BREAKDOWN, RemunerationBreakdown } from '../../../core/calc/new-employee';
import { isValidDate } from '../../../core/calc/new-employee';
import { INSURED_TYPE_LABEL, InsuredType, insuredTypeAt } from '../../../core/calc/insured-type';
import { checkPayrollAssignment, groupLabel, legacyGroup, PayrollGroup, payrollGroupAt } from '../../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { ABSENCE_REASON_LABEL, ABSENCE_REASONS, AbsenceInput, absencePeriodLabel, absentOn, checkAbsence } from '../../../core/calc/absence';
import { REFUND_KEYS, REFUND_LABEL, RefundStatus, sameMonthCases } from '../../../core/calc/same-month';
import {
  careExemptionLabel,
  checkDependent,
  type DependentContext,
  checkDependentCareExemption,
  checkRemoval,
  Dependent,
  dependentOut,
  dependentOutDate,
  dependentReportDeadline,
  DependentCareExemptionInput,
  DependentInput,
  withCareExemption,
} from '../../../core/calc/dependent';
import {
  checkExemption,
  EXEMPTION_DATE_HINT,
  EXEMPTION_LABEL,
  EXEMPTION_TARGETS,
  ExemptionInput,
  exemptionNote,
  exemptionNotice,
  ExemptionType,
} from '../../../core/calc/exemption';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { afterDiscardCheck, FormSnapshot, HasUnsavedChanges } from '../../../core/ui/unsaved-guard';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../../core/auth/auth';
import { MaintenanceRepository } from '../../../core/repository/maintenance-repository';
import { FilingRepository } from '../../../core/repository/filing-repository';
import { leaveFilingId } from '../../../core/calc/eligibility';
import { deleteImpact, deleteImpactMessage } from '../../../core/calc/delete-impact';
import { filingId } from '../../../core/calc/filing';
import { ClosingRepository } from '../../../core/repository/closing-repository';
import { monthOf } from '../../../core/calc/date';
import {
  checkLeave,
  checkLoss,
  checkReacquire,
  checkRetirement,
  checkStandard,
  checkTransfer,
  Errors,
  LeaveInput,
  openQualification,
  StandardInput,
  checkNameChange,
  checkNumberChange,
} from '../../../core/calc/employee-edit';
import { calcEmployeeMonth, EmployeeMonthResult, findEffective, Masters } from '../../../core/calc/employee-month';
import { GradeRow, standardGradeError, suggestStandards } from '../../../core/calc/grade-suggest';
import { senToDisplayYen } from '../../../core/calc/premium-calculator';
import { ChangeLog, EmployeeDetail as Detail, EmployeeNumberTakenError, EmployeeRepository, HistoryConflictError } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { NgTemplateOutlet } from '@angular/common';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { ChildSupportRounding } from '../../../core/calc/monthly-premium';
import { parseNumberInput } from '../../../core/calc/half-width';
import { DateLabelPipe, YearMonthPipe } from '../../../core/ui/year-month.pipe';
import { dateLabel, yearMonthLabel } from '../../../core/calc/year-month';
import { NavigationHistory, screenLabel } from '../../../core/ui/navigation-history';
import { focusFormSoon } from '../../../core/ui/form-focus';
import {
  checkAssignmentDelete,
  checkAssignmentEdit,
  checkBirthDateChange,
  checkDatedEdit,
  checkLeaveOverlap,
  checkQualificationDelete,
  checkQualificationEdit,
  dependentsLeftOutside,
  checkStandardDelete,
  dependentMoves,
  officeIdsOf,
  QualificationEditInput,
  toQualificationEdit,
} from '../../../core/calc/history-edit';

type Mode =
  | null | 'retire' | 'loss' | 'reacquire' | 'transfer' | 'standard' | 'leave' | 'insuredType' | 'exemption' | 'exemptionEnd'
  | 'name' | 'employeeNumber' | 'dependent' | 'dependentRemove' | 'dependentExemption' | 'dependentExemptionEnd' | 'payrollGroup' | 'confirmStandard' | 'absence' | { leaveId: string } | { absenceId: string }
  | EditKind;

/** 登録した履歴を直す入力（直す行のIDは editingId） */
export type EditKind = 'eligibility' | 'birthDate' | 'qualificationEdit' | 'standardEdit' | 'dependentEdit' | 'assignmentEdit' | 'insuredTypeEdit' | 'payrollGroupEdit';

/** 削除できる履歴 */
export type DeleteKind = 'qualification' | 'standard' | 'dependent' | 'assignment' | 'insuredType' | 'payrollGroup' | 'leave' | 'absence' | 'exemption';

/** 画面の欄（カード）。入力フォームは、操作に関係するカードの中に出す */
type Card = 'qual' | 'standard' | 'leave' | 'family' | 'history' | 'log';
const CARDS: { id: Card; label: string }[] = [
  { id: 'qual', label: '資格・所属' },
  { id: 'standard', label: '標準報酬月額' },
  { id: 'leave', label: '休業・休職' },
  { id: 'family', label: '被扶養者・適用除外' },
  { id: 'history', label: '直近12か月の保険料' },
  { id: 'log', label: '変更の記録' },
];

/** 入力の種類 → フォームを出すカード */
export function cardOfMode(mode: Mode): Card | null {
  if (mode === null) return null;
  if (typeof mode === 'object') return 'leave';
  switch (mode) {
    case 'standard':
    case 'standardEdit':
    case 'confirmStandard':
      return 'standard';
    case 'leave':
    case 'absence':
      return 'leave';
    case 'dependent':
    case 'dependentEdit':
    case 'dependentRemove':
    case 'dependentExemption':
    case 'dependentExemptionEnd':
    case 'exemption':
    case 'exemptionEnd':
      return 'family';
    default:
      return 'qual';
  }
}

export const LOST_REASONS: Record<string, string> = {
  retirement: '退職',
  conditions: '加入の条件から外れた（労働時間の短縮など）',
  age75: '75歳到達',
  death: '死亡',
  reemployment: '退職後の継続再雇用',
  other: 'その他',
};

export const STANDARD_REASONS: Record<StandardInput['reason'], string> = {
  acquisition: '資格取得時決定',
  regular: '定時決定',
  revision: '随時改定',
  leaveEnd: '休業終了時改定',
};

/** 今日（日本時間）'YYYY-MM-DD' */
function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** 'YYYY-MM' の n か月前 */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** 金額の欄を読む（全角でもよい） */
const toAmount = (value: string): number | null => parseNumberInput(value);

/** 変更は保存できたが、変更の記録だけを残せなかったときに知らせに添える文 */
const LOG_FAILED = '（ただし、変更の記録を残せませんでした。「変更の記録」の欄には出ないので、誰がいつ何を変えたかを別に控えてください）';

@Component({
  imports: [RouterLink, NgTemplateOutlet, NoticeMessage, YearMonthPipe, DateLabelPipe, UsablePipe],
  selector: 'app-employee-detail',
  styleUrl: './employee-detail.scss',
  templateUrl: './employee-detail.html',
})
export class EmployeeDetail implements OnInit, HasUnsavedChanges {
  private readonly repo = inject(EmployeeRepository);
  private readonly confirm = inject(Confirm);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly maintenanceRepo = inject(MaintenanceRepository);
  private readonly filingRepo = inject(FilingRepository);
  private readonly closingRepo = inject(ClosingRepository);

  /**
   * 「← 元の画面へ戻る」の行き先（開く前の画面）。月次保険料一覧・要確認などから開いたときに、その画面へ戻れるようにする。
   * 前の画面が分からないとき（URL を直接開いたなど）は null で、従業員一覧へのリンクだけを出す
   */
  protected readonly back = (() => {
    const url = inject(NavigationHistory).previous();
    const label = url ? screenLabel(url) : null;
    if (!url || !label) return null;
    return { url: this.router.parseUrl(url), label: label === '従業員の詳細' ? '前の従業員の詳細' : label };
  })();
  /** 届出済みにした届出（産休・育休の取得者申出書の状態に使う） */
  protected readonly filedIds = signal<Set<string>>(new Set());

  /** 取得者申出書を届出済みにしたか */
  protected leaveFiled(leaveStartDate: string): boolean {
    const d = this.detail();
    return !!d && this.filedIds().has(leaveFilingId(d.id, { startDate: leaveStartDate }));
  }

  /** 取得者申出書を届出済みにする／未対応に戻す（届出の期限の一覧と同じ記録） */
  protected async toggleLeaveFiled(leaveStartDate: string): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const id = leaveFilingId(d.id, { startDate: leaveStartDate });
    this.saving.set(true);
    try {
      if (this.filedIds().has(id)) await this.filingRepo.unsetFiled(id);
      else {
        const officeId = [...d.assignments].filter((a) => a.validFrom <= leaveStartDate).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.officeId ?? null;
        await this.filingRepo.setFiled({ id, employeeId: d.id, kind: 'leave', trigger: leaveStartDate, officeId }, this.auth.user()?.uid ?? '');
      }
      this.filedIds.set(await this.filingRepo.loadFiledIds());
    } catch (e) {
      console.error(e);
      this.error.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- 誤登録の削除（管理者だけ。設計書 2.19） ----
  protected readonly isAdmin = computed(() => this.auth.isAdmin());
  protected readonly deleteError = signal<string | null>(null);

  protected async deleteMistaken(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const ok = await this.confirm.ask({
      title: '誤登録として削除しますか',
      message: `${d.employeeNumber} ${d.name}さんを、給与・賞与などと一緒に削除します。元に戻せません。`,
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    this.deleteError.set(null);
    try {
      await this.maintenanceRepo.deleteMistakenEmployee(d.id);
      await this.router.navigate(['/employees']);
    } catch (e) {
      console.error(e);
      const m = (e as { message?: string })?.message ?? '';
      this.deleteError.set(m && !m.startsWith('internal') ? m : '削除できませんでした。通信と、Cloud Functions が動いているかを確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly lostReasons = LOST_REASONS;
  protected readonly lostReasonKeys = Object.keys(LOST_REASONS).filter((k) => k !== 'retirement');
  protected readonly standardReasons = STANDARD_REASONS;
  protected readonly standardReasonKeys = Object.keys(STANDARD_REASONS) as StandardInput['reason'][];
  protected readonly insuredTypeLabel = INSURED_TYPE_LABEL;
  protected readonly insuredTypeKeys = Object.keys(INSURED_TYPE_LABEL) as InsuredType[];
  protected readonly insuredType = signal<InsuredType>('general');
  protected readonly payrollGroups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  protected readonly payrollGroupId = signal('');
  protected readonly groupLabel = groupLabel;
  protected groupName(id: string): string {
    return this.payrollGroups().find((g) => g.id === id)?.name ?? '（削除された区分）';
  }
  protected readonly exemptionLabel = EXEMPTION_LABEL;
  protected readonly exemptionTargets = EXEMPTION_TARGETS;
  protected readonly exemptionHint = EXEMPTION_DATE_HINT;
  protected readonly exemptionTypes = Object.keys(EXEMPTION_LABEL) as ExemptionType[];
  protected readonly exemptionForm = signal<ExemptionInput>({ type: 'care', startDate: '', endDate: '' });
  /** 非該当年月日を入れる適用除外のID */
  protected readonly editingExemptionId = signal<string | null>(null);
  protected readonly exemptionNotice = exemptionNotice;
  protected readonly dependentForm = signal<DependentInput>({ name: '', birthDate: '', certifiedDate: '' });
  protected readonly editingDependentId = signal<string | null>(null);
  protected readonly dependentDeadline = dependentReportDeadline;
  /** 氏名の変更の入力 */
  protected readonly nameForm = signal('');
  /** 社員番号の変更の入力と、ほかの人の社員番号（読み込み中は null） */
  protected readonly numberForm = signal('');
  private readonly otherNumbers = signal<string[] | null>(null);
  /** ほかの従業員の社員番号を読めなかった（重なりを確かめられないので、社員番号の変更を保存しない） */
  private readonly otherNumbersFailed = signal(false);
  protected readonly careExemptionLabel = careExemptionLabel;
  /** 被扶養者の介護保険の適用除外（追加・非該当年月日の登録）の入力 */
  protected readonly depExemptionForm = signal<DependentCareExemptionInput>({ startDate: '', endDate: '' });
  /** 非該当年月日を入れる期間の番号 */
  protected readonly editingDepExemptionIndex = signal<number | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly masters = signal<Masters | null>(null);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly rounding = signal<ChildSupportRounding>('combined');

  protected readonly mode = signal<Mode>(null);
  /** 直している履歴のID（EditKind のとき） */
  protected readonly editingId = signal<string | null>(null);
  /** 資格の期間の訂正の入力 */
  protected readonly qualForm = signal<QualificationEditInput>({ acquiredDate: '', lostReason: '', endDate: '' });
  /** 喪失の理由（訂正では退職も選べる） */
  protected readonly allLostReasonKeys = Object.keys(LOST_REASONS);
  /** 所属事業所の履歴を変えられるか（全担当だけ。特定の事業所の担当者は、ほかの事業所への所属を作れない） */
  protected readonly scopeAll = computed(() => this.auth.user()?.siScope === 'all');
  protected readonly cards = CARDS;
  /** 生年月日の欄の上限（今日より後は選べない） */
  protected readonly todayDate = today();
  /** 入力フォームを出すカード */
  protected readonly modeCard = computed(() => cardOfMode(this.mode()));

  protected goTo(card: Card): void {
    document.getElementById(`card-${card}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  protected readonly errors = signal<Errors>({});
  protected readonly saving = signal(false);
  /** 保存したあと、同じ入力（被扶養者の追加）をもう一度開く（家族を何人か続けて入れるとき） */
  protected readonly continueAfterSave = signal(false);
  protected readonly notice = signal<string | null>(null);

  // 入力欄
  protected readonly date = signal('');
  protected readonly reason = signal('');
  protected readonly officeId = signal('');
  protected readonly standardForm = signal<StandardInput>({
    validFrom: '',
    reason: 'revision',
    healthStandard: null,
    pensionStandard: null,
  });
  protected readonly remuneration = signal<number | null>(null);
  /** 資格取得時決定の報酬月額の内訳（入れたときは合計を報酬月額にする） */
  protected readonly breakdown = signal<RemunerationBreakdown>(EMPTY_BREAKDOWN);
  protected readonly breakdownKeys = BREAKDOWN_KEYS;
  protected readonly employmentTypeLabel = EMPLOYMENT_TYPE_LABEL;
  protected readonly candidateLabel = CANDIDATE_LABEL;
  protected readonly breakdownLabel = BREAKDOWN_LABEL;
  /** 標準報酬月額の追加で、二以上事業所勤務の項目を出すか */
  protected readonly multiOffice = signal(false);
  protected readonly leaveForm = signal<LeaveInput>({ type: 'childcare', startDate: '', endDate: '', workedDays: null });
  protected readonly absenceForm = signal<AbsenceInput>({ reason: 'sickness', startDate: '', endDate: '' });
  protected readonly absenceReasons = ABSENCE_REASONS;
  protected readonly absenceReasonLabel = ABSENCE_REASON_LABEL;
  protected readonly absencePeriod = absencePeriodLabel;

  protected readonly sortedQualifications = computed(() =>
    [...(this.detail()?.qualifications ?? [])].sort((a, b) => b.acquiredDate.localeCompare(a.acquiredDate)),
  );
  // ---- 同月得喪（設計書 2.27） ----
  protected readonly refundLabels = REFUND_LABEL;
  protected readonly refundKeys = REFUND_KEYS;
  /** 同月得喪の資格の期間と、その月の厚生年金の本人負担（還付されたら本人に返す額の目安） */
  protected readonly sameMonth = computed(() => {
    const d = this.detail();
    const m = this.masters();
    if (!d || !m) return [];
    return sameMonthCases(d.qualifications).map((c) => {
      const r = calcEmployeeMonth(d, m, c.yearMonth, this.rounding());
      const pension = r.premium?.pension ? Number(r.premium.pension.employeeYen) : null;
      return { ...c, pension };
    });
  });

  protected async setRefundStatus(qualificationId: string, status: RefundStatus): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.saving.set(true);
    try {
      const text = `同月得喪の還付の状態を「${REFUND_LABEL[status]}」にしました。`;
      const logged = await this.repo.withLog(d.id, text, () => this.repo.setRefundStatus(d.id, qualificationId, status));
      this.notice.set(`還付の状態を「${REFUND_LABEL[status]}」にしました。${logged ? '' : LOG_FAILED}`);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.error.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly sortedAssignments = computed(() =>
    [...(this.detail()?.assignments ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  protected readonly sortedStandards = computed(() =>
    [...(this.detail()?.standardHistory ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  protected readonly sortedAbsences = computed(() =>
    [...(this.detail()?.absences ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  );
  /** 今日、休職中か（見出しに「休職中」と出す） */
  protected readonly absentNow = computed(() => absentOn(this.detail()?.absences, today()));

  protected readonly sortedLeaves = computed(() =>
    [...(this.detail()?.leaves ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  );
  protected readonly sortedDependents = computed(() =>
    [...(this.detail()?.dependents ?? [])].sort((a, b) => b.certifiedDate.localeCompare(a.certifiedDate)),
  );
  protected readonly sortedExemptions = computed(() =>
    [...(this.detail()?.exemptions ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  );
  protected readonly sortedPayrollAssignments = computed(() =>
    [...(this.detail()?.payrollAssignments ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  /** 今日の支払区分 */
  /** 退職の入力中の見込み（資格喪失日・退職月の保険料・最終給与で控除する月数） */
  protected readonly retirePreview = computed(() => {
    const d = this.detail();
    const date = this.date();
    if (this.mode() !== 'retire' || !d || !isValidDate(date)) return null;
    const open = d.qualifications.find((q) => q.lostDate === null);
    if (!open || date < open.acquiredDate) return null;
    const g = payrollGroupAt(this.payrollGroups(), d.payrollAssignments, date);
    return retirementPreview(d.qualifications, date, g.deductionTiming, g.paidIn === 'sameMonth');
  });
  protected monthJa(ym: string): string {
    return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
  }

  protected readonly currentPayrollGroup = computed(() =>
    payrollGroupAt(this.payrollGroups(), this.detail()?.payrollAssignments, today()),
  );
  protected readonly sortedInsuredTypes = computed(() =>
    [...(this.detail()?.insuredTypes ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  /** 今日の被保険者区分 */
  protected readonly currentInsuredType = computed(() => insuredTypeAt(this.detail()?.insuredTypes, today()));
  /** 今日の時点で加入中か（資格取得日が今日以前の、喪失していない資格がある）。一覧の判定（その月に資格があるか）とそろえる */
  protected readonly isInsuredNow = computed(() => {
    const q = openQualification(this.detail()?.qualifications ?? []);
    return q !== null && q.acquiredDate <= today();
  });
  /** 資格取得日がまだ来ていない資格（加入予定）。退職・喪失・異動は、資格を取ってから登録する（取り消すときは「直す」「削除」） */
  protected readonly plannedQualification = computed(() => {
    const q = openQualification(this.detail()?.qualifications ?? []);
    return q !== null && q.acquiredDate > today() ? q : null;
  });

  /** 直近12か月の保険料（問い合わせの対応用） */
  protected readonly history = computed<EmployeeMonthResult[]>(() => {
    const d = this.detail();
    const m = this.masters();
    if (!d || !m) return [];
    const now = monthOf(today());
    return Array.from({ length: 12 }, (_, i) => calcEmployeeMonth(d, m, addMonths(now, -i), this.rounding()));
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      const [detail, masters, grades, settings, groups, filedIds] = await Promise.all([
        this.repo.loadDetail(id),
        this.masterRepo.loadMasters(),
        this.masterRepo.loadGrades(),
        this.settingsRepo.loadSettings(),
        this.settingsRepo.loadPayrollGroups(),
        this.filingRepo.loadFiledIds(),
      ]);
      this.filedIds.set(filedIds);
      this.rounding.set(settings.childSupportRounding);
      this.fullTime.set({ weeklyHours: settings.fullTimeWeeklyHours, monthlyDays: settings.fullTimeMonthlyDays });
      this.payrollGroups.set(groups);
      if (!detail) this.error.set('この従業員は見つかりませんでした。');
      this.detail.set(detail);
      this.masters.set(masters);
      // 変更の記録は、読めなくても画面は出す（記録を始める前の人・権限のない人もいるため）
      if (detail) {
        try {
          this.changeLogs.set(await this.repo.loadChangeLogs(detail.id));
          this.changeLogsFailed.set(false);
        } catch (e) {
          // 読み込めなかったときは「記録はありません」と出さず、読み込めなかったことを出す（記録がないように見えないように）
          console.error(e);
          this.changeLogs.set([]);
          this.changeLogsFailed.set(true);
        }
      }
      this.grades.set(grades);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  // ---- 表示用 ----
  protected officeName(id: string): string {
    return this.masters()?.offices.find((o) => o.id === id)?.name ?? id;
  }
  protected man(v: number): string {
    return `${(v / 10_000).toLocaleString('ja-JP')}万円`;
  }
  protected yen(v: bigint | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }
  protected employeeTotal(r: EmployeeMonthResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen([p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }
  protected employerTotal(r: EmployeeMonthResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen(
      [p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x ? senToDisplayYen(x.employerSen) : 0n), 0n),
    );
  }
  /** 二以上事業所勤務の按分の表示（自社 20万円／合計 30万円） */
  protected multiLabel(s: { ownRemuneration?: number | null; totalRemuneration?: number | null; selectedInsurerId?: string | null }): string {
    if (!s.ownRemuneration || !s.totalRemuneration) return '';
    const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    const insurer = this.masters()?.insurers.find((i) => i.id === s.selectedInsurerId)?.name ?? '';
    return `自社 ${man(s.ownRemuneration)}／合計 ${man(s.totalRemuneration)}${insurer ? `（${insurer}）` : ''}`;
  }
  protected historyNote(r: EmployeeMonthResult): string {
    if (r.status === 'notInsured') return '資格なし';
    if (r.status === 'missingRate') return '料率が未登録';
    if (r.status === 'noStandard') {
      // 導入時の登録などで、標準報酬月額がこの月より後から登録されている（導入前の月）
      const first = (this.detail()?.standardHistory ?? []).map((x) => x.validFrom).filter((v) => v > r.yearMonth).sort()[0];
      return first ? `導入前（標準報酬月額は${yearMonthLabel(first)}分から）` : '標準報酬月額が未登録';
    }
    if (r.premium?.exempt) return '休業免除';
    const notes = [exemptionNote(this.detail()?.exemptions ?? [], r.yearMonth)];
    if (r.premium?.careLabel === 'special') notes.push('特定被保険者（40〜64歳の被扶養者あり）');
    return notes.filter((n) => n).join('、');
  }
  /** 「通知書の値で確定」で直す履歴 */
  private readonly confirmId = signal<string | null>(null);
  protected readonly confirmTarget = computed(() => this.detail()?.standardHistory.find((s) => s.id === this.confirmId()) ?? null);

  protected openConfirm(id: string): void | Promise<void> {
    return this.guard(() => this.openConfirmNow(id));
  }
  private openConfirmNow(id: string): void {
    this.confirmId.set(id);
    this.openNow('confirmStandard');
    const t = this.confirmTarget();
    if (t) this.standardForm.set({ validFrom: t.validFrom, reason: 'revision', healthStandard: t.healthStandard, pensionStandard: t.pensionStandard });
  }

  protected setProvisional(v: boolean): void {
    this.standardForm.update((f) => ({ ...f, provisional: v }));
  }

  protected isLeaveEdit(id: string): boolean {
    const m = this.mode();
    return typeof m === 'object' && m !== null && 'leaveId' in m && m.leaveId === id;
  }

  /** 休職の追加・期間の変更の入力欄を開いているか */
  protected readonly absenceMode = computed(() => {
    const m = this.mode();
    return m === 'absence' || (typeof m === 'object' && m !== null && 'absenceId' in m);
  });

  protected setAbsence(key: keyof AbsenceInput, value: string): void {
    this.absenceForm.update((f) => ({ ...f, [key]: value }));
  }

  // ---- 入力 ----
  /**
   * 開いているフォームを閉じてよいか（入力を変えていれば、破棄してよいかを確かめる。設計書 3.0）。
   * 「やめる」と、別のフォームを開くとき（開くと今の入力が置き換わる）に使う
   */
  private guard(action: () => void): void | Promise<void> {
    return afterDiscardCheck(this.confirm, this.unsavedCount() > 0, action);
  }

  /** フォームを開く（入力中のフォームがあれば、先に確かめる） */
  protected open(mode: Exclude<Mode, null>): void | Promise<void> {
    return this.guard(() => this.openNow(mode));
  }

  /** フォームを開く（確かめずに。確かめたあとや、保存のすぐあとに使う） */
  private openNow(mode: Exclude<Mode, null>): void {
    this.errors.set({});
    this.editingId.set(null);
    this.notice.set(null);
    this.date.set('');
    this.reason.set('');
    this.officeId.set('');
    this.remuneration.set(null);
    this.breakdown.set(EMPTY_BREAKDOWN);
    const d = this.detail();
    const latest = d ? findEffective(d.standardHistory, '9999-12') : null;
    if (mode === 'standard' || mode === 'transfer' || mode === 'reacquire') {
      this.standardForm.set({
        validFrom: monthOf(today()),
        reason: 'revision',
        healthStandard: latest?.healthStandard ?? null,
        pensionStandard: latest?.pensionStandard ?? null,
        // 二以上事業所勤務の人は、前の値を初期値にする
        ownRemuneration: latest?.ownRemuneration ?? null,
        totalRemuneration: latest?.totalRemuneration ?? null,
        selectedInsurerId: latest?.selectedInsurerId ?? null,
      });
      this.multiOffice.set(!!(latest?.ownRemuneration && latest?.totalRemuneration));
    }
    if (mode === 'insuredType') this.insuredType.set(this.currentInsuredType());
    if (mode === 'payrollGroup') this.payrollGroupId.set(this.currentPayrollGroup().id);
    if (mode === 'name') this.nameForm.set(d?.name ?? '');
    if (mode === 'employeeNumber') {
      this.numberForm.set(d?.employeeNumber ?? '');
      // 重なりを確かめるため、ほかの人の社員番号を読む（一覧の読み込みの記憶を使うので、ふつうは問い合わせなし）
      this.otherNumbers.set(null);
      this.otherNumbersFailed.set(false);
      void this.repo
        .loadAll()
        .then((list) => this.otherNumbers.set(list.filter((e) => e.id !== d?.id).map((e) => e.employeeNumber)))
        // 読めなかったときは、重なっていないとみなさず、保存を止める（空の一覧で確かめると、重なりを見逃すため）
        .catch((e) => {
          console.error(e);
          this.otherNumbersFailed.set(true);
        });
    }
    if (mode === 'dependent') this.dependentForm.set({ name: '', birthDate: '', certifiedDate: '' });
    if (mode === 'exemption') this.exemptionForm.set({ type: 'care', startDate: '', endDate: '' });
    if (mode === 'leave') this.leaveForm.set({ type: 'childcare', startDate: '', endDate: '', workedDays: null });
    if (mode === 'absence') this.absenceForm.set({ reason: 'sickness', startDate: '', endDate: '' });
    if (typeof mode === 'object' && 'absenceId' in mode) {
      const a = d?.absences.find((x) => x.id === mode.absenceId);
      if (a) this.absenceForm.set({ reason: a.reason, startDate: a.startDate, endDate: a.endDate ?? '' });
    }
    if (typeof mode === 'object' && 'leaveId' in mode) {
      const l = d?.leaves.find((x) => x.id === mode.leaveId);
      if (l) this.leaveForm.set({ type: l.type, startDate: l.startDate, endDate: l.endDate ?? '', workedDays: l.workedDays ?? null });
    }
    this.mode.set(mode);
    this.snapshot.take();
    // 入力欄は操作に関係するカードの中に開くので、見えるところまで動かし、最初の欄にカーソルを置く
    focusFormSoon('app-employee-detail');
  }
  /** 資格を失う日に扶養から外れる被扶養者（まだ扶養中の人） */
  private openDependentIds(lostDate: string | null): string[] {
    if (!lostDate) return [];
    // 資格を失った日より後に扶養に入る予定の人は含めない（外れた日が扶養に入った日より前になってしまうため）
    return (this.detail()?.dependents ?? [])
      .filter((x) => x.certifiedDate <= lostDate && (x.removedDate === null || x.removedDate > lostDate))
      .filter((x) => dependentOutDate(x, lostDate) === null)
      .map((x) => x.id);
  }

  /** 被扶養者の追加・訂正のチェックに使う、本人の資格の期間・本人・ほかの被扶養者（editingId の人は除く） */
  private dependentContext(editingId: string | null): DependentContext {
    const d = this.detail()!;
    return {
      qualifications: d.qualifications,
      self: { name: d.name, birthDate: d.birthDate },
      others: d.dependents.filter((x) => x.id !== editingId),
    };
  }

  /** 今日の時点で扶養から外れていれば、その日と理由（75歳の誕生日を含む）。扶養中は null */
  protected outNow(x: Dependent): { date: string; reason: 'removed' | 'age75' } | null {
    const out = dependentOut(x);
    return out && out.date <= today() ? out : null;
  }

  protected openDependentRemove(id: string): void | Promise<void> {
    return this.guard(() => this.openDependentRemoveNow(id));
  }
  private openDependentRemoveNow(id: string): void {
    this.openNow('dependentRemove');
    this.editingDependentId.set(id);
  }

  /** 被扶養者の介護保険の適用除外を足す */
  protected openDependentExemption(id: string): void | Promise<void> {
    return this.guard(() => this.openDependentExemptionNow(id));
  }
  private openDependentExemptionNow(id: string): void {
    this.openNow('dependentExemption');
    this.editingDependentId.set(id);
    this.depExemptionForm.set({ startDate: '', endDate: '' });
  }

  /** 該当中の期間に、非該当年月日を入れる */
  protected openDependentExemptionEnd(id: string, index: number): void | Promise<void> {
    return this.guard(() => this.openDependentExemptionEndNow(id, index));
  }
  private openDependentExemptionEndNow(id: string, index: number): void {
    const x = this.detail()?.dependents.find((d) => d.id === id)?.careExemptions?.[index];
    if (!x) return;
    this.openNow('dependentExemptionEnd');
    this.editingDependentId.set(id);
    this.editingDepExemptionIndex.set(index);
    this.depExemptionForm.set({ startDate: x.startDate, endDate: '' });
  }

  protected setDepExemption(key: keyof DependentCareExemptionInput, value: string): void {
    this.depExemptionForm.update((f) => ({ ...f, [key]: value }));
  }

  protected setDependent(key: keyof DependentInput, value: string): void {
    this.dependentForm.update((f) => ({ ...f, [key]: value }));
  }

  protected dependentName(id: string | null): string {
    return this.detail()?.dependents.find((x) => x.id === id)?.name ?? '';
  }

  /** 適用除外の非該当年月日を入れる */
  protected openExemptionEnd(id: string): void | Promise<void> {
    return this.guard(() => this.openExemptionEndNow(id));
  }
  private openExemptionEndNow(id: string): void {
    const x = this.detail()?.exemptions.find((e) => e.id === id);
    if (!x) return;
    this.openNow('exemptionEnd');
    this.editingExemptionId.set(id);
    this.exemptionForm.set({ type: x.type, startDate: x.startDate, endDate: x.endDate ?? '' });
  }

  protected setExemption(key: keyof ExemptionInput, value: string): void {
    this.exemptionForm.update((f) => ({ ...f, [key]: value }));
  }

  /** 「やめる」：入力を変えていれば、破棄してよいかを確かめてから閉じる */
  protected cancel(): void | Promise<void> {
    return this.guard(() => this.mode.set(null));
  }

  // ---- 加入対象の判定の情報の更新（契約が変わったとき。設計書 2.24・3.1） ----
  protected readonly eligForm = signal<EligibilityInput>(EMPTY_ELIGIBILITY);
  private readonly eligRules = signal<EligibilityRule[]>([]);
  private readonly fullTime = signal({ weeklyHours: 40, monthlyDays: 20 });
  protected readonly employmentTypes = Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[];
  protected readonly hoursOptional = hoursOptional;
  /** 入力中の候補（足りなければ null） */
  protected readonly eligPreview = computed(() =>
    this.mode() === 'eligibility' && isValidDate(this.date())
      ? judgeEligibility(this.eligForm(), this.date(), this.eligRules(), this.fullTime())
      : null,
  );

  protected setElig<K extends keyof EligibilityInput>(key: K, value: EligibilityInput[K]): void {
    this.eligForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setEligNumber(key: 'weeklyHours' | 'monthlyDays', value: string): void {
    this.setElig(key, parseNumberInput(value));
  }

  /** 契約が変わったときに、加入対象の判定の情報を入れ直す（今の値を入れて開く） */
  protected openEligibility(): void | Promise<void> {
    return this.guard(() => void this.openEligibilityNow());
  }
  private async openEligibilityNow(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    if (!this.openEditNow('eligibility')) return;
    const el = d.eligibility;
    this.eligForm.set(el ? {
      employmentType: el.employmentType, weeklyHours: el.weeklyHours, monthlyDays: el.monthlyDays,
      contractEnd: el.contractEnd, renewalExpected: el.renewalExpected, isStudent: el.isStudent,
    } : EMPTY_ELIGIBILITY);
    this.date.set(today());
    this.snapshot.take();
    if (this.eligRules().length === 0) {
      try {
        this.eligRules.set(await this.masterRepo.loadEligibilityRules());
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** 新しい候補と、今の加入の状態が違うときの案内 */
  private eligibilityHint(r: { candidate: StoredEligibility['candidate']; insuredType: InsuredType | null }): string {
    const insured = this.isInsuredNow();
    if (r.candidate === 'none' && insured) return '今は加入中です。加入の条件から外れるなら、「退職以外の資格喪失」（理由：加入の条件から外れた）を登録してください。';
    if (r.candidate !== 'none' && !insured) return '今は加入していません。加入するなら、「加入を登録」で資格取得日を登録してください。';
    if (r.insuredType && insured && r.insuredType !== this.currentInsuredType())
      return `今の被保険者区分（${INSURED_TYPE_LABEL[this.currentInsuredType()]}）と違います。区分が変わるなら「被保険者区分を変える」で登録してください。`;
    return '今の加入の状態と同じです。';
  }

  protected setQual(key: keyof QualificationEditInput, value: string): void {
    this.qualForm.update((f) => ({ ...f, [key]: value }));
  }

  /** 登録した履歴を直す入力を開く（今の値を入れておく） */
  protected openEdit(kind: EditKind, id: string | null = null): void | Promise<void> {
    return this.guard(() => void this.openEditNow(kind, id));
  }
  private openEditNow(kind: EditKind, id: string | null = null): boolean {
    const d = this.detail();
    if (!d) return false;
    this.openNow(kind);
    this.editingId.set(id);
    if (kind === 'birthDate') this.date.set(d.birthDate);
    if (kind === 'qualificationEdit') {
      const q = d.qualifications.find((x) => x.id === id);
      if (q) this.qualForm.set(toQualificationEdit(q));
    }
    if (kind === 'standardEdit') {
      const s = d.standardHistory.find((x) => x.id === id);
      if (s) {
        this.standardForm.set({
          validFrom: s.validFrom,
          reason: (s.reason || 'revision') as StandardInput['reason'],
          healthStandard: s.healthStandard,
          pensionStandard: s.pensionStandard,
          ownRemuneration: s.ownRemuneration ?? null,
          totalRemuneration: s.totalRemuneration ?? null,
          selectedInsurerId: s.selectedInsurerId ?? null,
          provisional: s.provisional === true,
        });
        this.multiOffice.set(!!(s.ownRemuneration && s.totalRemuneration));
        this.remuneration.set(s.remuneration);
        const b = s.remunerationBreakdown;
        this.breakdown.set(b ? (Object.fromEntries(BREAKDOWN_KEYS.map((k) => [k, b[k] ?? null])) as RemunerationBreakdown) : EMPTY_BREAKDOWN);
      }
    }
    if (kind === 'dependentEdit') {
      const x = d.dependents.find((y) => y.id === id);
      if (x) {
        this.dependentForm.set({ name: x.name, birthDate: x.birthDate, certifiedDate: x.certifiedDate });
        this.date.set(x.removedDate ?? '');
      }
    }
    if (kind === 'assignmentEdit') {
      const a = d.assignments.find((x) => x.id === id);
      if (a) {
        this.date.set(a.validFrom);
        this.officeId.set(a.officeId);
      }
    }
    if (kind === 'insuredTypeEdit') {
      const t = d.insuredTypes.find((x) => x.id === id);
      if (t) {
        this.date.set(t.validFrom);
        this.insuredType.set(t.type);
      }
    }
    if (kind === 'payrollGroupEdit') {
      const a = d.payrollAssignments.find((x) => x.id === id);
      if (a) {
        this.date.set(a.validFrom);
        this.payrollGroupId.set(a.payrollGroupId);
      }
    }
    // 開いた時点の値を「変更なし」とする（やめる・画面を移るときの確認に使う）
    this.snapshot.take();
    return true;
  }

  // ---- 変更の記録（設計書 3.1） ----
  protected readonly changeLogs = signal<ChangeLog[]>([]);

  /** 変更の記録を読み込めなかった（「記録はありません」と区別して、読み込み直せるようにする） */
  protected readonly changeLogsFailed = signal(false);

  /** 変更の記録だけを読み込み直す */
  protected async reloadChangeLogs(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    try {
      this.changeLogs.set(await this.repo.loadChangeLogs(d.id));
      this.changeLogsFailed.set(false);
    } catch (e) {
      console.error(e);
      this.changeLogsFailed.set(true);
    }
  }

  /** 直す前の値（変更の記録に「直す前」として残す）。追加・登録のときは null */
  private beforeLabel(mode: Exclude<Mode, null>): string | null {
    const id = this.editingId();
    if (typeof mode === 'object') {
      if ('leaveId' in mode) return this.deleteTarget('leave', mode.leaveId)?.label ?? null;
      return this.deleteTarget('absence', mode.absenceId)?.label ?? null;
    }
    const kind: Partial<Record<string, DeleteKind>> = {
      standardEdit: 'standard', qualificationEdit: 'qualification', dependentEdit: 'dependent', assignmentEdit: 'assignment',
      insuredTypeEdit: 'insuredType', payrollGroupEdit: 'payrollGroup',
    };
    if (kind[mode] && id) return this.deleteTarget(kind[mode]!, id)?.label ?? null;
    if (mode === 'exemptionEnd') return this.deleteTarget('exemption', this.editingExemptionId() ?? '')?.label ?? null;
    if (mode === 'confirmStandard') return this.deleteTarget('standard', this.confirmId() ?? '')?.label ?? null;
    if (mode === 'eligibility') {
      const el = this.detail()?.eligibility;
      return el ? `${EMPLOYMENT_TYPE_LABEL[el.employmentType]}・週${el.weeklyHours ?? '―'}時間・月${el.monthlyDays ?? '―'}日・候補 ${CANDIDATE_LABEL[el.candidate]}` : null;
    }
    return null;
  }

  /** 変更の記録の日時（2026年11月5日 14:03） */
  protected logTime(at: Date | null): string {
    if (!at) return '（記録中）';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日 ${p(at.getHours())}:${p(at.getMinutes())}`;
  }

  /** 削除する履歴の説明（確認のダイアログに出す） */
  private deleteTarget(kind: DeleteKind, id: string): { label: string; block: string | null } | null {
    const d = this.detail();
    if (!d) return null;
    switch (kind) {
      case 'qualification': {
        const q = d.qualifications.find((x) => x.id === id);
        return q ? { label: `資格の期間（${dateLabel(q.acquiredDate)}〜${q.lostDate ? dateLabel(q.lostDate) : '加入中'}）`, block: checkQualificationDelete(d.qualifications) } : null;
      }
      case 'standard': {
        const s = d.standardHistory.find((x) => x.id === id);
        return s
          ? { label: `${yearMonthLabel(s.validFrom)}からの標準報酬月額（健保 ${this.man(s.healthStandard)}／厚年 ${this.man(s.pensionStandard)}）`, block: checkStandardDelete(d.standardHistory.length, d.qualifications.length > 0) }
          : null;
      }
      case 'dependent': {
        const x = d.dependents.find((y) => y.id === id);
        return x
          ? { label: `被扶養者の${x.name}さん（生年月日 ${dateLabel(x.birthDate)}・扶養に入った日 ${dateLabel(x.certifiedDate)}${x.removedDate ? `・外れた日 ${dateLabel(x.removedDate)}` : ''}）`, block: null }
          : null;
      }
      case 'assignment': {
        const a = d.assignments.find((x) => x.id === id);
        return a ? { label: `${dateLabel(a.validFrom)}からの所属（${this.officeName(a.officeId)}）`, block: checkAssignmentDelete(d.assignments, id) } : null;
      }
      case 'insuredType': {
        const t = d.insuredTypes.find((x) => x.id === id);
        return t ? { label: `${dateLabel(t.validFrom)}からの被保険者区分（${INSURED_TYPE_LABEL[t.type]}）`, block: null } : null;
      }
      case 'payrollGroup': {
        const a = d.payrollAssignments.find((x) => x.id === id);
        return a ? { label: `${dateLabel(a.validFrom)}からの支払区分（${this.groupName(a.payrollGroupId)}）`, block: null } : null;
      }
      case 'leave': {
        const l = d.leaves.find((x) => x.id === id);
        return l ? { label: `${l.type === 'maternity' ? '産前産後休業' : '育児休業'}（${dateLabel(l.startDate)}〜${l.endDate ? dateLabel(l.endDate) : '休業中'}）`, block: null } : null;
      }
      case 'absence': {
        const a = d.absences.find((x) => x.id === id);
        return a ? { label: `休職（${ABSENCE_REASON_LABEL[a.reason]}・${absencePeriodLabel(a)}）`, block: null } : null;
      }
      case 'exemption': {
        const x = d.exemptions.find((y) => y.id === id);
        return x ? { label: `適用除外（${EXEMPTION_LABEL[x.type]}・${dateLabel(x.startDate)}から）`, block: null } : null;
      }
    }
  }

  /** 削除する履歴の、始まりの日と終わりの日（影響を計算する月の範囲に使う） */
  private deleteSpan(kind: DeleteKind, id: string): { start: string; end: string | null } | null {
    const d = this.detail()!;
    switch (kind) {
      case 'qualification': { const q = d.qualifications.find((x) => x.id === id); return q ? { start: q.acquiredDate, end: q.lostDate } : null; }
      case 'standard': { const s = d.standardHistory.find((x) => x.id === id); return s ? { start: `${s.validFrom}-01`, end: null } : null; }
      case 'dependent': { const x = d.dependents.find((y) => y.id === id); return x ? { start: x.certifiedDate, end: x.removedDate } : null; }
      case 'assignment': { const a = d.assignments.find((x) => x.id === id); return a ? { start: a.validFrom, end: null } : null; }
      case 'insuredType': { const a = d.insuredTypes.find((x) => x.id === id); return a ? { start: a.validFrom, end: null } : null; }
      case 'payrollGroup': { const a = d.payrollAssignments.find((x) => x.id === id); return a ? { start: a.validFrom, end: null } : null; }
      case 'leave': { const l = d.leaves.find((x) => x.id === id); return l ? { start: l.startDate, end: l.endDate } : null; }
      case 'absence': { const a = d.absences.find((x) => x.id === id); return a ? { start: a.startDate, end: a.endDate } : null; }
      case 'exemption': { const x = d.exemptions.find((y) => y.id === id); return x ? { start: x.startDate, end: x.endDate } : null; }
    }
  }

  /** その履歴を除いた従業員（削除後の計算に使う） */
  private withoutRow(kind: DeleteKind, id: string): Detail {
    const d = this.detail()!;
    const drop = <T extends { id?: string }>(list: T[]) => list.filter((x) => x.id !== id);
    switch (kind) {
      case 'qualification': return { ...d, qualifications: drop(d.qualifications) };
      case 'standard': return { ...d, standardHistory: drop(d.standardHistory) };
      case 'dependent': return { ...d, dependents: drop(d.dependents) };
      case 'assignment': return { ...d, assignments: drop(d.assignments) };
      case 'insuredType': return { ...d, insuredTypes: drop(d.insuredTypes) };
      case 'payrollGroup': return { ...d, payrollAssignments: drop(d.payrollAssignments) };
      case 'leave': return { ...d, leaves: drop(d.leaves) };
      case 'absence': return { ...d, absences: drop(d.absences) };
      case 'exemption': return { ...d, exemptions: drop(d.exemptions) };
    }
  }

  /** 保険料が変わらない履歴の、何に使うかの説明 */
  private static readonly NO_PREMIUM_NOTE: Partial<Record<DeleteKind, string>> = {
    insuredType: '被保険者区分は、随時改定・定時決定の支払基礎日数の基準と届出に使います（削除後は、前の区分で判断します）。',
    payrollGroup: '支払区分は、保険料を控除する給与の月と、随時改定・定時決定の給与の計算期間に使います（削除後は、前の区分、なければ既定の区分で判断します）。',
    absence: '休職は、随時改定・定時決定の要確認と、控除不足の説明に使います。',
    dependent: '被扶養者は、保険料の額には関わりません（組合健保の特定被保険者の判定を除く）。',
  };

  /** 届出についての文（届出済みなら取消・訂正が要る。まだなら一覧から消える） */
  private deleteFilingNote(kind: DeleteKind, id: string): string {
    const d = this.detail()!;
    const filed = (fid: string) => this.filedIds().has(fid);
    const say = (name: string, fid: string) =>
      filed(fid) ? `届け出た「${name}」は、取消（訂正）の届出が必要です。` : `「${name}」をまだ届け出ていないなら、届出の一覧から消えます。`;
    switch (kind) {
      case 'leave': {
        const l = d.leaves.find((x) => x.id === id)!;
        return say(l.type === 'maternity' ? '産前産後休業取得者申出書' : '育児休業等取得者申出書', leaveFilingId(d.id, l));
      }
      case 'exemption': {
        const x = d.exemptions.find((y) => y.id === id)!;
        return say('適用除外の届出', filingId(d.id, 'exemption', `${x.startDate}_${x.type}`));
      }
      case 'dependent': {
        const x = d.dependents.find((y) => y.id === id)!;
        return say('被扶養者異動届', filingId(d.id, 'dependent', `${x.certifiedDate}_in_${x.name}`));
      }
      case 'qualification': {
        const q = d.qualifications.find((x) => x.id === id)!;
        return say('資格取得届', filingId(d.id, 'acquisition', q.acquiredDate)) + (q.lostDate ? say('資格喪失届', filingId(d.id, 'loss', q.lostDate)) : '');
      }
      case 'standard':
        return '決定通知書の額と違う登録を消すときは、届け出た算定基礎届・月額変更届の内容も確かめてください。';
      default:
        return '';
    }
  }

  /**
   * 削除の確認に出す、影響の文。確定済みの月を読めなかったときは null（影響を確かめられないので、削除しない）
   */
  private async deleteImpactText(kind: DeleteKind, id: string): Promise<string | null> {
    const d = this.detail();
    const m = this.masters();
    const span = d ? this.deleteSpan(kind, id) : null;
    if (!d || !m || !span) return '';
    const thisMonth = monthOf(today());
    // 影響を見る月：その履歴の始まりの月から、来月まで（終わりが来月より後なら、その月まで。さかのぼるのは5年まで）
    const from = [monthOf(span.start), addMonths(thisMonth, -60)].sort().at(-1)!;
    const to = [addMonths(thisMonth, 1), span.end ? monthOf(span.end) : ''].sort().at(-1)!;
    let closedByOffice: Record<string, string[]> = {};
    try {
      const officeIds = [...new Set(d.assignments.map((a) => a.officeId))];
      const lists = await Promise.all(officeIds.map((o) => this.closingRepo.closedMonthsOf(o)));
      closedByOffice = Object.fromEntries(officeIds.map((o, k) => [o, lists[k]]));
    } catch (e) {
      console.error(e);
      return null;
    }
    const impact = deleteImpact(d, this.withoutRow(kind, id), m, from, to, thisMonth, this.rounding(), closedByOffice);
    return deleteImpactMessage(impact, thisMonth, EmployeeDetail.NO_PREMIUM_NOTE[kind] ?? '', this.deleteFilingNote(kind, id));
  }

  /**
   * 登録した履歴を消す（誤って登録したもの）。確認してから消す。
   * 消すと計算できなくなる場合は、理由を知らせて止める
   */
  protected async deleteRow(kind: DeleteKind, id: string): Promise<void> {
    const d = this.detail();
    const t = this.deleteTarget(kind, id);
    if (!d || !t) return;
    if (t.block) {
      this.notice.set(`${t.label}は削除できません。${t.block}`);
      return;
    }
    // 削除の前と後で月ごとの保険料を計算し直し、影響する月・保険料・確定済みの月・届出・削除後の今月の状態を出す
    this.saving.set(true);
    const impact = await this.deleteImpactText(kind, id).finally(() => this.saving.set(false));
    if (impact === null) {
      // 確定済みの月を確かめられないと、確定した月への影響が分からないので、削除しない
      this.notice.set(`確定済みの月を読み込めなかったため、${t.label}を削除しませんでした。通信と権限を確かめて、もう一度削除してください。`);
      return;
    }
    const ok = await this.confirm.ask({
      title: '削除しますか',
      message:
        `${t.label}を削除します。元に戻せません。` +
        impact +
        (kind === 'assignment' ? '異動のときに一緒に登録した標準報酬月額は残ります（不要なら標準報酬月額の欄で削除してください）。' : ''),
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      const remove = async () => { switch (kind) {
        case 'qualification': await this.repo.deleteQualification(d.id, id); break;
        case 'standard': await this.repo.deleteStandard(d.id, id); break;
        case 'dependent': await this.repo.deleteDependent(d.id, id); break;
        case 'assignment': await this.repo.deleteAssignment(d.id, id, officeIdsOf(d.assignments.filter((a) => a.id !== id))); break;
        case 'insuredType': await this.repo.deleteInsuredType(d.id, id); break;
        case 'payrollGroup': await this.repo.deletePayrollAssignment(d.id, id); break;
        case 'leave': await this.repo.deleteLeave(d.id, id); break;
        case 'absence': await this.repo.deleteAbsence(d.id, id); break;
        case 'exemption': await this.repo.deleteExemption(d.id, id); break;
      } };
      // 削除と、その変更の記録を同じ書き込みで残す
      const logged = await this.repo.withLog(d.id, `${t.label}を削除`, remove);
      this.mode.set(null);
      this.notice.set(`${t.label}を削除しました。${logged ? '' : LOG_FAILED}`);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.notice.set('削除できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  /** 壊れた休業・被扶養者のデータを消す（計算に使っていないので、削除しても保険料は変わらない） */
  protected async deleteBroken(kind: 'leave' | 'dependent', id: string, text: string): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const label = kind === 'leave' ? '休業' : '被扶養者';
    const ok = await this.confirm.ask({
      title: `壊れた${label}のデータを削除`,
      message: `壊れた${label}のデータ（${text}）を削除します。元に戻せません。このデータは計算に使っていないので、保険料は変わりません。実際にある${label}なら、削除のあとで登録し直してください。`,
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      const remove = () => (kind === 'leave' ? this.repo.deleteLeave(d.id, id) : this.repo.deleteDependent(d.id, id));
      const logged = await this.repo.withLog(d.id, `壊れた${label}のデータを削除（${text}）`, remove);
      this.notice.set(`壊れた${label}のデータを削除しました。${logged ? '' : LOG_FAILED}`);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.notice.set('削除できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  /** 開いているフォームの入力（画面を移る前の確認に使う） */
  private readonly snapshot = new FormSnapshot(() => [
    this.date(), this.reason(), this.officeId(), this.standardForm(), this.remuneration(), this.breakdown(), this.multiOffice(),
    this.leaveForm(), this.absenceForm(), this.exemptionForm(), this.dependentForm(), this.depExemptionForm(),
    this.insuredType(), this.payrollGroupId(), this.nameForm(), this.numberForm(), this.qualForm(), this.eligForm(),
  ]);
  /** 画面を移る前の確認に使う（unsavedChangesGuard）。開いているフォームで入力を変えていれば1件 */
  unsavedCount(): number {
    return this.mode() !== null && this.snapshot.changed() ? 1 : 0;
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }

  protected setStandard(key: 'healthStandard' | 'pensionStandard', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: toAmount(value) }));
  }
  protected setMultiAmount(key: 'ownRemuneration' | 'totalRemuneration', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: toAmount(value) }));
  }
  protected setSelectedInsurer(value: string): void {
    this.standardForm.update((f) => ({ ...f, selectedInsurerId: value || null }));
  }
  protected setStandardText(key: 'validFrom' | 'reason', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setRemuneration(value: string): void {
    this.remuneration.set(toAmount(value));
  }
  protected setBreakdown(key: BreakdownKey, value: string): void {
    const b = { ...this.breakdown(), [key]: toAmount(value) };
    this.breakdown.set(b);
    this.remuneration.set(breakdownTotal(b));
  }
  /** 履歴の表に出す内訳 */
  protected breakdownText(b: Record<BreakdownKey, number> | null | undefined): string {
    if (!b) return '';
    return BREAKDOWN_KEYS.filter((k) => b[k] > 0).map((k) => `${BREAKDOWN_LABEL[k]} ${b[k].toLocaleString('ja-JP')}`).join('／');
  }
  protected setLeave(key: 'type' | 'startDate' | 'endDate', value: string): void {
    // 産前産後休業にしたら、就業した日数を消す（産休では入れられず、欄も隠れるので、残すとエラーが見えないまま保存できない）
    this.leaveForm.update((f) => ({ ...f, [key]: value, ...(key === 'type' && value === 'maternity' ? { workedDays: null } : {}) }));
  }
  protected setWorkedDays(value: string): void {
    this.leaveForm.update((f) => ({ ...f, workedDays: parseNumberInput(value) }));
  }

  /** 報酬月額から標準報酬月額を入れる */
  protected suggest(): void {
    const d = this.detail();
    const r = this.remuneration();
    const ym = this.standardForm().validFrom || monthOf(today());
    if (!d || r === null || !(r > 0)) {
      this.errors.set({ remuneration: '先に報酬月額を入力してください' });
      return;
    }
    const s = suggestStandards(r, this.grades(), ym, d.birthDate);
    if (!s) {
      this.errors.set({ remuneration: 'この月に使える等級表が登録されていません' });
      return;
    }
    this.errors.set({});
    this.standardForm.update((f) => ({ ...f, healthStandard: s.healthStandard, pensionStandard: s.pensionStandard }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const d = this.detail();
    const mode = this.mode();
    if (!d || mode === null) return;
    const open = d.qualifications.find((q) => q.lostDate === null);

    let errors: Errors = {};
    let action: (() => Promise<void>) | null = null;
    let message = '';
    /** 直したあとの値（変更の記録に「直す前」と並べて残す） */
    let after: string | null = null;

    if (mode === 'retire') {
      const r = checkRetirement(d.qualifications, this.date());
      errors = r.errors;
      const deps = this.openDependentIds(r.lostDate);
      action = () => this.repo.closeQualification(d.id, open!.id, r.lostDate!, 'retirement', deps);
      message = `退職を登録しました（資格喪失日 ${dateLabel(r.lostDate)}）。${deps.length ? `被扶養者${deps.length}人も同じ日に扶養から外れます。` : ''}`;
    } else if (mode === 'loss') {
      errors = checkLoss(d.qualifications, this.date(), this.reason());
      const deps = this.openDependentIds(this.date());
      action = () => this.repo.closeQualification(d.id, open!.id, this.date(), this.reason(), deps);
      message = `資格の喪失を登録しました。${deps.length ? `被扶養者${deps.length}人も同じ日に扶養から外れます。` : ''}`;
    } else if (mode === 'reacquire') {
      // 資格と、資格取得時決定の標準報酬月額を一緒に登録する（資格だけ登録して標準報酬月額を忘れると、保険料を計算できないため）
      const f = this.standardForm();
      const date = this.date();
      errors = checkReacquire(d.qualifications, date, d.birthDate);
      if (!errors['acquiredDate'])
        errors = {
          ...errors,
          ...checkStandard(
            d.standardHistory.map((s) => s.validFrom),
            { ...f, validFrom: monthOf(date), reason: 'acquisition', ownRemuneration: null, totalRemuneration: null, selectedInsurerId: null },
            this.grades(),
          ),
        };
      action = () => this.repo.addQualification(d.id, date, { healthStandard: f.healthStandard!, pensionStandard: f.pensionStandard! });
      message =
        `${d.qualifications.length ? '再加入' : '加入'}を登録しました（資格取得日 ${dateLabel(date)}・${yearMonthLabel(monthOf(date))}分からの標準報酬月額 健保 ${this.man(f.healthStandard ?? 0)}／厚年 ${this.man(f.pensionStandard ?? 0)}、資格取得時決定）。` +
        '資格取得届を届け出てください。';
    } else if (mode === 'transfer') {
      const f = this.standardForm();
      errors = {
        ...checkTransfer(d.assignments, this.date(), this.officeId()),
        ...checkStandard(
          d.standardHistory.map((s) => s.validFrom),
          { ...f, validFrom: this.date() ? monthOf(this.date()) : '' },
          this.grades(),
        ),
      };
      action = () =>
        this.repo.addTransfer(d.id, this.date(), this.officeId(), {
          healthStandard: f.healthStandard!,
          pensionStandard: f.pensionStandard!,
        });
      message = `${this.officeName(this.officeId())}への異動を登録しました。`;
    } else if (mode === 'standard') {
      const raw = this.standardForm();
      // 二以上事業所勤務でなければ、按分の項目は空にする（Firestore に undefined は書けない）
      const f = this.multiOffice()
        ? { ...raw, ownRemuneration: raw.ownRemuneration ?? null, totalRemuneration: raw.totalRemuneration ?? null, selectedInsurerId: raw.selectedInsurerId ?? null }
        : { ...raw, ownRemuneration: null, totalRemuneration: null, selectedInsurerId: null };
      errors = checkStandard(d.standardHistory.map((s) => s.validFrom), f, this.grades(), d.qualifications);
      // 資格取得時決定で内訳を1つでも入れたら、内訳をチェックして一緒に保存する
      const b = this.breakdown();
      const useBreakdown = f.reason === 'acquisition' && BREAKDOWN_KEYS.some((k) => b[k] !== null);
      if (useBreakdown) errors = { ...errors, ...checkBreakdown(b) };
      action = () => this.repo.addStandard(d.id, f, this.remuneration(), useBreakdown ? b : null);
      message = `${yearMonthLabel(f.validFrom)}分からの標準報酬月額を登録しました。`;
    } else if (mode === 'standardEdit') {
      const raw = this.standardForm();
      const id = this.editingId()!;
      const f = this.multiOffice()
        ? { ...raw, ownRemuneration: raw.ownRemuneration ?? null, totalRemuneration: raw.totalRemuneration ?? null, selectedInsurerId: raw.selectedInsurerId ?? null }
        : { ...raw, ownRemuneration: null, totalRemuneration: null, selectedInsurerId: null };
      errors = checkStandard(d.standardHistory.filter((s) => s.id !== id).map((s) => s.validFrom), f, this.grades(), d.qualifications);
      const b = this.breakdown();
      const useBreakdown = f.reason === 'acquisition' && BREAKDOWN_KEYS.some((k) => b[k] !== null);
      if (useBreakdown) errors = { ...errors, ...checkBreakdown(b) };
      action = () => this.repo.updateStandard(d.id, id, f, this.remuneration(), useBreakdown ? b : null);
      message = `${yearMonthLabel(f.validFrom)}分からの標準報酬月額を直しました。確定済みの月に関わるときは、差額の画面にさかのぼる差額が出ます。`;
      after = `${yearMonthLabel(f.validFrom)}からの標準報酬月額（健保 ${this.man(f.healthStandard ?? 0)}／厚年 ${this.man(f.pensionStandard ?? 0)}）`;
    } else if (mode === 'eligibility') {
      const f = this.eligForm();
      const date = this.date();
      errors = isValidDate(date) ? checkEligibilityInput(f, date, '変わった日') : { eligibilityDate: '契約が変わった日を正しく入力してください' };
      const r = isValidDate(date) ? judgeEligibility(f, date, this.eligRules(), this.fullTime()) : null;
      if (Object.keys(errors).length === 0 && !r) errors = { eligibilityDate: '判定できませんでした。所定労働時間・日数を入れてください（判定の基準が登録されていないときは、運営者に確かめてください）' };
      const stored: StoredEligibility | null = r ? { ...f, candidate: r.candidate, reasons: r.reasons, changedDate: date } : null;
      action = () => this.repo.updateEligibility(d.id, stored!);
      message = r ? `加入対象の判定を更新しました（候補：${CANDIDATE_LABEL[r.candidate]}）。${this.eligibilityHint(r)}` : '';
    } else if (mode === 'birthDate') {
      const first = [...d.qualifications].map((q) => q.acquiredDate).sort()[0] ?? null;
      errors = checkBirthDateChange(d.birthDate, this.date(), today(), first, d.qualifications.map((q) => q.acquiredDate));
      const value = this.date();
      action = () => this.repo.updateBirthDate(d.id, value);
      message = `生年月日を${dateLabel(d.birthDate)}から${dateLabel(value)}に直しました。年齢による保険料の切り替え（40・65・70・75歳）は、新しい生年月日で計算し直します。`;
    } else if (mode === 'qualificationEdit') {
      const id = this.editingId()!;
      const before = d.qualifications.find((q) => q.id === id)!;
      const f = this.qualForm();
      const r = checkQualificationEdit(d.qualifications, id, f, d.birthDate);
      errors = r.errors;
      // 資格の期間を直すと、扶養に入った日が本人の資格の期間の外になる被扶養者がいれば止める（被扶養者の登録と同じ決まり）
      if (!errors['acquiredDate'] && !errors['endDate']) {
        const next = d.qualifications.map((q) => (q.id === id ? { acquiredDate: f.acquiredDate, lostDate: r.lostDate } : q));
        const outside = dependentsLeftOutside(d.dependents, d.qualifications, next);
        if (outside.length > 0)
          errors = {
            ...errors,
            acquiredDate: `${outside.map((x) => `${x.name}さん（扶養に入った日 ${dateLabel(x.certifiedDate)}）`).join('・')}の扶養に入った日が、資格の期間の外になります。先に被扶養者の扶養に入った日を直してください`,
          };
      }
      const moves = dependentMoves(d.dependents, before.lostDate, r.lostDate);
      // 外れた日を合わせると、扶養に入った日より前になる被扶養者がいれば止める（外れた日が扶養に入った日より前のデータはルールでも入らない）
      const early = moves
        .map((m) => ({ m, x: d.dependents.find((y) => y.id === m.id)! }))
        .find(({ m, x }) => m.removedDate !== null && m.removedDate < x.certifiedDate);
      if (early && !errors['lostDate'])
        errors = { ...errors, lostDate: `${early.x.name}さんが扶養に入った日（${dateLabel(early.x.certifiedDate)}）より前になります。先に${early.x.name}さんの扶養の期間を直してください` };
      action = () => this.repo.updateQualification(d.id, id, { acquiredDate: f.acquiredDate, lostDate: r.lostDate, lostReason: f.lostReason || null }, moves);
      message =
        (before.lostDate && !r.lostDate ? '退職（資格喪失）を取り消し、加入中に戻しました。' : '資格の期間を直しました。') +
        (moves.length ? `同じ日に扶養から外れていた被扶養者${moves.length}人も${r.lostDate ? '外れた日を合わせました' : '扶養に戻しました'}。` : '') +
        '届け出た内容と違うときは、資格取得届・資格喪失届の訂正（取消）も確かめてください。';
      after = `資格の期間（${dateLabel(f.acquiredDate)}〜${r.lostDate ? dateLabel(r.lostDate) : '加入中'}）`;
    } else if (mode === 'dependentEdit') {
      const id = this.editingId()!;
      const f = this.dependentForm();
      const removed = this.date();
      errors = checkDependent(f, today(), this.dependentContext(id));
      if (removed) {
        const x = d.dependents.find((y) => y.id === id)!;
        errors = { ...errors, ...checkRemoval({ ...x, birthDate: f.birthDate, certifiedDate: f.certifiedDate }, removed, today()) };
      }
      action = () => this.repo.updateDependent(d.id, id, { ...f, removedDate: removed || null });
      message = `被扶養者（${f.name.trim()}さん）を直しました。`;
      after = `被扶養者の${f.name.trim()}さん（生年月日 ${dateLabel(f.birthDate)}・扶養に入った日 ${dateLabel(f.certifiedDate)}${removed ? `・外れた日 ${dateLabel(removed)}` : ''}）`;
    } else if (mode === 'assignmentEdit') {
      const id = this.editingId()!;
      const input = { validFrom: this.date(), officeId: this.officeId() };
      errors = checkAssignmentEdit(d.assignments, id, input);
      const officeIds = officeIdsOf(d.assignments.map((a) => (a.id === id ? input : a)));
      action = () => this.repo.updateAssignment(d.id, id, input, officeIds);
      message = `${dateLabel(input.validFrom)}からの所属（${this.officeName(input.officeId)}）に直しました。`;
    } else if (mode === 'insuredTypeEdit') {
      const id = this.editingId()!;
      const input = { validFrom: this.date(), type: this.insuredType() };
      errors = checkDatedEdit(d.insuredTypes.filter((x) => x.id !== id), input.validFrom, 'insuredTypeDate', '区分');
      action = () => this.repo.updateInsuredType(d.id, id, input);
      message = `${dateLabel(input.validFrom)}からの被保険者区分（${INSURED_TYPE_LABEL[input.type]}）に直しました。`;
    } else if (mode === 'payrollGroupEdit') {
      const id = this.editingId()!;
      const input = { validFrom: this.date(), payrollGroupId: this.payrollGroupId() };
      errors = checkDatedEdit(d.payrollAssignments.filter((x) => x.id !== id), input.validFrom, 'payrollDate', '支払区分');
      if (!input.payrollGroupId) errors = { ...errors, payrollDate: '支払区分を選んでください' };
      else if (
        this.payrollGroups().find((g) => g.id === input.payrollGroupId)?.archived &&
        d.payrollAssignments.find((x) => x.id === id)?.payrollGroupId !== input.payrollGroupId
      )
        errors = { ...errors, payrollDate: `支払区分「${this.groupName(input.payrollGroupId)}」は使わないにしているため、選べません` };
      action = () => this.repo.updatePayrollAssignment(d.id, id, input);
      message = `${dateLabel(input.validFrom)}からの支払区分（${this.groupName(input.payrollGroupId)}）に直しました。`;
    } else if (mode === 'name') {
      const name = this.nameForm().trim();
      const before = d.name;
      errors = checkNameChange(before, name);
      action = () => this.repo.updateName(d.id, name);
      message =
        `氏名を「${before}」から「${name}」に変えました。` +
        '協会けんぽ・厚生年金は、マイナンバーと基礎年金番号が結びついていれば届出は要りません（結びついていない人・協会けんぽの健康保険だけに入っている人は、被保険者氏名変更（訂正）届を速やかに出します）。' +
        '組合健保の人は、その健康保険組合に届出が要るかを確かめてください。被扶養者の氏名が変わったときは被扶養者（異動）届です。';
    } else if (mode === 'employeeNumber') {
      const before = d.employeeNumber;
      const others = this.otherNumbers();
      const r = checkNumberChange(before, this.numberForm(), others ?? []);
      errors = this.otherNumbersFailed()
        ? { employeeNumber: 'ほかの従業員の社員番号を読み込めなかったため、重なっていないかを確かめられません。通信を確かめ、開き直してからもう一度保存してください' }
        : others === null
          ? { employeeNumber: 'ほかの従業員の社員番号を読み込んでいます。少し待ってから、もう一度保存してください' }
          : r.errors;
      action = () => this.repo.updateEmployeeNumber(d.id, r.number, before);
      message = `社員番号を「${before}」から「${r.number}」に変えました。給与ソフトのCSVを取り込むときは、新しい社員番号で照らし合わせます。`;
    } else if (mode === 'dependent') {
      const f = this.dependentForm();
      errors = checkDependent(f, today(), this.dependentContext(null));
      action = () => this.repo.addDependent(d.id, f);
      message = `被扶養者（${f.name.trim()}さん）を登録しました。被扶養者異動届：${dateLabel(dependentReportDeadline(f.certifiedDate))}まで（5日以内）`;
    } else if (mode === 'dependentRemove') {
      const id = this.editingDependentId()!;
      const dep = d.dependents.find((x) => x.id === id)!;
      errors = checkRemoval(dep, this.date(), today());
      action = () => this.repo.removeDependent(d.id, id, this.date());
      message = `${dep.name}さんを${dateLabel(this.date())}に扶養から外しました。被扶養者異動届：${dateLabel(dependentReportDeadline(this.date()))}まで（5日以内）`;
    } else if (mode === 'dependentExemption' || mode === 'dependentExemptionEnd') {
      const id = this.editingDependentId()!;
      const dep = d.dependents.find((x) => x.id === id)!;
      const f = this.depExemptionForm();
      const index = mode === 'dependentExemption' ? null : this.editingDepExemptionIndex();
      errors = checkDependentCareExemption(dep, f, index, today());
      if (mode === 'dependentExemptionEnd' && f.endDate === '') errors = { ...errors, endDate: '非該当年月日を入力してください' };
      action = () => this.repo.setDependentCareExemptions(d.id, id, withCareExemption(dep, f, index));
      const n = exemptionNotice('care', f.startDate);
      message =
        mode === 'dependentExemption'
          ? `${dep.name}さんの介護保険の適用除外を登録しました。${n.name}：${n.deadline}`
          : `${dep.name}さんの介護保険の適用除外に、非該当年月日（${dateLabel(f.endDate)}）を登録しました。${n.name}：${n.deadline}`;
    } else if (mode === 'exemption') {
      const f = this.exemptionForm();
      errors = checkExemption(d.exemptions, f);
      action = () => this.repo.addExemption(d.id, f);
      const n = exemptionNotice(f.type, f.startDate);
      message = `適用除外（${EXEMPTION_LABEL[f.type]}）を登録しました。${n.name}：${n.deadline}`;
    } else if (mode === 'exemptionEnd') {
      const f = this.exemptionForm();
      const id = this.editingExemptionId()!;
      errors = checkExemption(d.exemptions, f, id);
      action = () => this.repo.updateExemption(d.id, id, f);
      const n = exemptionNotice(f.type, f.startDate);
      message = `適用除外（${EXEMPTION_LABEL[f.type]}）を直しました。${f.endDate ? `非該当年月日は${dateLabel(f.endDate)}です。` : ''}${n.name}：${n.deadline}`;
    } else if (mode === 'payrollGroup') {
      const gid = this.payrollGroupId();
      const date = this.date();
      errors = checkPayrollAssignment(d.payrollAssignments, date, gid, isValidDate(date) ? payrollGroupAt(this.payrollGroups(), d.payrollAssignments, date).id : '');
      // 使わないにした区分は新しく割り当てられない（ルールでも拒否する。開いたときは今の区分が選ばれているので、使わない区分のままのことがある）
      if (!errors['payrollDate'] && this.payrollGroups().find((g) => g.id === gid)?.archived)
        errors = { ...errors, payrollDate: `支払区分「${this.groupName(gid)}」は使わないにしているため、新しく割り当てられません。ほかの区分を選んでください` };
      action = () => this.repo.addPayrollAssignment(d.id, { validFrom: date, payrollGroupId: gid });
      message = `${dateLabel(date)}から支払区分を「${this.payrollGroups().find((g) => g.id === gid)?.name ?? ''}」に変えました。`;
    } else if (mode === 'insuredType') {
      const t = this.insuredType();
      const date = this.date();
      if (!isValidDate(date)) errors = { insuredTypeDate: '変わった日を正しく入力してください' };
      else if (d.insuredTypes.some((x) => x.validFrom === date)) errors = { insuredTypeDate: 'この日からの区分はすでに登録されています' };
      else if (t === insuredTypeAt(d.insuredTypes, date)) errors = { insuredTypeDate: 'この日の区分と同じです' };
      action = () => this.repo.addInsuredType(d.id, { validFrom: date, type: t });
      message = `${dateLabel(date)}から${INSURED_TYPE_LABEL[t]}に変えました。`;
    } else if (mode === 'confirmStandard') {
      const t = this.confirmTarget();
      const f = this.standardForm();
      errors = {};
      for (const k of ['healthStandard', 'pensionStandard'] as const) {
        const v = f[k];
        if (v === null || !Number.isInteger(v) || v <= 0 || v % 1000 !== 0) errors[k] = '標準報酬月額を1,000円単位の円で入力してください';
        else if (t) {
          const g = standardGradeError(this.grades(), t.validFrom, k === 'healthStandard' ? 'health' : 'pension', v);
          if (g) errors[k] = g;
        }
      }
      action = () => this.repo.confirmStandard(d.id, t!.id, f.healthStandard!, f.pensionStandard!);
      message = `${yearMonthLabel(t?.validFrom)}分からの標準報酬月額を、通知書の値で確定しました。`;
      after = `${yearMonthLabel(t?.validFrom)}からの標準報酬月額（健保 ${this.man(f.healthStandard ?? 0)}／厚年 ${this.man(f.pensionStandard ?? 0)}）`;
    } else if (mode === 'leave') {
      const f = this.leaveForm();
      errors = { ...checkLeaveOverlap(d.leaves, f.startDate, f.endDate), ...checkLeave(f, d.qualifications, today()) };
      action = () => this.repo.addLeave(d.id, f);
      message = '休業を登録しました。';
    } else if (mode === 'absence' || 'absenceId' in mode) {
      const f = this.absenceForm();
      const id = mode === 'absence' ? null : mode.absenceId;
      errors = checkAbsence(f, d.absences.filter((a) => a.id !== id));
      action = () => (id ? this.repo.updateAbsence(d.id, id, f) : this.repo.addAbsence(d.id, f));
      message = id ? '休職の期間を変更しました。' : '休職を登録しました。保険料は通常どおりかかります（免除はありません）。';
    } else {
      const f = this.leaveForm();
      errors = { ...checkLeaveOverlap(d.leaves.filter((l) => l.id !== mode.leaveId), f.startDate, f.endDate), ...checkLeave(f, d.qualifications, today()) };
      action = () => this.repo.updateLeave(d.id, mode.leaveId, f);
      message = '休業を直しました。保険料の免除は、直した期間で計算し直します。';
      after = `${f.type === 'maternity' ? '産前産後休業' : '育児休業'}（${dateLabel(f.startDate)}〜${f.endDate ? dateLabel(f.endDate) : '休業中'}${f.workedDays ? `・就業 ${f.workedDays}日` : ''}）`;
    }

    this.errors.set(errors);
    if (Object.keys(errors).length > 0 || !action) return;
    const before = this.beforeLabel(mode);
    this.saving.set(true);
    try {
      // 登録・訂正と、その変更の記録（直す前の値つき）を同じ書き込みで残す
      const logged = await this.repo.withLog(d.id, before ? `${message}（直す前：${before}${after ? `／直したあと：${after}` : ''}）` : message, action);
      const again = this.continueAfterSave() && mode === 'dependent';
      this.continueAfterSave.set(false);
      this.mode.set(null);
      if (again) this.openNow('dependent');
      this.notice.set((again ? `${message} 続けて次の人を入れてください。` : message) + (logged ? '' : LOG_FAILED));
      await this.reload();
    } catch (e) {
      console.error(e);
      if (e instanceof HistoryConflictError) {
        // 保存の直前に読み直した履歴と重なった。最新の履歴を出して、入力はそのまま残す
        this.errors.set({ [e.field]: e.message });
        await this.reload().catch(() => undefined);
        return;
      }
      this.errors.set(
        e instanceof EmployeeNumberTakenError
          ? { employeeNumber: 'この社員番号はほかの従業員が使っています（ほかの担当者が先に登録したか、担当外の事業所の人が使っています）' }
          : { form: '保存できませんでした。権限と通信を確かめてください。' },
      );
    } finally {
      this.saving.set(false);
    }
  }
}
