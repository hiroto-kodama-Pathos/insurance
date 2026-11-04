// 納付書・給与の控除額との照合（設計書 2.28・3.13）
// 保険料の月を選び、納付書の金額（事業所ごと）と給与ソフトの控除額（従業員ごと）を、アプリの計算と比べる。
// 入力した金額だけを保存し、差と原因の候補は表示のたびに計算する。確定済みの事業所は確定した結果と比べる。
import { RouterLink } from '@angular/router';
import { Confirm } from '../../core/ui/confirm';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { FormSnapshot, HasUnsavedChanges } from '../../core/ui/unsaved-guard';
import { Auth } from '../../core/auth/auth';
import { BonusRecord, calcEmployeeBonuses, fiscalYearOf } from '../../core/calc/bonus-premium';
import { bonusAsMonthResult, mergeBonusesWithClosings, mergeWithClosings, OfficeClosing } from '../../core/calc/closing';
import { decodeCsv, parseCsv, parseNumberLoose } from '../../core/calc/csv';
import { payMonthFor } from '../../core/calc/deduction';
import { calcEmployeeMonth, findEffective, Masters } from '../../core/calc/employee-month';
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { summarizeMonth } from '../../core/calc/monthly-summary';
import { legacyGroup, PayrollGroup, payrollGroupAt } from '../../core/calc/payroll-group';
import {
  buildDeductionPreview,
  CauseInput,
  compareDeduction,
  compareNotice,
  DEDUCTION_KEYS,
  DEDUCTION_LABEL,
  deductionCauses,
  DeductionLines,
  DeductionPreviewRow,
  deductionTemplateCsv,
  employeeDeduction,
  expectedPayments,
  LineAmounts,
  MATCH_LABEL,
  NOTICE_GENERAL_CAUSES,
  noticeCauses,
  PAYMENT_LINE_LABEL,
  PAYMENT_LINES,
} from '../../core/calc/reconcile';
import { addMonths } from '../../core/calc/salary';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { SettlementRecord, settledAmountFor } from '../../core/calc/adjustment';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { ReconcileRepository } from '../../core/repository/reconcile-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';
import { yearMonthLabel } from '../../core/calc/year-month';

/** 前月（日本時間） */
export function previousMonth(): string {
  const ym = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
  return addMonths(ym, -1);
}

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe],
  selector: 'app-reconcile-page',
  styleUrl: './reconcile-page.scss',
  templateUrl: './reconcile-page.html',
})
export class ReconcilePage implements OnInit, HasUnsavedChanges {
  private readonly auth = inject(Auth);
  private readonly confirm = inject(Confirm);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly bonusRepo = inject(BonusRepository);
  private readonly adjustmentRepo = inject(AdjustmentRepository);
  private readonly reconcileRepo = inject(ReconcileRepository);

  protected readonly lines = PAYMENT_LINES;
  protected readonly lineLabels = PAYMENT_LINE_LABEL;
  protected readonly dKeys = DEDUCTION_KEYS;
  protected readonly dLabels = DEDUCTION_LABEL;
  protected readonly matchLabels = MATCH_LABEL;
  protected readonly generalCauses = NOTICE_GENERAL_CAUSES;

