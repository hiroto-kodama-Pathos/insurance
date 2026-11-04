// 従業員一覧と新規登録（設計書 3.1）
import { NoticeMessage } from '../../../core/ui/notice-message';
import { SalaryRepository } from '../../../core/repository/salary-repository';
import { addMonths, SalaryRecord } from '../../../core/calc/salary';
import { payMonthFor } from '../../../core/calc/deduction';
import { dependentReportDeadline } from '../../../core/calc/dependent';
import { absentOn } from '../../../core/calc/absence';
import {
  CANDIDATE_LABEL, EligibilityInput, EligibilityRule, EMPLOYMENT_TYPE_LABEL, EmploymentType, EMPTY_ELIGIBILITY,
  judgeEligibility,
} from '../../../core/calc/eligibility-check';
import { CompanySettings } from '../../../core/calc/settings';
import { BREAKDOWN_KEYS, BREAKDOWN_LABEL, BreakdownKey, breakdownTotal, EMPTY_BREAKDOWN } from '../../../core/calc/new-employee';
import { defaultGroup, groupLabel, legacyGroup, PayrollGroup } from '../../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { INSURED_TYPE_LABEL, InsuredType } from '../../../core/calc/insured-type';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { FormSnapshot, HasUnsavedChanges } from '../../../core/ui/unsaved-guard';
import { RouterLink } from '@angular/router';
import { monthOf } from '../../../core/calc/date';
import { isInsuredInMonth } from '../../../core/calc/eligibility';
import { findEffective } from '../../../core/calc/employee-month';
import { GradeRow, GradeSuggestion, suggestStandards } from '../../../core/calc/grade-suggest';
import { childLaborNotice, hoursOptional, isValidDate, NewEmployeeErrors, NewEmployeeInput, similarRemuneration, validateNewEmployee } from '../../../core/calc/new-employee';
import { defaultOfficeId, findOffice, Office } from '../../../core/calc/office';
import { Auth } from '../../../core/auth/auth';
import { scopedOffice } from '../../../core/repository/scope';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { matchesPerson } from '../../../core/calc/person-search';
import { parseNumberInput, toHalfWidth } from '../../../core/calc/half-width';
import { DateLabelPipe, YearMonthPipe } from '../../../core/ui/year-month.pipe';
import { dateLabel, yearMonthLabel } from '../../../core/calc/year-month';

/** 今日（日本時間）'YYYY-MM-DD' */
/** 最後に失った資格の理由が退職・死亡か（加入の条件から外れた人・75歳到達の人は在籍していることがあるので未加入にする） */
function retiredLast(qs: { lostDate: string | null; lostReason?: string | null }[]): boolean {
  const last = [...qs].sort((a, b) => (b.lostDate ?? '9999').localeCompare(a.lostDate ?? '9999'))[0];
  return !!last?.lostDate && (last.lostReason == null || last.lostReason === 'retirement' || last.lostReason === 'death');
}

function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** 一覧の1行 */
export type EmployeeRow = {
  employee: EmployeeRecord;
  officeName: string;
  officeId: string;
  /** 在籍中：今、加入中 / 退職済み：最後の資格を退職・死亡で失った / 未加入：加入していない（加入の条件から外れた人を含む） */
  status: '在籍中' | '退職済み' | '未加入';
  standard: string;
};

type TextKey = 'employeeNumber' | 'name' | 'birthDate' | 'acquiredDate' | 'officeId';
type AmountKey = 'healthStandard' | 'pensionStandard';

