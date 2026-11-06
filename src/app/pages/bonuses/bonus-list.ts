// 賞与の登録と賞与保険料一覧（設計書 2.4・3.3）
// 支払う前に支給日と賞与額を登録し、上限・免除・喪失月を判定した保険料と、賞与支払届の期限を確かめる。
import { saveTableCsv } from '../../core/ui/table-csv';
import { PageState } from '../../core/ui/page-state';
import { distinctOptions, matchesPerson } from '../../core/calc/person-search';
import { RouterLink } from '@angular/router';
import { Confirm } from '../../core/ui/confirm';
import { focusFormSoon } from '../../core/ui/form-focus';
import { NoticeMessage } from '../../core/ui/notice-message';
import { leaveExemptLabel } from '../../core/calc/eligibility';
import { bonusExemptingLeave } from '../../core/calc/bonus-premium';
import { FilingRepository } from '../../core/repository/filing-repository';
import { isValidDate } from '../../core/calc/new-employee';
import { Component, computed, HostListener, inject, OnInit, signal, ElementRef } from '@angular/core';
import { HasUnsavedChanges } from '../../core/ui/unsaved-guard';
import { BonusErrors, BonusInput, bonusReportAmounts, validateBonus } from '../../core/calc/bonus-input';
import { isPensionAge } from '../../core/calc/age';
import { BonusType, fourthBonusWarning, isRemunerationBonus } from '../../core/calc/bonus-type';
import {
  BonusRecord,
  BonusResult,
  bonusReportDeadline,
  calcEmployeeBonuses,
  fiscalYearOf,
} from '../../core/calc/bonus-premium';
import { bonusAsMonthResult, mergeBonusesWithClosings, OfficeClosing } from '../../core/calc/closing';
import { Masters } from '../../core/calc/employee-month';
import { findOffice } from '../../core/calc/office';
import { careNote, ChildSupportRounding } from '../../core/calc/monthly-premium';
import { PaymentLine, summarizeMonth } from '../../core/calc/monthly-summary';
import { PremiumResult, senToDisplayYen } from '../../core/calc/premium-calculator';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { parseNumberInput } from '../../core/calc/half-width';
import { DateLabelPipe, YearMonthPipe } from '../../core/ui/year-month.pipe';
import { dateLabel } from '../../core/calc/year-month';

export type BonusRow = {
  employee: { id: string; employeeNumber: string; name: string };
  result: BonusResult;
  officeName: string;
  /** 確定済みの結果か（削除できない） */
  closed: boolean;
};

/** 賞与支払届（事業所 × 支給日ごとに1件） */
export type BonusReport = { officeId: string; officeName: string; paidDate: string; count: number; deadline: string };

const LINE_LABEL: Record<PaymentLine, string> = {
  healthCare: '健康保険（介護保険を含む）',
  childSupport: '子ども・子育て支援金',
  pension: '厚生年金保険',
};

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe, DateLabelPipe],
  selector: 'app-bonus-list',
  styleUrl: './bonus-list.scss',
  templateUrl: './bonus-list.html',
})
export class BonusList implements OnInit, HasUnsavedChanges {
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  /** 表示している一覧（絞り込み・並び替えのあと）を、画面と同じ列でCSVに保存する（core/ui/table-csv.ts） */
  protected saveCsv(selector: string, fileName: string): void {
    saveTableCsv(this.host, selector, fileName);
  }

  private readonly bonusRepo = inject(BonusRepository);
  private readonly confirm = inject(Confirm);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly filingRepo = inject(FilingRepository);
  /** 届出済みにした届出（産休・育休の取得者申出書の「申出待ち」の表示に使う） */
  private readonly filedIds = signal<Set<string>>(new Set());

  protected readonly lineLabels = LINE_LABEL;
  protected readonly lines: PaymentLine[] = ['healthCare', 'childSupport', 'pension'];