  /** 保険料の月（納付書は前月分が届くので、初めは前月） */
  protected readonly yearMonth = signal(previousMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** デフォルトで「差あり」のみを表示する（設計書 2.28・3.13） */
  protected readonly onlyDiff = signal(true);
  /** 未入力を表示するか */
  protected readonly showNotEntered = signal(false);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  private readonly rounding = signal<ChildSupportRounding>('combined');
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  private readonly settlements = signal<SettlementRecord[]>([]);
  private readonly closings = signal<OfficeClosing[]>([]);
  private readonly fyBonuses = signal<BonusRecord[]>([]);
  /** 入力した納付書の金額（事業所ID → 欄ごとの金額） */
  private readonly notices = signal<Map<string, LineAmounts>>(new Map());
  /** 入力した給与の控除額（従業員ID → 金額） */
  private readonly deductions = signal<Map<string, DeductionLines>>(new Map());

  protected readonly scope = computed(() => this.auth.user()?.siScope ?? 'all');
  private readonly inScope = (officeId: string | null) => this.scope() === 'all' || officeId === this.scope();

  // ---- その月の計算結果（確定済みの事業所は確定した結果） ----

  private readonly monthRows = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    const live = this.employees().map((e) => ({ employee: e, result: calcEmployeeMonth(e, m, ym, this.rounding()) }));
    return mergeWithClosings(live, this.closings());
  });

  private readonly bonusRows = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    const live = this.employees()
      .flatMap((e) => calcEmployeeBonuses(e, this.fyBonuses(), m, this.rounding()).map((result) => ({ employee: e, result })))
      .filter((r) => r.result.yearMonth === ym && r.result.target !== 'outside' && r.result.status !== 'remuneration');
    return mergeBonusesWithClosings(live, this.closings());
  });

  /** 原因の候補を探すための、1人ずつの前月とその月の結果 */
  private readonly causeInputs = computed<CauseInput[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    const prevYm = addMonths(ym, -1);
    const cur = new Map(this.monthRows().map((r) => [r.employee.id, r.result]));
    return this.employees().map((e) => ({
      employeeId: e.id,
      label: `${e.employeeNumber} ${e.name}`,
      prev: calcEmployeeMonth(e, m, prevYm, this.rounding()),
      cur: cur.get(e.id) ?? calcEmployeeMonth(e, m, ym, this.rounding()),
      provisional: !!findEffective(e.standardHistory, ym)?.provisional,
    }));
  });

  // ---- 納付書 ----

  private readonly expected = computed(() =>
    expectedPayments(
      summarizeMonth(this.yearMonth(), this.monthRows().map((r) => r.result)),
      summarizeMonth(this.yearMonth(), this.bonusRows().map((r) => bonusAsMonthResult(r.result))),
    ),
  );

  protected readonly noticeRows = computed(() => {
    const m = this.masters();
    if (!m) return [];
    const exp = this.expected();
    const entered = this.notices();
    const closed = new Set(this.closings().map((c) => c.officeId));
    const payees = this.bonusRows().map((b) => ({
      employeeId: b.employee.id,
      label: `${b.employee.employeeNumber} ${b.employee.name}`,
      officeId: b.result.officeId,
      amount: b.result.bonus.amount,
    }));
    return m.offices
      .filter((o) => this.inScope(o.id) && (exp.has(o.id) || entered.has(o.id)))
      .map((o) => {
        const c = compareNotice(o.id, exp.get(o.id), entered.get(o.id) ?? null);
        return {
          ...c,
          officeName: o.name,
          closed: closed.has(o.id),
          causes: c.status === 'diff' ? noticeCauses(o.id, this.causeInputs(), payees) : [],
        };
      });
  });

  // ---- 給与の控除額 ----

  protected readonly deductionRows = computed(() => {
    const ym = this.yearMonth();
    const inputs = new Map(this.causeInputs().map((x) => [x.employeeId, x]));
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    const entered = this.deductions();
    return this.monthRows()
      .filter((r) => r.result.status === 'ok' && this.inScope(r.result.officeId))
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber))
      .map((r) => {
        const e = byId.get(r.employee.id);
        const g = payrollGroupAt(this.groups(), e?.payrollAssignments, monthEnd(ym));
        const payYm = e ? payMonthFor(ym, g.deductionTiming, e.qualifications, g.paidIn === 'sameMonth') : ym;
        const c = compareDeduction(employeeDeduction(r.result), entered.get(r.employee.id) ?? null);
        const input = inputs.get(r.employee.id);
        const settled = settledAmountFor(r.employee.id, payYm, this.settlements());
        return {
          employeeId: r.employee.id,
          officeId: r.result.officeId ?? '',
          label: `${r.employee.employeeNumber} ${r.employee.name}`,
          payYm,
          ...c,
          causes: input ? deductionCauses(c, input, settled) : [],
        };
      });
  });

  protected readonly shownDeductions = computed(() => {
    const rows = this.deductionRows();
    if (!this.onlyDiff()) return rows; // 「一致した人を隠す」がオフの場合はすべて表示
    // 「一致した人を隠す」がオンの場合は「差あり」を常に表示
    const filtered = rows.filter((r) => r.status === 'diff' || (r.status === 'notEntered' && this.showNotEntered()));
    return filtered;
  });

  protected readonly deductionCounts = computed(() => {
    const rows = this.deductionRows();
    return {
      match: rows.filter((r) => r.status === 'match').length,
      diff: rows.filter((r) => r.status === 'diff').length,
      notEntered: rows.filter((r) => r.status === 'notEntered').length,
    };
  });

  // ---- 読み込み ----

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, groups, settlements] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
        this.settingsRepo.loadPayrollGroups(),
        this.adjustmentRepo.loadSettlements(),
      ]);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.groups.set(groups);
      this.settlements.set(settlements);
      await this.loadMonth();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMonth(): Promise<void> {
    const ym = this.yearMonth();
    const [closings, bonuses, notices, deductions] = await Promise.all([
      this.closingRepo.loadMonth(ym),
      this.bonusRepo.loadFiscalYear(fiscalYearOf(`${ym}-01`)),
      this.reconcileRepo.loadNotices(ym),
      this.reconcileRepo.loadDeductions(ym),
    ]);
    this.closings.set(closings);
    this.fyBonuses.set(bonuses);
    this.notices.set(notices);
    this.deductions.set(deductions);
  }

  protected async setMonth(value: string): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    this.yearMonth.set(value);
    this.cancelEdit();
    this.preview.set(null);
    this.notice.set(null);
    await this.loadMonth();
  }

  // ---- 納付書の金額の入力 ----

  protected readonly editingOffice = signal<string | null>(null);
  protected readonly noticeDraft = signal<Record<string, string>>({});
  protected readonly draftError = signal<string | null>(null);

  protected editNotice(officeId: string): void {
    const cur = this.notices().get(officeId);
    this.editingEmployee.set(null);
    this.editingOffice.set(officeId);
    this.draftError.set(null);
    this.noticeDraft.set(Object.fromEntries(PAYMENT_LINES.map((l) => [l, cur ? String(cur[l]) : ''])));
    this.draftSnapshot.takeNow();
  }

  /** 開いたときの金額（画面を移る前の確認に使う） */
  private readonly draftSnapshot = new FormSnapshot(() => this.noticeDraft());
  /** 画面を移る前の確認に使う（unsavedChangesGuard）。納付書の金額・控除額の入力を変えていれば1件 */
  unsavedCount(): number {
    return (this.editingOffice() !== null || this.editingEmployee() !== null) && this.draftSnapshot.changed() ? 1 : 0;
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }

  protected setDraft(key: string, value: string): void {
    this.noticeDraft.update((d) => ({ ...d, [key]: value }));
  }

  /** 入力欄の文字を金額にする（空欄は0）。読めなければ null */
  private parseDraft<K extends string>(keys: readonly K[]): Record<K, number> | null {
    const out = {} as Record<K, number>;
    for (const k of keys) {
      const v = parseNumberLoose(this.noticeDraft()[k] ?? '');
      if (v !== null && (Number.isNaN(v) || v < 0)) return null;
      out[k] = v ?? 0;
    }
    return out;
  }

  protected async saveNotice(): Promise<void> {
    const officeId = this.editingOffice();
    if (!officeId) return;
    const lines = this.parseDraft(PAYMENT_LINES);
    if (!lines) {
      this.draftError.set('金額は0以上の整数で入力してください');
      return;
    }
    await this.save(async () => {
      await this.reconcileRepo.saveNotice(this.yearMonth(), officeId, lines);
      this.notices.update((m) => new Map(m).set(officeId, lines));
      this.cancelEdit();
      this.notice.set('納付書の金額を保存しました');
    });
  }

  protected async removeNotice(officeId: string): Promise<void> {
    const ok = await this.confirm.ask({ title: '納付書の金額を消しますか', message: `${yearMonthLabel(this.yearMonth())}分の納付書の金額を消します。`, ok: '消す', danger: true });
    if (!ok) return;
    await this.save(async () => {
      await this.reconcileRepo.removeNotice(this.yearMonth(), officeId);
      this.notices.update((m) => {
        const n = new Map(m);
        n.delete(officeId);
        return n;
      });
      this.notice.set('納付書の金額を消しました');
    });
  }

  // ---- 給与の控除額の入力 ----

  protected readonly editingEmployee = signal<string | null>(null);

  protected editDeduction(employeeId: string): void {
    const cur = this.deductions().get(employeeId);
    this.editingOffice.set(null);
    this.editingEmployee.set(employeeId);
    this.draftError.set(null);
    this.noticeDraft.set(Object.fromEntries(DEDUCTION_KEYS.map((k) => [k, cur ? String(cur[k]) : ''])));
    this.draftSnapshot.takeNow();
  }

  protected async saveDeduction(): Promise<void> {
    const employeeId = this.editingEmployee();
    if (!employeeId) return;
    const amounts = this.parseDraft(DEDUCTION_KEYS);
    if (!amounts) {
      this.draftError.set('金額は0以上の整数で入力してください');
      return;
    }
    await this.save(async () => {
      await this.reconcileRepo.saveDeductions(this.yearMonth(), [{ employeeId, officeId: this.officeOf(employeeId), amounts }]);
      this.deductions.update((m) => new Map(m).set(employeeId, amounts));
      this.cancelEdit();
      this.notice.set('給与の控除額を保存しました');
    });
  }

  protected async removeDeduction(employeeId: string): Promise<void> {
    const ok = await this.confirm.ask({ title: '給与の控除額を消しますか', message: `${yearMonthLabel(this.yearMonth())}分の給与の控除額を消します。`, ok: '消す', danger: true });
    if (!ok) return;
    await this.save(async () => {
      await this.reconcileRepo.removeDeduction(employeeId, this.yearMonth());
      this.deductions.update((m) => {
        const n = new Map(m);
        n.delete(employeeId);
        return n;
      });
      this.notice.set('給与の控除額を消しました');
    });
  }

  /** その月の所属事業所（控除額に保存し、担当範囲のルールに使う） */
  private officeOf(employeeId: string): string {
    return this.deductionRows().find((r) => r.employeeId === employeeId)?.officeId ?? '';
  }

  protected cancelEdit(): void {
    this.editingOffice.set(null);
    this.editingEmployee.set(null);
    this.draftError.set(null);
  }

  // ---- 給与の控除額のCSV ----

  protected readonly preview = signal<DeductionPreviewRow[] | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly fileName = signal('');
  protected readonly previewOk = computed(() => (this.preview() ?? []).filter((r) => r.employeeId && r.amounts));

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.loadCsv(file.name, decodeCsv(new Uint8Array(await file.arrayBuffer())));
    input.value = '';
  }

  /** CSVの文字列を読んで、プレビューを作る */
  protected loadCsv(name: string, text: string): void {
    this.fileName.set(name);
    this.notice.set(null);
    const allowed = new Set(this.deductionRows().map((r) => r.employeeId));
    const result = buildDeductionPreview(parseCsv(text), this.employees(), allowed);
    if (typeof result === 'string') {
      this.preview.set(null);
      this.previewError.set(result);
      return;
    }
    this.previewError.set(null);
    this.preview.set(result);
  }

  protected async importPreview(): Promise<void> {
    const list = this.previewOk().map((r) => ({ employeeId: r.employeeId!, officeId: this.officeOf(r.employeeId!), amounts: r.amounts! }));
    if (list.length === 0) return;
    await this.save(async () => {
      await this.reconcileRepo.saveDeductions(this.yearMonth(), list);
      this.deductions.update((m) => {
        const n = new Map(m);
        for (const x of list) n.set(x.employeeId, x.amounts);
        return n;
      });
      this.preview.set(null);
      this.notice.set(`給与の控除額を${list.length}人分取り込みました`);
    });
  }

  protected cancelPreview(): void {
    this.preview.set(null);
    this.previewError.set(null);
  }

  protected templateHref(): string {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + deductionTemplateCsv());
  }

  private async save(fn: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      this.error.set('保存できませんでした。ログインと権限を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : v.toLocaleString('ja-JP');
  }

  protected signed(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return v === 0 ? '0' : `${v > 0 ? '+' : ''}${v.toLocaleString('ja-JP')}`;
  }
}
