// 従業員の詳細（設計書 3.1）：資格・所属事業所・標準報酬月額・休業の履歴と、保険料の推移
import { Confirm } from '../../../core/ui/confirm';
import { NoticeMessage } from '../../../core/ui/notice-message';
import { retirementPreview } from '../../../core/calc/deduction';
import { CANDIDATE_LABEL, EMPLOYMENT_TYPE_LABEL } from '../../../core/calc/eligibility-check';
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
import { FormSnapshot, HasUnsavedChanges } from '../../../core/ui/unsaved-guard';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../../core/auth/auth';
import { MaintenanceRepository } from '../../../core/repository/maintenance-repository';
import { FilingRepository } from '../../../core/repository/filing-repository';
import { leaveFilingId } from '../../../core/calc/eligibility';
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
import { GradeRow, suggestStandards } from '../../../core/calc/grade-suggest';
import { senToDisplayYen } from '../../../core/calc/premium-calculator';
import { EmployeeDetail as Detail, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { NgTemplateOutlet } from '@angular/common';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { ChildSupportRounding } from '../../../core/calc/monthly-premium';
import { parseNumberInput } from '../../../core/calc/half-width';
import { DateLabelPipe, YearMonthPipe } from '../../../core/ui/year-month.pipe';
import { dateLabel, yearMonthLabel } from '../../../core/calc/year-month';
import { NavigationHistory, screenLabel } from '../../../core/ui/navigation-history';

type Mode =
  | null | 'retire' | 'loss' | 'reacquire' | 'transfer' | 'standard' | 'leave' | 'insuredType' | 'exemption' | 'exemptionEnd'
  | 'name' | 'employeeNumber' | 'dependent' | 'dependentRemove' | 'dependentExemption' | 'dependentExemptionEnd' | 'payrollGroup' | 'confirmStandard' | 'absence' | { leaveId: string } | { absenceId: string };

/** 画面の欄（カード）。入力フォームは、操作に関係するカードの中に出す */
type Card = 'qual' | 'standard' | 'leave' | 'family' | 'history';
const CARDS: { id: Card; label: string }[] = [
  { id: 'qual', label: '資格・所属' },
  { id: 'standard', label: '標準報酬月額' },
  { id: 'leave', label: '休業・休職' },
  { id: 'family', label: '被扶養者・適用除外' },
  { id: 'history', label: '直近12か月の保険料' },
];

/** 入力の種類 → フォームを出すカード */
export function cardOfMode(mode: Mode): Card | null {
  if (mode === null) return null;
  if (typeof mode === 'object') return 'leave';
  switch (mode) {
    case 'standard':
    case 'confirmStandard':
      return 'standard';
    case 'leave':
    case 'absence':
      return 'leave';
    case 'dependent':
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

@Component({
  imports: [RouterLink, NgTemplateOutlet, NoticeMessage, YearMonthPipe, DateLabelPipe],
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
      await this.repo.setRefundStatus(d.id, qualificationId, status);
      this.notice.set(`還付の状態を「${REFUND_LABEL[status]}」にしました。`);
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
  protected readonly isInsuredNow = computed(() => openQualification(this.detail()?.qualifications ?? []) !== null);

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
      this.payrollGroups.set(groups);
      if (!detail) this.error.set('この従業員は見つかりませんでした。');
      this.detail.set(detail);
      this.masters.set(masters);
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
    if (r.status === 'noStandard') return '標準報酬月額が未登録';
    if (r.premium?.exempt) return '休業免除';
    const notes = [exemptionNote(this.detail()?.exemptions ?? [], r.yearMonth)];
    if (r.premium?.careLabel === 'special') notes.push('特定被保険者（40〜64歳の被扶養者あり）');
    return notes.filter((n) => n).join('、');
  }
  /** 「通知書の値で確定」で直す履歴 */
  private readonly confirmId = signal<string | null>(null);
  protected readonly confirmTarget = computed(() => this.detail()?.standardHistory.find((s) => s.id === this.confirmId()) ?? null);

  protected openConfirm(id: string): void {
    this.confirmId.set(id);
    this.open('confirmStandard');
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
  protected open(mode: Exclude<Mode, null>): void {
    this.errors.set({});
    this.notice.set(null);
    this.date.set('');
    this.reason.set('');
    this.officeId.set('');
    this.remuneration.set(null);
    this.breakdown.set(EMPTY_BREAKDOWN);
    const d = this.detail();
    const latest = d ? findEffective(d.standardHistory, '9999-12') : null;
    if (mode === 'standard' || mode === 'transfer') {
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
      void this.repo
        .loadAll()
        .then((list) => this.otherNumbers.set(list.filter((e) => e.id !== d?.id).map((e) => e.employeeNumber)))
        .catch(() => this.otherNumbers.set([]));
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
    // 入力欄は操作に関係するカードの中に開くので、見えるところまで動かす
    setTimeout(() => {
      const form = document.querySelector('app-employee-detail form.form') as (HTMLElement & { scrollIntoView?: unknown }) | null;
      if (form && typeof form.scrollIntoView === 'function') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  /** 資格を失う日に扶養から外れる被扶養者（まだ扶養中の人） */
  private openDependentIds(lostDate: string | null): string[] {
    if (!lostDate) return [];
    return (this.detail()?.dependents ?? []).filter((x) => x.removedDate === null || x.removedDate > lostDate).filter((x) => dependentOutDate(x, lostDate) === null).map((x) => x.id);
  }

  /** 今日の時点で扶養から外れていれば、その日と理由（75歳の誕生日を含む）。扶養中は null */
  protected outNow(x: Dependent): { date: string; reason: 'removed' | 'age75' } | null {
    const out = dependentOut(x);
    return out && out.date <= today() ? out : null;
  }

  protected openDependentRemove(id: string): void {
    this.open('dependentRemove');
    this.editingDependentId.set(id);
  }

  /** 被扶養者の介護保険の適用除外を足す */
  protected openDependentExemption(id: string): void {
    this.open('dependentExemption');
    this.editingDependentId.set(id);
    this.depExemptionForm.set({ startDate: '', endDate: '' });
  }

  /** 該当中の期間に、非該当年月日を入れる */
  protected openDependentExemptionEnd(id: string, index: number): void {
    const x = this.detail()?.dependents.find((d) => d.id === id)?.careExemptions?.[index];
    if (!x) return;
    this.open('dependentExemptionEnd');
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
  protected openExemptionEnd(id: string): void {
    const x = this.detail()?.exemptions.find((e) => e.id === id);
    if (!x) return;
    this.open('exemptionEnd');
    this.editingExemptionId.set(id);
    this.exemptionForm.set({ type: x.type, startDate: x.startDate, endDate: x.endDate ?? '' });
  }

  protected setExemption(key: keyof ExemptionInput, value: string): void {
    this.exemptionForm.update((f) => ({ ...f, [key]: value }));
  }

  protected cancel(): void {
    this.mode.set(null);
  }

  /** 開いているフォームの入力（画面を移る前の確認に使う） */
  private readonly snapshot = new FormSnapshot(() => [
    this.date(), this.reason(), this.officeId(), this.standardForm(), this.remuneration(), this.breakdown(), this.multiOffice(),
    this.leaveForm(), this.absenceForm(), this.exemptionForm(), this.dependentForm(), this.depExemptionForm(),
    this.insuredType(), this.payrollGroupId(), this.nameForm(), this.numberForm(),
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
    this.leaveForm.update((f) => ({ ...f, [key]: value }));
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
      errors = checkReacquire(d.qualifications, this.date());
      action = () => this.repo.addQualification(d.id, this.date());
      message = `${d.qualifications.length ? '再加入' : '加入'}を登録しました。標準報酬月額の履歴も追加してください（決定の理由は「資格取得時決定」）。`;
    } else if (mode === 'transfer') {
      const f = this.standardForm();
      errors = {
        ...checkTransfer(d.assignments, this.date(), this.officeId()),
        ...checkStandard(
          d.standardHistory.map((s) => s.validFrom),
          { ...f, validFrom: this.date() ? monthOf(this.date()) : '' },
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
      errors = checkStandard(d.standardHistory.map((s) => s.validFrom), f);
      // 資格取得時決定で内訳を1つでも入れたら、内訳をチェックして一緒に保存する
      const b = this.breakdown();
      const useBreakdown = f.reason === 'acquisition' && BREAKDOWN_KEYS.some((k) => b[k] !== null);
      if (useBreakdown) errors = { ...errors, ...checkBreakdown(b) };
      action = () => this.repo.addStandard(d.id, f, this.remuneration(), useBreakdown ? b : null);
      message = `${yearMonthLabel(f.validFrom)}分からの標準報酬月額を登録しました。`;
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
      errors = others === null ? { employeeNumber: 'ほかの従業員の社員番号を読み込んでいます。少し待ってから、もう一度保存してください' } : r.errors;
      action = () => this.repo.updateEmployeeNumber(d.id, r.number);
      message = `社員番号を「${before}」から「${r.number}」に変えました。給与ソフトのCSVを取り込むときは、新しい社員番号で照らし合わせます。`;
    } else if (mode === 'dependent') {
      const f = this.dependentForm();
      errors = checkDependent(f, today());
      action = () => this.repo.addDependent(d.id, f);
      message = `被扶養者（${f.name.trim()}さん）を登録しました。被扶養者異動届：${dateLabel(dependentReportDeadline(f.certifiedDate))}まで（5日以内）`;
    } else if (mode === 'dependentRemove') {
      const id = this.editingDependentId()!;
      const dep = d.dependents.find((x) => x.id === id)!;
      errors = checkRemoval(dep, this.date());
      action = () => this.repo.removeDependent(d.id, id, this.date());
      message = `${dep.name}さんを${dateLabel(this.date())}に扶養から外しました。被扶養者異動届：${dateLabel(dependentReportDeadline(this.date()))}まで（5日以内）`;
    } else if (mode === 'dependentExemption' || mode === 'dependentExemptionEnd') {
      const id = this.editingDependentId()!;
      const dep = d.dependents.find((x) => x.id === id)!;
      const f = this.depExemptionForm();
      const index = mode === 'dependentExemption' ? null : this.editingDepExemptionIndex();
      errors = checkDependentCareExemption(dep, f, index);
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
      action = () => this.repo.updateExemptionEnd(d.id, id, f.endDate);
      message = f.endDate ? `適用除外の非該当年月日（${dateLabel(f.endDate)}）を登録しました。` : '適用除外の非該当年月日を消しました。';
    } else if (mode === 'payrollGroup') {
      const gid = this.payrollGroupId();
      const date = this.date();
      errors = checkPayrollAssignment(d.payrollAssignments, date, gid, isValidDate(date) ? payrollGroupAt(this.payrollGroups(), d.payrollAssignments, date).id : '');
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
      }
      action = () => this.repo.confirmStandard(d.id, t!.id, f.healthStandard!, f.pensionStandard!);
      message = `${yearMonthLabel(t?.validFrom)}分からの標準報酬月額を、通知書の値で確定しました。`;
    } else if (mode === 'leave') {
      const f = this.leaveForm();
      errors = checkLeave(f);
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
      errors = checkLeave(f);
      action = () => this.repo.updateLeave(d.id, mode.leaveId, f.endDate, f.workedDays);
      message = '休業の期間を変更しました。';
    }

    this.errors.set(errors);
    if (Object.keys(errors).length > 0 || !action) return;
    this.saving.set(true);
    try {
      await action();
      this.mode.set(null);
      this.notice.set(message);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.errors.set({ form: '保存できませんでした。権限と通信を確かめてください。' });
    } finally {
      this.saving.set(false);
    }
  }
}