  protected readonly yearMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  private readonly rounding = signal<ChildSupportRounding>('combined');
  /** 表示している月の年度の賞与（上限の計算に年度分すべてが要る） */
  private readonly fyBonuses = signal<BonusRecord[]>([]);
  private loadedFy = '';
  /** 表示している月の確定 */
  private readonly closings = signal<OfficeClosing[]>([]);

  // 登録フォーム
  protected readonly form = signal<BonusInput>({ employeeId: '', paidDate: '', amount: null, inKindAmount: null, bonusTypeId: '' });
  /**
   * 画面を移る前の確認に使う（unsavedChangesGuard）。従業員・支給額・現物のどれかを入れていれば1件
   * 支給日・賞与の種類は、続けて登録しやすいよう登録のあとも残すので、数えない
   */
  unsavedCount(): number {
    const f = this.form();
    return f.employeeId !== '' || f.amount !== null || f.inKindAmount !== null ? 1 : 0;
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }
  protected readonly bonusTypes = signal<BonusType[]>([]);
  /** 選んだ種類で、この賞与が報酬扱いになるか */
  protected readonly formIsRemuneration = computed(() => {
    const f = this.form();
    return !!f.paidDate && isRemunerationBonus(this.bonusTypes(), f.bonusTypeId, f.paidDate);
  });
  /** 支給日の年度の賞与（表示している対象月と年度が違うときは、別に読む） */
  private readonly paidFyBonuses = signal<{ fy: string; list: BonusRecord[] } | null>(null);
  /** 報酬扱いでない賞与が同じ年度で4回目になる（年4回以上支給の設定がない） */
  protected readonly fourthWarning = computed(() => {
    const f = this.form();
    if (!f.employeeId || !isValidDate(f.paidDate) || this.formIsRemuneration()) return null;
    const fy = fiscalYearOf(f.paidDate);
    const other = this.paidFyBonuses();
    const list = fy === this.loadedFyName() ? this.fyBonuses() : other?.fy === fy ? other.list : null;
    return list ? fourthBonusWarning(list, f.employeeId, f.paidDate) : null;
  });
  private readonly loadedFyName = signal('');
  protected readonly errors = signal<BonusErrors>({});

