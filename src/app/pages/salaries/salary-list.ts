// 給与の入力（設計書 2.13・3.6）
// 給与ソフトで計算した給与を支払月ごとに入れる。給与は随時改定の候補を見つけるためだけに使い、保険料は変わらない。
import { PageState } from '../../core/ui/page-state';
import { DEFAULT_SALARY_CRITERIA, filterSalaryRows, SALARY_SORT_LABEL, SALARY_STATUS_LABEL, SalaryCriteria, SalarySortKey, SalaryStatusFilter } from '../../core/calc/salary-filter';
import { Confirm } from '../../core/ui/confirm';
import { NoticeMessage } from '../../core/ui/notice-message';
import { isMonthlyPaid, needsExclusion, PeriodChange, periodCalendarDays, periodChange, periodChangeNote } from '../../core/calc/pay-period-change';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfficeClosing } from '../../core/calc/closing';
import { isInsuredInMonth } from '../../core/calc/eligibility';
import { Masters } from '../../core/calc/employee-month';
import { findOffice } from '../../core/calc/office';
import { Auth } from '../../core/auth/auth';
import { scopedOffice } from '../../core/repository/scope';
import {
  addMonths,
  detectFixedWageChanges,
  detectRetroactivePossibilities,
  FixedWageChange,
  ManualWageChange,
  RetroactivePossibility,
  payMonths,
  SalaryErrors,
  SalaryInput,
  SalaryRecord,
  validateSalary,
} from '../../core/calc/salary';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { cutoffOf, legacyGroup, PayrollGroup, payDateOf, payrollGroupAt } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { parseNumberInput } from '../../core/calc/half-width';
import { HasUnsavedChanges } from '../../core/ui/unsaved-guard';
import type { PayrollCutoff } from '../../core/calc/insured-type';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';
import { dateLabel, yearMonthLabel } from '../../core/calc/year-month';

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

/** 入力欄の文字列（空欄は null） */
type Draft = Record<keyof SalaryInput, string>;

/** 2つの入力が同じか（保存していない行を見つける） */
function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(b) as (keyof SalaryInput)[]).every((k) => (a[k] ?? '') === (b[k] ?? ''));
}

