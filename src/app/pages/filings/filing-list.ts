// 届出の期限（設計書 2.25・3.12）
// 届け出るものと期限を登録した内容から求めて並べ、「届出済み」にすると未対応から消える。
import { saveTableCsv } from '../../core/ui/table-csv';
import { PageState } from '../../core/ui/page-state';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateLabelPipe } from '../../core/ui/year-month.pipe';
import { Auth } from '../../core/auth/auth';
import { addDays, Filing, FILING_KIND_LABEL, FilingKind, filingName, filingState, FilingState, findFilings } from '../../core/calc/filing';
import { GradeRow } from '../../core/calc/grade-suggest';
import { Office } from '../../core/calc/office';
import { cutoffResolver, legacyGroup, PayrollGroup } from '../../core/calc/payroll-group';
import { CandidateStatusRecord, GradeThreshold, trackRevisionCandidates } from '../../core/calc/revision';
import { addMonths, SalaryRecord } from '../../core/calc/salary';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { BonusRecord } from '../../core/calc/bonus-premium';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { FilingRepository } from '../../core/repository/filing-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { REVISION_LOOKBACK_MONTHS } from '../revisions/revision-list';
import { yearMonthLabel } from '../../core/calc/year-month';
import { Confirm } from '../../core/ui/confirm';

export function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

export const STATE_LABEL: Record<FilingState, string> = {
  overdue: '期限切れ',
  soon: '期限が近い',
  open: '未対応',
  filed: '届出済み',
};

type Row = Filing & { state: FilingState; employeeLabel: string; officeName: string };

/** 期限の月（'2026-11'）。「速やかに」など期限の日がない届出は '' */
export function deadlineMonth(f: Pick<Filing, 'deadline'>): string {
  return f.deadline ? f.deadline.slice(0, 7) : '';
}

/** 期限の月の表示名 */
export function deadlineMonthLabel(month: string): string {
  return month === '' ? '期限の日付なし（速やかに・遅滞なくなど）' : `${yearMonthLabel(month)}が期限`;
}

@Component({
  imports: [RouterLink, NoticeMessage, DateLabelPipe],
  selector: 'app-filing-list',
  styleUrl: './filing-list.scss',
  templateUrl: './filing-list.html',
})
export class FilingList implements OnInit {
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  /** 表示している一覧（絞り込み・並び替えのあと）を、画面と同じ列でCSVに保存する（core/ui/table-csv.ts） */
  protected saveCsv(selector: string, fileName: string): void {
    saveTableCsv(this.host, selector, fileName);
  }

  private readonly auth = inject(Auth);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly bonusRepo = inject(BonusRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly revisionRepo = inject(RevisionRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  /** 利用開始日（会社の設定）。期限がこの日より前の届出は出さない。未設定なら null */
  protected readonly startDate = signal<string | null>(null);
  protected readonly isAdmin = computed(() => this.auth.user()?.siRole === 'admin');
  private readonly filingRepo = inject(FilingRepository);
  private readonly confirm = inject(Confirm);

  protected readonly stateLabel = STATE_LABEL;
  protected readonly today = signal(today());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly tab = signal<'open' | 'filed'>('open');
  protected readonly officeFilter = signal('');
  /** 期限の月で絞り込む（'' はすべての月。'none' は期限の日付がない届出） */
  protected readonly monthFilter = signal('');
  /** 届出の種類で絞り込む（'' はすべての種類） */
  protected readonly kindFilter = signal<FilingKind | ''>('');

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('filings.tab', this.tab);
    pageState.keep('filings.officeFilter', this.officeFilter);
    pageState.keep('filings.monthFilter', this.monthFilter);
    pageState.keep('filings.kindFilter', this.kindFilter);
    return true;
  })(inject(PageState));