  /** 登録の候補にする従業員（社員番号順） */
  protected readonly employeeOptions = computed(() =>
    [...this.employees()].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber)),
  );
  /** 登録欄の従業員の検索（氏名・社員番号。空白は無視） */
  protected readonly employeeQuery = signal('');
  /** 直している賞与のID（登録のフォームを、直す入力として使う） */
  protected readonly editingId = signal<string | null>(null);
  /** 直す前の賞与（確定済みの月かどうかと、全事業所の合計を引き継ぐのに使う） */
  private editingBonus: { yearMonth: string; officeId: string; totalAmount: number | null } | null = null;

  /** 一覧の賞与を、登録のフォームに入れて直す */
  protected startEdit(row: BonusRow): void {
    const b = row.result.bonus;
    this.editingId.set(b.id);
    this.editingBonus = { yearMonth: b.paidDate.slice(0, 7), officeId: row.result.officeId ?? '', totalAmount: b.totalAmount ?? null };
    this.employeeQuery.set('');
    this.errors.set({});
    this.form.set({ employeeId: b.employeeId, paidDate: b.paidDate, amount: b.amount, inKindAmount: b.inKindAmount ?? null, bonusTypeId: b.bonusTypeId ?? '' });
    focusFormSoon('app-bonus-list');
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editingBonus = null;
    this.errors.set({});
    this.form.set({ employeeId: '', paidDate: this.form().paidDate, amount: null, inKindAmount: null, bonusTypeId: '' });
  }
  /** 選択肢を検索で絞ったもの。選んでいる人は、検索に合わなくても残す（選び直しにならないように） */
  protected readonly filteredEmployeeOptions = computed(() => {
    const q = this.employeeQuery();
    const selected = this.form().employeeId;
    return this.employeeOptions().filter((e) => e.id === selected || matchesPerson(e.employeeNumber, e.name, q));
  });
  /** 検索して1人に絞れたら、その人を選ぶ */
  protected setEmployeeQuery(value: string): void {
    this.employeeQuery.set(value);
    const hits = this.employeeOptions().filter((e) => matchesPerson(e.employeeNumber, e.name, value));
    if (value.trim() !== '' && hits.length === 1) this.setForm('employeeId', hits[0].id);
  }

  /** 表示している月に払う（払った）賞与。確定済みの事業所は保存した結果を使う */
  // ---- 絞り込み（設計書 3.3） ----
  protected readonly query = signal('');
  protected readonly officeFilter = signal('');
  protected readonly paidDateFilter = signal('');

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('bonuses.yearMonth', this.yearMonth);
    pageState.keep('bonuses.query', this.query);
    pageState.keep('bonuses.officeFilter', this.officeFilter);
    pageState.keep('bonuses.paidDateFilter', this.paidDateFilter);
    return true;
  })(inject(PageState));
  /** 絞り込みの選択肢（この月の賞与に出てくる事業所・支給日） */
  protected readonly officeOptions = computed(() => distinctOptions(this.rows().map((r) => r.officeName)));
  protected readonly paidDateOptions = computed(() => distinctOptions(this.rows().map((r) => r.result.bonus.paidDate)).sort());
  /** 表に出す行 */
  protected readonly shownRows = computed(() =>
    this.rows().filter(
      (r) =>
        matchesPerson(r.employee.employeeNumber, r.employee.name, this.query()) &&
        (this.officeFilter() === '' || r.officeName === this.officeFilter()) &&
        (this.paidDateFilter() === '' || r.result.bonus.paidDate === this.paidDateFilter()),
    ),
  );

  protected readonly rows = computed<BonusRow[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    const live = this.employees()
      .flatMap((e) =>
        calcEmployeeBonuses(e, this.fyBonuses(), m, this.rounding()).map((result) => ({ employee: e, result })),
      )
      .filter((r) => r.result.yearMonth === ym);
    const liveById = new Map(live.map((r) => [r.result.bonus.id, r.result]));
    return mergeBonusesWithClosings(live, this.closings())
      .map((r) => {
        // 確定済みの賞与も、あとから登録した全事業所の合計で決定後の過不足を出す（確定時に控除した額との差）
        const l = liveById.get(r.result.bonus.id) ?? this.liveResult(r.result.bonus.id);
        if (!r.closed || !l) return r;
        const sum = (p: BonusResult['premium']) =>
          p ? Number([p.health, p.care, p.childSupport, p.pension].reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n)) : 0;
        const result: BonusResult = {
          ...r.result,
          bonus: { ...r.result.bonus, totalAmount: l.bonus.totalAmount ?? null },
          multiOffice: l.multiOffice,
          decided: l.decided,
          decidedDiff: l.decided ? sum(l.decided.premium) - sum(r.result.premium) : undefined,
        };
        return { ...r, result };
      })
      .map((r) => ({ ...r, officeName: m.offices.find((o) => o.id === r.result.officeId)?.name ?? '' }))
      .sort(
        (a, b) =>
          a.result.bonus.paidDate.localeCompare(b.result.bonus.paidDate) ||
          a.employee.employeeNumber.localeCompare(b.employee.employeeNumber),
      );
  });

  /** 小計・会社合計（月額と同じ集計を使う） */
  protected readonly summary = computed(() =>
    summarizeMonth(
      this.yearMonth(),
      this.rows().map((r) => bonusAsMonthResult(r.result)),
    ),
  );

  /** 賞与支払届：保険料がかからない賞与（免除・喪失月）も届け出るので含める */
  protected readonly reports = computed<BonusReport[]>(() => {
    const map = new Map<string, BonusReport>();
    for (const r of this.rows()) {
      if (r.result.target === 'outside' || r.result.status === 'remuneration' || !r.result.officeId) continue;
      const key = `${r.result.officeId}|${r.result.bonus.paidDate}`;
      const cur = map.get(key);
      if (cur) cur.count++;
      else
        map.set(key, {
          officeId: r.result.officeId,
          officeName: r.officeName,
          paidDate: r.result.bonus.paidDate,
          count: 1,
          deadline: bonusReportDeadline(r.result.bonus.paidDate),
        });
    }
    return [...map.values()].sort((a, b) => a.deadline.localeCompare(b.deadline));
  });

  /** 届け出る賞与額（人ごと。同じ月の2回以上の支給は合算し、1,000円未満を切り捨て。設計書 2.4） */
  protected readonly reportAmounts = computed(() => {
    const rows = this.rows().filter((r) => r.result.target !== 'outside' && r.result.status !== 'remuneration');
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return bonusReportAmounts(rows.map((r) => r.result.bonus))
      .map((a) => {
        const e = byId.get(a.employeeId);
        const notes: string[] = [];
        if (a.paidDates.length > 1) notes.push(`同じ月に${a.paidDates.length}回の支給を合算`);
        if (e?.birthDate && !isPensionAge(e.birthDate, a.yearMonth)) notes.push('70歳以上被用者');
        if (rows.some((r) => r.employee.id === a.employeeId && r.result.multiOffice)) notes.push('二以上事業所勤務');
        return { ...a, employee: rows.find((r) => r.employee.id === a.employeeId)!.employee, notes };
      })
      .sort((x, y) => x.employee.employeeNumber.localeCompare(y.employee.employeeNumber));
  });

  /** その場で計算した、賞与1件の結果（確定済みの行に、決定後の過不足を付けるため） */
  private liveResult(bonusId: string): BonusResult | undefined {
    const m = this.masters();
    if (!m) return undefined;
    const b = this.fyBonuses().find((x) => x.id === bonusId);
    const e = b && this.employees().find((x) => x.id === b.employeeId);
    return e ? calcEmployeeBonuses(e, this.fyBonuses(), m, this.rounding()).find((r) => r.bonus.id === bonusId) : undefined;
  }

  /** 全事業所の賞与額の合計の入力（賞与ID → 入力中の文字） */
  protected readonly totalInputs = signal<Record<string, string>>({});
  protected readonly editingTotal = signal<string | null>(null);

  protected openTotal(row: BonusRow): void {
    this.editingTotal.set(row.result.bonus.id);
    this.totalInputs.update((m) => ({ ...m, [row.result.bonus.id]: String(row.result.bonus.totalAmount ?? '') }));
  }

  protected setTotalInput(id: string, value: string): void {
    this.totalInputs.update((m) => ({ ...m, [id]: value }));
  }

  /** 二以上事業所勤務：全事業所の賞与額の合計を登録する */
  protected async saveTotal(row: BonusRow): Promise<void> {
    const id = row.result.bonus.id;
    const total = parseNumberInput(this.totalInputs()[id]);
    if (total !== null && (!Number.isInteger(total) || total <= row.result.bonus.amount)) {
      this.notice.set('全事業所の合計は、自社の賞与額より大きい円の額で入力してください（空欄にすると消します）。');
      return;
    }
    this.saving.set(true);
    try {
      await this.bonusRepo.setTotalAmount(id, total);
      await this.loadBonuses(true);
      this.editingTotal.set(null);
      this.notice.set(
        total === null
          ? `${row.employee.name}さんの全事業所の合計を消しました。`
          : `${row.employee.name}さんの全事業所の賞与額の合計（${this.yen(total)}円）を登録しました。`,
      );
    } catch (e) {
      console.error(e);
      this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected signedYen(v: number): string {
    return (v > 0 ? '+' : '') + v.toLocaleString('ja-JP');
  }

  protected decidedEmployeeTotal(r: BonusResult): string {
    const p = r.decided?.premium;
    if (!p) return '';
    return this.yen([p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, filedIds] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
        this.filingRepo.loadFiledIds(),
      ]);
      this.filedIds.set(filedIds);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.bonusTypes.set(await this.settingsRepo.loadBonusTypes());
      await this.loadBonuses(true);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadBonuses(force = false): Promise<void> {
    const ym = this.yearMonth();
    const fy = fiscalYearOf(`${ym}-01`);
    const closings = await this.closingRepo.loadMonth(ym);
    if (ym === this.yearMonth()) this.closings.set(closings);
    if (!force && fy === this.loadedFy) return;
    const list = await this.bonusRepo.loadFiscalYear(fy);
    this.loadedFy = fy;
    this.loadedFyName.set(fy);
    this.fyBonuses.set(list);
  }

  protected onMonthChange(value: string): void {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    this.yearMonth.set(value);
    this.notice.set(null);
    void this.loadBonuses();
  }

  /** 表示している月に、確定済みの事業所があるか */
  protected readonly hasClosed = computed(() => this.closings().length > 0);

  /** 支給日の年度が、表示している対象月の年度と違えば、その年度の賞与を読む（4回目の警告のため） */
  private async loadPaidFy(paidDate: string): Promise<void> {
    if (!isValidDate(paidDate)) return;
    const fy = fiscalYearOf(paidDate);
    if (fy === this.loadedFyName() || this.paidFyBonuses()?.fy === fy) return;
    const list = await this.bonusRepo.loadFiscalYear(fy);
    this.paidFyBonuses.set({ fy, list });
  }

  protected setForm<K extends keyof BonusInput>(key: K, value: string): void {
    if (key === 'paidDate') void this.loadPaidFy(value);
    this.form.update((f) => ({
      ...f,
      [key]:
        key === 'amount' || key === 'inKindAmount'
          ? parseNumberInput(value)
          : value,
    }));
  }

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const f = this.form();
    const errors = validateBonus(f);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    // 支給日の所属事業所と、その月が確定済みでないか
    const employee = this.employees().find((e) => e.id === f.employeeId)!;
    let officeId: string;
    try {
      officeId = findOffice(employee.assignments, this.masters()!.offices, f.paidDate).id;
    } catch {
      this.errors.set({ paidDate: 'この日に所属している適用事業所がありません。所属事業所の履歴を確かめてください' });
      return;
    }
    this.saving.set(true);
    try {
      const closed = await this.closingRepo.loadMonth(f.paidDate.slice(0, 7));
      if (closed.some((c) => c.officeId === officeId)) {
        this.errors.set({ paidDate: 'この月は確定済みです。月次保険料一覧で確定を解除してから登録してください' });
        return;
      }
      const editing = this.editingId();
      if (editing && this.editingBonus) {
        // 直す前の月が確定済みなら直せない（確定した控除額が変わってしまうため）
        const before = this.editingBonus;
        const closedBefore = await this.closingRepo.loadMonth(before.yearMonth);
        if (closedBefore.some((c) => c.officeId === before.officeId)) {
          this.errors.set({ paidDate: '直す前の支給月が確定済みです。月次保険料一覧で確定を解除してから直してください' });
          return;
        }
        await this.bonusRepo.update(
          editing,
          {
            paidDate: f.paidDate, amount: f.amount!, inKindAmount: f.inKindAmount || null, bonusTypeId: f.bonusTypeId || null,
            isRemuneration: this.formIsRemuneration(), totalAmount: before.totalAmount,
          },
          officeId,
        );
        this.yearMonth.set(f.paidDate.slice(0, 7));
        await this.loadBonuses(true);
        const name = this.employees().find((e) => e.id === f.employeeId)?.name ?? '';
        this.notice.set(`${name}さんの賞与を直しました（${dateLabel(f.paidDate)}支給・${f.amount!.toLocaleString('ja-JP')}円）。賞与支払届を届け出たあとなら、訂正の届出も確かめてください。`);
        this.cancelEdit();
        return;
      }
      await this.bonusRepo.add(
        {
          employeeId: f.employeeId, paidDate: f.paidDate, amount: f.amount!, inKindAmount: f.inKindAmount || null,
          bonusTypeId: f.bonusTypeId || null, isRemuneration: this.formIsRemuneration(),
        },
        officeId,
      );
      const ym = f.paidDate.slice(0, 7);
      this.yearMonth.set(ym);
      await this.loadBonuses(true);
      const name = this.employees().find((e) => e.id === f.employeeId)?.name ?? '';
      const report = this.reportAmounts().find((a) => a.employeeId === f.employeeId && a.yearMonth === ym);
      this.notice.set(
        `${name}さんの賞与（${dateLabel(f.paidDate)}支給）を登録しました。賞与支払届は${dateLabel(bonusReportDeadline(f.paidDate))}までに届け出ます` +
          (report ? `（届け出る賞与額 ${report.total.toLocaleString('ja-JP')}円${report.paidDates.length > 1 ? '・同じ月の支給を合算' : ''}）。` : '。'),
      );
      this.form.set({ employeeId: '', paidDate: f.paidDate, amount: null, inKindAmount: null, bonusTypeId: f.bonusTypeId });
      this.employeeQuery.set('');
    } catch (e) {
      console.error(e);
      // 通信・権限で保存できなかった（支給額の欄の誤りではない）ので、知らせとして出す
      this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(row: BonusRow): Promise<void> {
    const ok = await this.confirm.ask({
      title: '賞与を削除しますか',
      message: `${row.employee.name}さんの賞与（${dateLabel(row.result.bonus.paidDate)}支給・${row.result.bonus.amount.toLocaleString('ja-JP')}円）を削除します。元に戻せません。`,
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.bonusRepo.remove(row.result.bonus.id);
      await this.loadBonuses(true);
      this.notice.set(`${row.employee.name}さんの賞与（${dateLabel(row.result.bonus.paidDate)}支給）を削除しました。`);
    } catch (e) {
      console.error(e);
      this.notice.set('削除できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- 表示用 ----
  protected yen(v: bigint | number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }
  protected employerYen(p: PremiumResult | null | undefined): string {
    return p ? this.yen(senToDisplayYen(p.employerSen)) : '';
  }
  /** 介護保険の欄に出す、かからない理由（月次の一覧と同じ） */
  protected careNote(r: BonusResult): string {
    return careNote(r.premium);
  }
  protected employeeTotal(r: BonusResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen([p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }
  protected notes(r: BonusResult): string[] {
    const n: string[] = [];
    if (r.status === 'outside') n.push('資格のない日の支給（保険料・届出なし）');
    if (r.status === 'remuneration') n.push('報酬扱い（年4回以上支給の賞与。賞与の保険料・賞与支払届なし。定時決定で報酬に上乗せ）');
    if (r.status === 'noOffice') n.push('所属事業所が未登録');
    if (r.status === 'missingRate') n.push('料率が未登録');
    if (r.transferOut) n.push(`異動月の賞与（${r.transferOut}に異動。元の事業所では資格喪失月の賞与のため、保険料なし・累計に含める）`);
    else if (r.target === 'lostMonth') n.push('資格喪失月（保険料なし・累計に含める）');
    if (r.exemption !== 'none') {
      const e = this.employees().find((x) => x.id === r.bonus.employeeId);
      const l = e ? bonusExemptingLeave(e.leaves, r.bonus.paidDate) : null;
      n.push(l ? leaveExemptLabel(r.bonus.employeeId, l, this.filedIds()) : r.exemption === 'maternity' ? '産休免除' : '育休免除');
    }
    if (r.capped.health) n.push(`健保の年度累計の上限（${this.yen(r.base.health)}円まで）`);
    if (r.capped.pension) n.push(`厚年の同月の上限（${this.yen(r.base.pension)}円まで）`);
    if (r.multiOfficeReview) n.push('二以上事業所勤務のため要確認（他社の賞与と合わせると上限にかかるおそれ）');
    return n;
  }
  protected officeName(id: string): string {
    return this.masters()?.offices.find((o) => o.id === id)?.name ?? id;
  }
}