export type SalaryRow = {
  employee: EmployeeRecord;
  /** この月に登録済みの給与（最初の1件を編集する） */
  existing: SalaryRecord | null;
  /** この月のほかの支払い（月2回払いなど。合算して判定する） */
  others: number;
  /** 前月の固定的賃金（遡及差額を除く） */
  previousFixed: number | null;
  change: FixedWageChange | null;
  officeId: string | null;
  closed: boolean;
  /** 社会保険に未加入の人（労働時間を入れて、加入の可能性を見る） */
  uninsured: boolean;
  /** この月に担当者が登録した固定的賃金の変動 */
  manual: ManualWageChange | null;
  /** 前月・この月の遡及の可能性（遡及差額を入れていないのに、遡及昇給のような動きがある） */
  retroactive: RetroactivePossibility | null;
  /** 支払月・締め日の変更月の種類（変更月でなければ null。設計書 2.13） */
  periodChange: PeriodChange | null;
  /** この月の支払区分 */
  groupId: string;
  /** 支払基礎日数の初期値（月給制とみなせる人の、計算期間の暦日数）。入れない人は null */
  autoBaseDays: number | null;
};

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe],
  selector: 'app-salary-list',
  styleUrl: './salary-list.scss',
  templateUrl: './salary-list.html',
})
export class SalaryList implements OnInit, HasUnsavedChanges {
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly confirm = inject(Confirm);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly auth = inject(Auth);
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);

  protected readonly yearMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal<string | null>(null);

  protected readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  /** 表示している月と前月の給与 */
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly closings = signal<OfficeClosing[]>([]);

  /** 行ごとの入力中の値（従業員ID → 入力） */
  protected readonly drafts = signal<Record<string, Draft>>({});
  /** 行ごとの、登録済みの値（入力欄の初めの値）。drafts と比べて、保存していない行を見つける */
  private readonly baselines = signal<Record<string, Draft>>({});

  /** 保存していない行（入力欄が登録済みの値から変わっている行）の従業員ID */
  protected readonly unsavedIds = computed(() => {
    const d = this.drafts();
    const b = this.baselines();
    return Object.keys(d).filter((id) => b[id] && !sameDraft(d[id], b[id]));
  });
  protected isUnsaved(id: string): boolean {
    return this.unsavedIds().includes(id);
  }
  /** 画面を移る前の確認に使う（unsavedChangesGuard） */
  unsavedCount(): number {
    return this.unsavedIds().length;
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }
  protected readonly errors = signal<Record<string, SalaryErrors & { form?: string }>>({});

  protected readonly rows = computed<SalaryRow[]>(() => {
    const ym = this.yearMonth();
    const m = this.masters();
    if (!m) return [];
    const closed = new Set(this.closings().map((c) => c.officeId));
    return this.employees()
      // 資格のある人と、未加入の人（資格を一度も取っていない人。労働時間を見続ける）
      .filter((e) => isInsuredInMonth(e.qualifications, ym) || e.qualifications.length === 0)
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
      .map((e) => {
        const mine = this.salaries().filter((s) => s.employeeId === e.id);
        const thisMonth = mine.filter((s) => s.paidDate.startsWith(ym)).sort((a, b) => a.paidDate.localeCompare(b.paidDate));
        const months = payMonths(mine);
        const prev = months.find((x) => x.yearMonth === addMonths(ym, -1));
        const change = detectFixedWageChanges(months, e.fixedWageChanges ?? []).find((c) => c.yearMonth === ym) ?? null;
        const retroactive =
          detectRetroactivePossibilities(months).find((r) => r.yearMonth === ym || r.yearMonth === addMonths(ym, -1)) ?? null;
        const cutoffAt = (x: string) => cutoffOf(payrollGroupAt(this.groups(), e.payrollAssignments, `${x}-01`));
        let officeId: string | null = null;
        try {
          officeId = findOffice(e.assignments, m.offices, `${ym}-01`).id;
        } catch {
          officeId = null;
        }
        return {
          employee: e,
          existing: thisMonth[0] ?? null,
          others: Math.max(0, thisMonth.length - 1),
          previousFixed: prev ? prev.fixed : null,
          change,
          officeId,
          closed: officeId !== null && closed.has(officeId),
          uninsured: e.qualifications.length === 0,
          manual: (e.fixedWageChanges ?? []).find((x) => x.yearMonth === ym) ?? null,
          retroactive,
          periodChange: periodChange(ym, cutoffAt),
          groupId: payrollGroupAt(this.groups(), e.payrollAssignments, `${ym}-01`).id,
          autoBaseDays: this.autoBaseDays(e, mine, ym, cutoffAt),
        };
      });
  });

  protected readonly needsExclusion = needsExclusion;

  /** 支払基礎日数の初期値：月給制とみなせる加入者だけ、その月の計算期間の暦日数 */
  private autoBaseDays(e: EmployeeRecord, mine: SalaryRecord[], ym: string, cutoffAt: (x: string) => PayrollCutoff): number | null {
    if (e.qualifications.length === 0) return null; // 未加入の人（パートなど）は実際の出勤日数を入れる
    // 支払月・締め日の変更月は、何日を支払基礎日数とするかを担当者が決める（2か月分の月など）ので、入れない
    if (periodChange(ym, cutoffAt)) return null;
    const prevYm = addMonths(ym, -1);
    const prevSalaries = mine.filter((s) => s.paidDate.startsWith(prevYm));
    // 前月に2回以上払った人（月2回払いなど）は、前月の入力からは見分けない
    const previous = prevSalaries.length === 1 ? prevSalaries[0] : null;
    if (!isMonthlyPaid(e.eligibility?.employmentType, previous, periodCalendarDays(prevYm, cutoffAt))) return null;
    return periodCalendarDays(ym, cutoffAt);
  }

  /** 支払基礎日数の欄に、初期値（暦日数）がそのまま入っているか（「暦日数（自動）」と添える） */
  protected isAutoBaseDays(row: SalaryRow): boolean {
    return !row.existing && row.autoBaseDays !== null && this.draft(row.employee.id, 'paymentBaseDays') === String(row.autoBaseDays);
  }

  // ---- 絞り込みと並び替え ----
  protected readonly criteria = signal<SalaryCriteria>(DEFAULT_SALARY_CRITERIA);

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('salaries.yearMonth', this.yearMonth);
    pageState.keep('salaries.criteria', this.criteria);
    return true;
  })(inject(PageState));
  protected readonly statusLabels = SALARY_STATUS_LABEL;
  protected readonly statusKeys = Object.keys(SALARY_STATUS_LABEL) as Exclude<SalaryStatusFilter, ''>[];
  protected readonly sortLabels = SALARY_SORT_LABEL;
  protected readonly sortKeys = Object.keys(SALARY_SORT_LABEL) as SalarySortKey[];
  protected readonly officeList = computed(() => this.masters()?.offices ?? []);
  protected readonly groupList = computed(() => this.groups());

  /** 事業所で絞る前の行（ほかの条件は効かせる。適用事業所の選択肢の件数に使う） */
  private readonly officeBaseRows = computed(() => {
    const offices = this.officeList();
    return filterSalaryRows(this.rows(), (r) => this.facts(r, offices), { ...this.criteria(), officeId: '' });
  });

  /**
   * 適用事業所の選択肢（登録した順）と件数（随時改定と同じ）。その月に対象の人がいる事業所だけを出し、件数はほかの絞り込みに合わせる。
   * 特定の事業所の担当者には、担当事業所だけを出す。選んでいる事業所は0件でも残す
   */
  protected readonly officeOptions = computed(() => {
    const scope = scopedOffice(this.auth);
    const counts = new Map<string, number>();
    for (const r of this.officeBaseRows()) if (r.officeId) counts.set(r.officeId, (counts.get(r.officeId) ?? 0) + 1);
    return this.officeList()
      .filter((o) => (scope === null || o.id === scope) && (counts.has(o.id) || o.id === this.criteria().officeId))
      .map((o) => ({ value: o.id, label: o.name, count: counts.get(o.id) ?? 0 }));
  });
  /** 事業所で絞る前の件数（「すべて」の選択肢に出す） */
  protected readonly officeAllCount = computed(() => this.officeBaseRows().length);

  protected setCriteria<K extends keyof SalaryCriteria>(key: K, value: SalaryCriteria[K]): void {
    this.criteria.update((c) => ({ ...c, [key]: value }));
  }

  /** 表に出す行（絞り込みと並び替えのあと） */
  protected readonly shownRows = computed(() => {
    const offices = this.officeList();
    return filterSalaryRows(this.rows(), (r) => this.facts(r, offices), this.criteria());
  });

  /** 絞り込み・並び替えに使う、行の値 */
  private facts(r: SalaryRow, offices: { id: string }[]) {
    return {
      employeeNumber: r.employee.employeeNumber,
      name: r.employee.name,
      officeId: r.officeId,
      officeOrder: r.officeId === null ? offices.length : offices.findIndex((o) => o.id === r.officeId),
      groupId: r.groupId,
      entered: r.existing !== null,
      fixed: r.existing ? r.existing.fixedWages : null,
      changed: r.change !== null || r.manual !== null,
      attention: r.retroactive !== null || r.periodChange !== null,
      uninsured: r.uninsured,
    };
  }

  /** 変更月の説明（入力中の「算定から除く額」で表示する） */
  protected periodNote(row: SalaryRow): string {
    if (!row.periodChange) return '';
    const v = parseNumberInput(this.drafts()[row.employee.id]?.excludedAmount) ?? 0;
    return periodChangeNote(row.periodChange, Number.isFinite(v) ? v : 0);
  }

  protected readonly enteredCount = computed(() => this.rows().filter((r) => r.existing).length);
  protected readonly changedCount = computed(() => this.rows().filter((r) => r.change).length);

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, groups] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadPayrollGroups(),
      ]);
      this.groups.set(groups);
      this.employees.set(employees);
      this.masters.set(masters);
      await this.loadMonth();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * @param keepUnsaved true なら、保存していない行の入力を残す（1行を保存・削除したあとに、ほかの行の入力を消さないため）
   */
  private async loadMonth(keepUnsaved = false): Promise<void> {
    const ym = this.yearMonth();
    const [salaries, closings] = await Promise.all([
      // 遡及の可能性を見るため、前々月から読む
      this.salaryRepo.loadRange(addMonths(ym, -2), ym),
      this.closingRepo.loadMonth(ym),
    ]);
    if (ym !== this.yearMonth()) return;
    this.salaries.set(salaries);
    this.closings.set(closings);
    this.resetDrafts(keepUnsaved);
  }

  /** 入力欄を、登録済みの値（なければ空欄と支払日の初期値）に戻す。keepUnsaved なら、保存していない行はそのまま */
  private resetDrafts(keepUnsaved = false): void {
    const ym = this.yearMonth();
    const keep = keepUnsaved ? new Set(this.unsavedIds()) : new Set<string>();
    const before = this.drafts();
    const drafts: Record<string, Draft> = {};
    for (const r of this.rows()) {
      const s = r.existing;
      const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
      drafts[r.employee.id] = {
        // 支払日の初期値は、その人の支払区分の支払日
        paidDate: s?.paidDate ?? payDateOf(payrollGroupAt(this.groups(), r.employee.payrollAssignments, `${ym}-01`), ym),
        fixedWages: str(s?.fixedWages),
        nonFixedWages: str(s?.nonFixedWages),
        // まだ入れていない月は、月給制とみなせる人だけ暦日数を初期値にする（欠勤控除がある月は担当者が直す）
        paymentBaseDays: s ? str(s.paymentBaseDays) : str(r.autoBaseDays),
        retroactiveDiff: str(s?.retroactiveDiff),
        inKindWages: str(s?.inKindWages),
        workingHours: str(s?.workingHours),
        hourlyRate: str(s?.hourlyRate),
        excludedAmount: str(s?.excludedAmount),
      };
    }
    this.baselines.set(drafts);
    this.drafts.set(Object.fromEntries(Object.entries(drafts).map(([id, d]) => [id, keep.has(id) && before[id] ? before[id] : d])));
    // 残した行のエラーは残す（まとめて保存で、直す必要のある行が分かるように）
    this.errors.update((e) => Object.fromEntries(Object.entries(e).filter(([id]) => keep.has(id))));
  }

  protected async onMonthChange(input: HTMLInputElement): Promise<void> {
    const value = input.value;
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const n = this.unsavedCount();
    if (n > 0) {
      const ok = await this.confirm.ask({
        title: '保存していない入力があります',
        message: `${yearMonthLabel(this.yearMonth())}の${n}人分の入力をまだ保存していません。支払月を変えると、入力した内容は消えます。`,
        ok: '保存せずに支払月を変える',
        danger: true,
      });
      if (!ok) {
        input.value = this.yearMonth(); // 選んだ月を元に戻す
        return;
      }
    }
    this.yearMonth.set(value);
    this.notice.set(null);
    void this.loadMonth();
  }

  protected draft(id: string, key: keyof SalaryInput): string {
    return this.drafts()[id]?.[key] ?? '';
  }

  protected setDraft(id: string, key: keyof SalaryInput, value: string): void {
    this.drafts.update((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  }

  private toInput(d: Draft): SalaryInput {
    const num = (v: string | undefined) => parseNumberInput(v);
    return {
      paidDate: d.paidDate,
      fixedWages: num(d.fixedWages),
      nonFixedWages: num(d.nonFixedWages),
      paymentBaseDays: num(d.paymentBaseDays),
      retroactiveDiff: num(d.retroactiveDiff),
      inKindWages: num(d.inKindWages),
      workingHours: num(d.workingHours),
      hourlyRate: num(d.hourlyRate),
      excludedAmount: num(d.excludedAmount),
    };
  }

  /** 1行の入力をチェックする（エラーは画面に出す）。保存できる入力なら返す */
  private checkRow(row: SalaryRow): SalaryInput | null {
    const id = row.employee.id;
    const input = this.toInput(this.drafts()[id]);
    const errors: SalaryErrors & { form?: string } = validateSalary(input);
    if (!errors.paidDate && !input.paidDate.startsWith(this.yearMonth()))
      errors.paidDate = `支払日は${yearMonthLabel(this.yearMonth())}の日付にしてください（随時改定は支払月で数えます）`;
    if (!row.officeId) errors.form = 'この月に所属している適用事業所がありません';
    if (row.closed) errors.form = 'この月は確定済みです。月次保険料一覧で確定を解除してから入力してください';
    this.errors.update((e) => ({ ...e, [id]: errors }));
    return Object.keys(errors).length > 0 ? null : input;
  }

  /** 1行を保存する（読み込み直しはしない）。うまくいけば true */
  private async persist(row: SalaryRow, input: SalaryInput): Promise<boolean> {
    const id = row.employee.id;
    try {
      await this.salaryRepo.save(
        {
          employeeId: id,
          paidDate: input.paidDate,
          fixedWages: input.fixedWages!,
          nonFixedWages: input.nonFixedWages ?? 0,
          paymentBaseDays: input.paymentBaseDays!,
          retroactiveDiff: input.retroactiveDiff || null,
          inKindWages: input.inKindWages || null,
          workingHours: input.workingHours ?? null,
          hourlyRate: input.hourlyRate ?? null,
          // 算定から除く額は、除く必要がある変更月だけ保存する
          excludedAmount: needsExclusion(row.periodChange) ? input.excludedAmount || null : null,
        },
        row.officeId!,
      );
      // 支払日を直したときは、前の支払日の給与を消す（同じ月に2件にならないように）
      if (row.existing && row.existing.paidDate !== input.paidDate) await this.salaryRepo.remove(row.existing.id);
      return true;
    } catch (e) {
      console.error(e);
      this.errors.update((x) => ({ ...x, [id]: { form: '保存できませんでした。権限と通信を確かめてください。' } }));
      return false;
    }
  }

  protected async save(row: SalaryRow): Promise<void> {
    const id = row.employee.id;
    const input = this.checkRow(row);
    if (!input) return;
    this.saving.set(id);
    try {
      const ok = await this.persist(row, input);
      // ほかの行の、保存していない入力は残す
      await this.loadMonth(true);
      if (ok) {
        this.drafts.update((d) => ({ ...d, [id]: this.baselines()[id] ?? d[id] }));
        this.notice.set(`${row.employee.name}さんの給与（${dateLabel(input.paidDate)}支払）を保存しました。`);
      }
    } finally {
      this.saving.set(null);
    }
  }

  /** 保存していない行を、まとめて保存する。入力に誤りのある行は保存せず、エラーを出して残す */
  protected async saveAll(): Promise<void> {
    const targets = this.rows().filter((r) => this.isUnsaved(r.employee.id) && !r.closed);
    if (targets.length === 0) return;
    this.saving.set('all');
    const saved: string[] = [];
    let invalid = 0;
    let failed = 0;
    try {
      for (const row of targets) {
        const input = this.checkRow(row);
        if (!input) {
          invalid++;
          continue;
        }
        if (await this.persist(row, input)) saved.push(row.employee.id);
        else failed++;
      }
      await this.loadMonth(true);
      // 保存できた行は、登録済みの値に戻す（未保存の印を消す）
      this.drafts.update((d) => {
        const next = { ...d };
        for (const id of saved) if (this.baselines()[id]) next[id] = this.baselines()[id];
        return next;
      });
      const rest = [invalid > 0 ? `入力に誤りがある${invalid}人` : '', failed > 0 ? `保存できなかった${failed}人` : ''].filter((x) => x);
      this.notice.set(
        rest.length === 0
          ? `${saved.length}人の給与を保存しました。`
          : `${saved.length}人の給与を保存しました。${rest.join('・')}は保存していません（赤い文字の行を直して、もう一度保存してください）。`,
      );
    } finally {
      this.saving.set(null);
    }
  }

  protected async remove(row: SalaryRow): Promise<void> {
    if (!row.existing) return;
    const ok = await this.confirm.ask({
      title: '給与を削除しますか',
      message: `${row.employee.name}さんの給与（${dateLabel(row.existing.paidDate)}支払）を削除します。元に戻せません。`,
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(row.employee.id);
    try {
      await this.salaryRepo.remove(row.existing.id);
      await this.loadMonth(true);
      this.notice.set(`${row.employee.name}さんの給与（${dateLabel(row.existing.paidDate)}支払）を削除しました。`);
    } catch (e) {
      console.error(e);
      this.notice.set('削除できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(null);
    }
  }

  // ---- 固定的賃金の変動として登録（設計書 2.13） ----
  /** 登録の入力欄を開いている人 */
  protected readonly manualFor = signal<string | null>(null);
  protected readonly manualForm = signal<{ direction: 'up' | 'down'; note: string }>({ direction: 'up', note: '' });
  protected readonly manualError = signal('');

  protected openManual(row: SalaryRow): void {
    this.manualFor.set(row.employee.id);
    this.manualForm.set({ direction: 'up', note: '' });
    this.manualError.set('');
  }

  /** 従業員の変更の記録を残す（残せなくても、保存した内容はそのまま。設計書 3.1） */
  private async log(employeeId: string, text: string): Promise<void> {
    try {
      await this.employeeRepo.addChangeLog(employeeId, text);
    } catch (e) {
      console.error('変更の記録を残せませんでした', e);
    }
  }

  protected closeManual(): void {
    this.manualFor.set(null);
  }

  protected setManual(key: 'direction' | 'note', value: string): void {
    this.manualForm.update((f) => ({ ...f, [key]: value }));
  }

  protected async saveManual(row: SalaryRow): Promise<void> {
    const f = this.manualForm();
    const note = f.note.trim();
    if (!note) {
      this.manualError.set('内容を入力してください（例：所定労働時間の変更、手当の新設）');
      return;
    }
    const ym = this.yearMonth();
    const message = `${row.employee.name}さんの${yearMonthLabel(ym)}を、固定的賃金の変動（${f.direction === 'up' ? '上がった' : '下がった'}）として登録しました。`;
    await this.runManual(async () => {
      await this.employeeRepo.setFixedWageChange(row.employee.id, { yearMonth: ym, direction: f.direction, note });
      await this.log(row.employee.id, `${message}（内容：${note}）`);
    }, message);
  }

  protected async removeManual(row: SalaryRow): Promise<void> {
    const ym = this.yearMonth();
    const ok = await this.confirm.ask({
      title: '固定的賃金の変動の登録を取り消しますか',
      message: `${row.employee.name}さんの${yearMonthLabel(ym)}の登録を取り消します。随時改定の候補から外れることがあります。`,
      ok: '取り消す',
      danger: true,
    });
    if (!ok) return;
    const message = `${row.employee.name}さんの${yearMonthLabel(ym)}の、固定的賃金の変動の登録を取り消しました。`;
    await this.runManual(async () => {
      await this.employeeRepo.removeFixedWageChange(row.employee.id, ym);
      await this.log(row.employee.id, message);
    }, message);
  }

  private async runManual(action: () => Promise<void>, message: string): Promise<void> {
    this.saving.set('manual');
    try {
      await action();
      this.employees.set(await this.employeeRepo.loadAll());
      this.manualFor.set(null);
      this.notice.set(message);
    } catch (e) {
      console.error(e);
      this.manualError.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(null);
    }
  }

  protected changeLabel(c: FixedWageChange): string {
    const dir = c.direction === 'up' ? '上がった' : '下がった';
    if (c.basis === 'hourlyRate') return `変動あり（時給 ${this.yen(c.before)}→${this.yen(c.after)}円）`;
    if (c.basis === 'manual') return `変動として登録（${dir}）`;
    return `変動あり（${dir}）`;
  }

  protected err(id: string, key: keyof SalaryInput | 'form'): string {
    return this.errors()[id]?.[key] ?? '';
  }

  /** 入力を、登録済みの値に戻す（保存していない行の入力を取り消す） */
  protected revert(row: SalaryRow): void {
    const id = row.employee.id;
    const base = this.baselines()[id];
    if (!base) return;
    this.drafts.update((d) => ({ ...d, [id]: base }));
    this.errors.update((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }

}