  private readonly employees = signal<EmployeeRecord[]>([]);
  protected readonly offices = signal<Office[]>([]);
  private readonly bonuses = signal<BonusRecord[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  private readonly statuses = signal<CandidateStatusRecord[]>([]);
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  private readonly filedIds = signal<Set<string>>(new Set());
  /** 対応不要にした届出（届出済みのタブで「対応不要」と出す） */
  protected readonly notNeededIds = signal<Set<string>>(new Set());

  private readonly all = computed<Row[]>(() => {
    const cutoff = cutoffResolver(this.groups(), this.employees());
    const candidates = trackRevisionCandidates(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.statuses(), cutoff);
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return findFilings(this.employees(), this.bonuses(), this.salaries(), this.grades(), candidates, this.offices(), this.today(), this.startDate()).map((f) => {
      const e = f.employeeId ? byId.get(f.employeeId) : null;
      return {
        ...f,
        name: filingName(f, this.filedIds()),
        state: filingState(f, this.filedIds(), this.today()),
        employeeLabel: e ? `${e.employeeNumber} ${e.name}` : '（事業所）',
        officeName: this.offices().find((o) => o.id === f.officeId)?.name ?? '',
      };
    });
  });

  /** 担当範囲（特定の事業所の担当者は、その事業所の分だけ） */
  private readonly scoped = computed(() => {
    const scope = this.auth.user()?.siScope ?? 'all';
    return this.all().filter((r) => scope === 'all' || r.officeId === scope);
  });

  /** タブで絞った行（事業所の選択肢の件数に使う） */
  private readonly tabOnlyRows = computed(() => this.scoped().filter((r) => (this.tab() === 'filed' ? r.state === 'filed' : r.state !== 'filed')));

  /** タブと事業所で絞った行（月・種類の選択肢の件数に使う） */
  private readonly tabRows = computed(() => {
    const o = this.officeFilter();
    return o === '' ? this.tabOnlyRows() : this.tabOnlyRows().filter((r) => r.officeId === o);
  });

  /**
   * 適用事業所の選択肢（登録した順）と件数（随時改定と同じ）。届出がある事業所だけを出し、件数は期限の月・届出の種類の絞り込みに合わせる。
   * 特定の事業所の担当者には、担当事業所の届出しかないので、担当事業所だけが出る。選んでいる事業所は0件でも残す
   */
  private readonly officeBaseRows = computed(() => {
    const m = this.monthFilter();
    const k = this.kindFilter();
    return this.tabOnlyRows().filter((r) => (m === '' || deadlineMonth(r) === (m === 'none' ? '' : m)) && (k === '' || r.kind === k));
  });
  protected readonly officeOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.officeBaseRows()) if (r.officeId) counts.set(r.officeId, (counts.get(r.officeId) ?? 0) + 1);
    return this.offices()
      .filter((o) => counts.has(o.id) || o.id === this.officeFilter())
      .map((o) => ({ value: o.id, label: o.name, count: counts.get(o.id) ?? 0 }));
  });
  /** 事業所で絞る前の件数（「すべて」の選択肢に出す。期限の月・届出の種類の絞り込みは効かせる） */
  protected readonly officeAllCount = computed(() => this.officeBaseRows().length);

  /** 届出の種類で絞った行（月の選択肢の件数に使う） */
  private readonly kindRows = computed(() => {
    const k = this.kindFilter();
    return k === '' ? this.tabRows() : this.tabRows().filter((r) => r.kind === k);
  });

  /** 期限の月で絞った行（種類の選択肢の件数に使う） */
  private readonly monthRows = computed(() => {
    const m = this.monthFilter();
    if (m === '') return this.tabRows();
    return this.tabRows().filter((r) => deadlineMonth(r) === (m === 'none' ? '' : m));
  });

  /** 届出の種類の選択肢（届出の種類の決まった順）と件数。選んだ月にある種類だけを出す。選んでいる種類は、0件でも残す */
  protected readonly kindOptions = computed(() => {
    const counts = new Map<FilingKind, number>();
    for (const r of this.monthRows()) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return (Object.keys(FILING_KIND_LABEL) as FilingKind[])
      .filter((k) => counts.has(k) || k === this.kindFilter())
      .map((k) => ({ value: k, label: FILING_KIND_LABEL[k], count: counts.get(k) ?? 0 }));
  });

  /** 期限の月の選択肢（早い月から。期限の日付がない届出は最後）と、それぞれの件数 */
  protected readonly monthOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.kindRows()) counts.set(deadlineMonth(r), (counts.get(deadlineMonth(r)) ?? 0) + 1);
    // 選んでいる月は、選んだ種類の届出がなくても（0件でも）選択肢に残す
    const selected = this.monthFilter();
    if (selected !== '' && !counts.has(selected === 'none' ? '' : selected)) counts.set(selected === 'none' ? '' : selected, 0);
    return [...counts.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([month, count]) => ({ value: month === '' ? 'none' : month, label: month === '' ? '期限の日付なし' : yearMonthLabel(month), count }));
  });

  /** 月で絞る前の件数（「すべての月」の選択肢に出す。種類の絞り込みは効かせる） */
  protected readonly allCount = computed(() => this.kindRows().length);
  /** 種類で絞る前の件数（「すべての種類」の選択肢に出す。月の絞り込みは効かせる） */
  protected readonly allKindCount = computed(() => this.monthRows().length);

  /** 表に出す行：タブ・事業所・期限の月・届出の種類で絞ったもの */
  protected readonly rows = computed(() => {
    const k = this.kindFilter();
    return k === '' ? this.monthRows() : this.monthRows().filter((r) => r.kind === k);
  });

  /** 期限の月ごとにまとめた行（月の見出しと件数を表に出す。月の順は選択肢と同じ） */
  protected readonly monthGroups = computed(() => {
    const groups = new Map<string, Row[]>();
    for (const r of this.rows()) {
      const k = deadlineMonth(r);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([month, rows]) => ({ month, label: deadlineMonthLabel(month), rows }));
  });

  /** タブを切り替えたら、月・種類の絞り込みは「すべて」に戻す（届出済みにはない月・種類を選んだままにしない） */
  protected setTab(tab: 'open' | 'filed'): void {
    this.tab.set(tab);
    this.selected.set(new Set());
    this.monthFilter.set('');
    this.kindFilter.set('');
  }

  protected readonly counts = computed(() => {
    const list = this.scoped();
    return {
      open: list.filter((r) => r.state !== 'filed').length,
      overdue: list.filter((r) => r.state === 'overdue').length,
      soon: list.filter((r) => r.state === 'soon').length,
      filed: list.filter((r) => r.state === 'filed').length,
    };
  });

  async ngOnInit(): Promise<void> {
    try {
      const t = this.today();
      const ym = t.slice(0, 7);
      const [employees, masters, bonuses, salaries, grades, thresholds, statuses, groups, filed] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.bonusRepo.loadRange(addDays(t, -200), addDays(t, 90)),
        this.salaryRepo.loadRange(addMonths(ym, -(REVISION_LOOKBACK_MONTHS - 1)), ym),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.revisionRepo.loadStatuses(),
        this.settingsRepo.loadPayrollGroups(),
        this.filingRepo.loadResolutions(),
      ]);
      this.startDate.set((await this.settingsRepo.loadSettings()).startDate ?? null);
      this.employees.set(employees);
      this.offices.set(masters.offices);
      this.bonuses.set(bonuses);
      this.salaries.set(salaries);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      this.statuses.set(statuses);
      this.groups.set(groups);
      this.filedIds.set(new Set(filed.keys()));
      this.notNeededIds.set(new Set([...filed].filter(([, v]) => v === 'notNeeded').map(([k]) => k)));
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected async setFiled(r: Row): Promise<void> {
    await this.run(async () => {
      await this.filingRepo.setFiled(r, this.auth.user()?.email ?? '');
      this.filedIds.update((s) => new Set([...s, r.id]));
    }, `${r.name}（${r.employeeLabel}）を届出済みにしました。`);
  }

  // ---- まとめて届出済みにする（設計書 3.12） ----
  // 未対応のタブで、届出をチェックで選び、まとめて届出済みにする。月額変更届は改定の候補で切り替えるので選べない

  /** 選んだ届出のID（絞り込みで見えなくなったものは、まとめての対象にしない） */
  protected readonly selected = signal<Set<string>>(new Set());

  /** チェックで選べるか（未対応のタブの、月額変更届以外の未対応の届出） */
  protected selectable(r: Row): boolean {
    return this.tab() === 'open' && r.kind !== 'revision' && r.state !== 'filed';
  }

  /** いま表示している中で選べる届出 */
  protected readonly selectableRows = computed(() => this.rows().filter((r) => this.selectable(r)));

  /** いま表示している中で選んでいる届出（まとめて届出済みにする対象） */
  protected readonly selectedRows = computed(() => {
    const s = this.selected();
    return this.selectableRows().filter((r) => s.has(r.id));
  });

  /** 表示している選べる届出を、すべて選んでいるか */
  protected readonly allSelected = computed(() => this.selectableRows().length > 0 && this.selectedRows().length === this.selectableRows().length);

  protected toggle(r: Row, checked: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (checked) next.add(r.id);
      else next.delete(r.id);
      return next;
    });
  }

  /** 見出しのチェック：表示している選べる届出を、すべて選ぶ／すべて外す */
  protected toggleAll(checked: boolean): void {
    this.selected.set(checked ? new Set(this.selectableRows().map((r) => r.id)) : new Set());
  }

  protected async setFiledSelected(): Promise<void> {
    const list = this.selectedRows();
    if (list.length === 0) return;
    const ok = await this.confirm.ask({
      title: 'まとめて届出済みにする',
      message: `選んだ${list.length}件を届出済みにします（あとから1件ずつ未対応に戻せます）。`,
      ok: `${list.length}件を届出済みにする`,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.filingRepo.setFiledMany(list, this.auth.user()?.email ?? '');
      const ids = list.map((r) => r.id);
      this.filedIds.update((s) => new Set([...s, ...ids]));
      this.selected.set(new Set());
    }, `${list.length}件を届出済みにしました。`);
  }

  protected async unsetFiled(r: Row): Promise<void> {
    await this.run(async () => {
      await this.filingRepo.unsetFiled(r.id);
      this.filedIds.update((s) => new Set([...s].filter((x) => x !== r.id)));
      this.notNeededIds.update((s) => new Set([...s].filter((x) => x !== r.id)));
    }, `${r.name}（${r.employeeLabel}）を未対応に戻しました。`);
  }

  /**
   * 対応不要にする（届け出なくてよいと分かったもの：取り消した退職の資格喪失届、登録の誤りで出た届出など）
   * 確かめてから記録し、未対応の一覧と要確認から外す。届出済みのタブで「対応不要」と出し、未対応に戻せる
   */
  protected async setNotNeeded(r: Row): Promise<void> {
    const ok = await this.confirm.ask({
      title: '対応不要にしますか',
      message: `${r.name}（${r.employeeLabel}・${r.triggerLabel}）を、届け出なくてよいものとして未対応の一覧から外します。登録の誤りで出た届出なら、先に従業員の詳細で登録を直すと、届出そのものが出なくなります。あとから未対応に戻せます。`,
      ok: '対応不要にする',
    });
    if (!ok) return;
    await this.run(async () => {
      await this.filingRepo.setNotNeeded(r, this.auth.user()?.email ?? '');
      this.filedIds.update((s) => new Set([...s, r.id]));
      this.notNeededIds.update((s) => new Set([...s, r.id]));
    }, `${r.name}（${r.employeeLabel}）を対応不要にしました。`);
  }

  private async run(action: () => Promise<void>, message: string): Promise<void> {
    this.saving.set(true);
    try {
      await action();
      this.notice.set(message);
    } catch (e) {
      console.error(e);
      this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }
}