/** 金額の欄を読む（全角でもよい） */
const toYen = (value: string): number | null => parseNumberInput(value);

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe, DateLabelPipe],
  selector: 'app-employee-list',
  styleUrl: './employee-list.scss',
  templateUrl: './employee-list.html',
})
export class EmployeeList implements OnInit, HasUnsavedChanges {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);

  // ---- 日給・時給の人：同じような仕事をする人の前月の報酬の平均（設計書 2.11） ----
  /** 選んだ人（同じ事業所で同じような仕事をする人） */
  protected readonly similarIds = signal<string[]>([]);
  /** 読み込んだ前月の給与 */
  private readonly similarSalaries = signal<{ month: string; list: SalaryRecord[] } | null>(null);
  /** 資格取得月の前月 */
  protected readonly similarMonth = computed(() => {
    const d = this.form().acquiredDate;
    return addMonths(isValidDate(d) ? monthOf(d) : monthOf(today()), -1);
  });
  /** 選べる人（同じ事業所に今所属していて、加入中の人） */
  protected readonly similarCandidates = computed(() => {
    const officeId = this.form().officeId || defaultOfficeId(this.newOffices());
    const date = isValidDate(this.form().acquiredDate) ? this.form().acquiredDate : today();
    return this.rows().filter((r) => r.officeId === officeId && r.status === '在籍中' && isInsuredInMonth(r.employee.qualifications, monthOf(date)));
  });
  protected readonly similar = computed(() => {
    const loaded = this.similarSalaries();
    const month = this.similarMonth();
    return similarRemuneration(loaded?.month === month ? loaded.list : [], this.similarIds(), month);
  });

  protected async toggleSimilar(id: string, on: boolean): Promise<void> {
    this.similarIds.update((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
    const month = this.similarMonth();
    if (this.similarSalaries()?.month !== month) {
      const list = await this.salaryRepo.loadRange(month, month);
      this.similarSalaries.set({ month, list });
    }
  }

  /** 平均を報酬月額にする（内訳はまとめて基本給の欄に入れる） */
  protected useSimilarAverage(): void {
    const avg = this.similar().average;
    if (avg === null) return;
    this.form.update((f) => ({ ...f, breakdown: { basic: avg, allowances: null, commuting: null, overtime: null } }));
    this.suggestion.set(null);
  }

  /** 今日、休職中か（設計書 2.26） */
  protected isAbsent(e: EmployeeRecord): boolean {
    return absentOn(e.absences, today()) !== null;
  }

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly employees = signal<EmployeeRecord[]>([]);
  protected readonly offices = signal<Office[]>([]);
  private readonly auth = inject(Auth);
  /**
   * 新規登録で選べる適用事業所。特定の事業所の担当者は、自分の担当事業所だけ
   * （セキュリティルールでも、担当者はほかの事業所の人を登録できない。選べてしまうと、登録を押したときに断られる）
   */
  protected readonly newOffices = computed(() => {
    const scope = scopedOffice(this.auth);
    return scope ? this.offices().filter((o) => o.id === scope) : this.offices();
  });
  /** 担当事業所だけを登録できる人か */
  protected readonly officeScoped = computed(() => scopedOffice(this.auth) !== null);
  private readonly grades = signal<GradeRow[]>([]);

  protected readonly showForm = signal(false);
  private readonly settingsRepo = inject(SettingsRepository);
  protected readonly payrollGroups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  protected readonly groupLabel = groupLabel;
  protected readonly breakdownKeys = BREAKDOWN_KEYS;
  protected readonly candidateLabel = CANDIDATE_LABEL;
  protected readonly employmentTypeLabel = EMPLOYMENT_TYPE_LABEL;
  protected readonly employmentTypes = Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[];
  private readonly eligibilityRules = signal<EligibilityRule[]>([]);
  private readonly settings = signal<CompanySettings>(DEFAULT_SETTINGS);

  /** 入社時の判定の候補（入力が足りなければ null） */
  protected readonly eligibilityResult = computed(() => {
    const f = this.form();
    if (!f.eligibility) return null;
    const s = this.settings();
    return judgeEligibility(
      f.eligibility,
      isValidDate(f.acquiredDate) ? f.acquiredDate : today(),
      this.eligibilityRules(),
      { weeklyHours: s.fullTimeWeeklyHours, monthlyDays: s.fullTimeMonthlyDays },
    );
  });

  /** 選んでいる加入有無・区分が候補と違う */
  protected readonly differsFromCandidate = computed(() => {
    const r = this.eligibilityResult();
    const f = this.form();
    if (!r) return false;
    if ((r.candidate !== 'none') !== f.insured) return true;
    return f.insured && r.insuredType !== (f.insuredType ?? 'general');
  });
  protected readonly breakdownLabel = BREAKDOWN_LABEL;
  protected readonly insuredTypeLabel = INSURED_TYPE_LABEL;
  protected readonly insuredTypes = Object.keys(INSURED_TYPE_LABEL) as InsuredType[];
  protected readonly form = signal<NewEmployeeInput>(this.emptyForm());
  protected readonly errors = signal<NewEmployeeErrors>({});
  /** 新規登録のフォームを開いたときの入力（画面を移る前の確認に使う） */
  private readonly snapshot = new FormSnapshot(() => this.form());
  /** 画面を移る前の確認に使う（unsavedChangesGuard）。新規登録のフォームで入力を変えていれば1件 */
  unsavedCount(): number {
    return this.showForm() && this.snapshot.changed() ? 1 : 0;
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }
  /** 登録できなかったとき（通信・権限）の知らせ。社員番号などの欄の誤りではないので、登録のボタンの横に出す */
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly notice = signal<string | null>(null);
  /** 直近の「提案を入力」の結果（等級の表示に使う） */
  protected readonly suggestion = signal<GradeSuggestion | null>(null);
  protected readonly suggestMessage = signal<string | null>(null);

  /** 一覧の絞り込み */
  protected readonly statusFilter = signal<'all' | EmployeeRow['status']>('all');
  protected readonly query = signal('');
  protected readonly officeFilter = signal('');
  protected readonly statusTabs: ('all' | EmployeeRow['status'])[] = ['all', '在籍中', '退職済み', '未加入'];

  /** 絞り込んだ一覧 */
  protected readonly filteredRows = computed(() => {
    const q = this.query();
    const st = this.statusFilter();
    const office = this.officeFilter();
    return this.rows().filter(
      (r) =>
        (st === 'all' || r.status === st) &&
        (office === '' || r.officeId === office) &&
        matchesPerson(r.employee.employeeNumber, r.employee.name, q),
    );
  });

  /** 状態ごとの人数（タブに出す） */
  protected readonly counts = computed(() => {
    const c: Record<string, number> = { all: this.rows().length, 在籍中: 0, 退職済み: 0, 未加入: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });

  protected readonly rows = computed<EmployeeRow[]>(() => {
    const d = today();
    const ym = monthOf(d);
    return [...this.employees()]
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
      .map((e) => {
        let officeName = '';
        let officeId = '';
        try {
          const o = findOffice(e.assignments, this.offices(), d);
          officeName = o.name;
          officeId = o.id;
        } catch {
          officeName = '';
        }
        const std = findEffective(e.standardHistory, ym);
        const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
        const standard = !std
          ? ''
          : std.healthStandard === std.pensionStandard
            ? man(std.healthStandard)
            : `健保 ${man(std.healthStandard)}／厚年 ${man(std.pensionStandard)}`;
        const status: EmployeeRow['status'] = isInsuredInMonth(e.qualifications, ym)
          ? '在籍中'
          : e.qualifications.length > 0 && retiredLast(e.qualifications)
            ? '退職済み'
            : '未加入';
        return { employee: e, officeName, officeId, status, standard };
      });
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private emptyForm(): NewEmployeeInput {
    return {
      employeeNumber: '',
      name: '',
      birthDate: '',
      officeId: defaultOfficeId(this.newOffices?.() ?? []),
      payrollGroupId: this.payrollGroups ? defaultGroup(this.payrollGroups()).id : undefined,
      insured: true,
      acquiredDate: today(),
      eligibility: { ...EMPTY_ELIGIBILITY },
      breakdown: EMPTY_BREAKDOWN,
      healthStandard: null,
      pensionStandard: null,
      dependents: [],
    };
  }

  // ---- 被扶養者（入社時にまとめて登録する。設計書 3.1） ----
  protected readonly hoursOptional = hoursOptional;
  /** 生年月日の欄の上限（今日より後は選べない） */
  protected readonly todayDate = today();
  /** 児童（中学校を卒業する時期の前）の注意。入社日（資格取得日）の時点で判定する */
  protected readonly childNotice = computed(() => childLaborNotice(this.form().birthDate, this.form().acquiredDate));

  protected addDependentRow(): void {
    this.form.update((f) => ({ ...f, dependents: [...(f.dependents ?? []), { name: '', birthDate: '', certifiedDate: '' }] }));
  }
  protected removeDependentRow(index: number): void {
    this.form.update((f) => ({ ...f, dependents: (f.dependents ?? []).filter((_, k) => k !== index) }));
  }
  protected setDependent(index: number, key: 'name' | 'birthDate' | 'certifiedDate', value: string): void {
    this.form.update((f) => ({ ...f, dependents: (f.dependents ?? []).map((d, k) => (k === index ? { ...d, [key]: value } : d)) }));
  }
  protected dependentError(index: number): string {
    return this.errors()[`dependent${index}`] ?? '';
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [employees, masters, grades, groups, rules, settings] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.masterRepo.loadGrades(),
        this.settingsRepo.loadPayrollGroups(),
        this.masterRepo.loadEligibilityRules(),
        this.settingsRepo.loadSettings(),
      ]);
      this.eligibilityRules.set(rules);
      this.settings.set(settings);
      this.payrollGroups.set(groups);
      this.employees.set(employees);
      this.offices.set(masters.offices);
      this.grades.set(grades);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected openForm(): void {
    this.form.set(this.emptyForm());
    this.snapshot.take();
    this.errors.set({});
    this.formError.set(null);
    this.notice.set(null);
    this.suggestion.set(null);
    this.suggestMessage.set(null);
    this.showForm.set(true);
  }

  protected closeForm(): void {
    this.showForm.set(false);
  }

  protected setPayrollGroup(value: string): void {
    this.form.update((f) => ({ ...f, payrollGroupId: value }));
  }

  protected setEmploymentType(value: EmploymentType): void {
    this.form.update((f) => ({ ...f, eligibility: { ...(f.eligibility ?? EMPTY_ELIGIBILITY), employmentType: value } }));
  }

  protected setEligibilityNumber(key: 'weeklyHours' | 'monthlyDays', value: string): void {
    this.form.update((f) => ({ ...f, eligibility: { ...(f.eligibility ?? EMPTY_ELIGIBILITY), [key]: parseNumberInput(value) } }));
  }

  protected setEligibility(key: 'contractEnd', value: string): void;
  protected setEligibility(key: 'renewalExpected' | 'isStudent', value: boolean): void;
  protected setEligibility(key: keyof EligibilityInput, value: string | boolean): void {
    this.form.update((f) => ({ ...f, eligibility: { ...(f.eligibility ?? EMPTY_ELIGIBILITY), [key]: value } }));
  }

  /** 候補どおりに、加入有無と被保険者区分を入れる */
  protected applyCandidate(): void {
    const r = this.eligibilityResult();
    if (!r) return;
    this.form.update((f) => ({ ...f, insured: r.candidate !== 'none', insuredType: r.insuredType ?? f.insuredType }));
  }

  protected setInsuredType(value: InsuredType): void {
    this.form.update((f) => ({ ...f, insuredType: value }));
  }

  protected setText(key: TextKey, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected setInsured(insured: boolean): void {
    this.form.update((f) => ({ ...f, insured }));
  }

  protected setAmount(key: AmountKey, value: string): void {
    this.form.update((f) => ({ ...f, [key]: toYen(value) }));
    this.suggestion.set(null);
  }

  /** 報酬月額の内訳を入れる（合計は remuneration で表示） */
  protected setBreakdown(key: BreakdownKey, value: string): void {
    this.form.update((f) => ({ ...f, breakdown: { ...f.breakdown, [key]: toYen(value) } }));
  }

  /** 内訳の合計（報酬月額） */
  protected readonly remuneration = computed(() => breakdownTotal(this.form().breakdown));

  /** 報酬月額から、協会けんぽの保険料額表の等級で標準報酬月額を入れる */
  protected suggest(): void {
    const f = this.form();
    this.suggestMessage.set(null);
    const remuneration = breakdownTotal(f.breakdown);
    if (remuneration === null || !(remuneration > 0)) {
      this.suggestMessage.set('先に基本給などの内訳を入力してください。');
      return;
    }
    const ym = isValidDate(f.acquiredDate) ? monthOf(f.acquiredDate) : monthOf(today());
    const s = suggestStandards(remuneration, this.grades(), ym, isValidDate(f.birthDate) ? f.birthDate : '');
    if (!s) {
      this.suggestMessage.set('この月に使える等級表が登録されていません。管理者に確認してください。');
      return;
    }
    this.form.update((x) => ({ ...x, healthStandard: s.healthStandard, pensionStandard: s.pensionStandard }));
    this.suggestion.set(s);
  }

  /** 加入する人の、控除する給与の月と資格取得届の期限（設計書 1章 入社時） */
  private enrollmentNotice(input: NewEmployeeInput): string {
    if (!input.insured || !isValidDate(input.acquiredDate)) return '';
    const g = this.payrollGroups().find((x) => x.id === input.payrollGroupId) ?? defaultGroup(this.payrollGroups());
    const ym = input.acquiredDate.slice(0, 7);
    const quals = [{ acquiredDate: input.acquiredDate, lostDate: null }];
    const pay = payMonthFor(ym, g.deductionTiming, quals, g.paidIn === 'sameMonth');
    const ja = yearMonthLabel;
    const deadline = dependentReportDeadline(input.acquiredDate);
    const deps = (input.dependents ?? []).length;
    const depText = deps > 0 ? `被扶養者異動届（${deps}人）の期限も同じ${dateLabel(deadline)}です。` : '';
    return `${ja(ym)}分から保険料がかかり、${ja(ym)}分は${ja(pay)}支給の給与から控除します。資格取得届の期限は${dateLabel(deadline)}（5日以内）です。${depText}`;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const result = this.eligibilityResult();
    // 社員番号は半角にそろえて登録する（全角で入れても同じ社員番号として扱う）
    let input: NewEmployeeInput = { ...this.form(), employeeNumber: toHalfWidth(this.form().employeeNumber).trim(), eligibilityResult: result ? { candidate: result.candidate, reasons: result.reasons } : null };
    // 事業所を選んでいなければ、デフォルトの事業所にする
    if (!input.officeId) input = { ...input, officeId: defaultOfficeId(this.newOffices()) };
    // 加入しない人には被扶養者はいない
    if (!input.insured) input = { ...input, dependents: [] };
    this.form.set(input);
    const errors = validateNewEmployee(
      input,
      this.employees().map((e) => e.employeeNumber),
      today(),
    );
    this.errors.set(errors);
    this.formError.set(null);
    if (Object.keys(errors).length > 0) return;

    this.saving.set(true);
    try {
      await this.employeeRepo.create(input, today());
      this.notice.set(`${input.name.trim()}さんを登録しました。${this.enrollmentNotice(input)}`);
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.formError.set('登録できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }
}
