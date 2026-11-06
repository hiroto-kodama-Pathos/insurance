// 随時改定の候補（設計書 2.13・3.7）
// 候補はあくまで見込みの表示。「見込みどおり登録」をするまで、標準報酬月額も保険料も変わらない。
// 候補は「未対応」「届出済み」「登録済み」「確認済み」で管理し、登録漏れに気づけるようにする。
import { PageState } from '../../core/ui/page-state';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GradeRow } from '../../core/calc/grade-suggest';
import {
  CandidateStatus,
  CandidateStatusRecord,
  GradeThreshold,
  SideJudgement,
  TrackedCandidate,
  trackRevisionCandidates,
} from '../../core/calc/revision';
import { addMonths, SalaryRecord } from '../../core/calc/salary';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { cutoffResolver, legacyGroup, PayrollGroup } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';
import { yearMonthLabel } from '../../core/calc/year-month';
import { Office } from '../../core/calc/office';

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

/** 候補を探す給与の範囲（今月までの直近の月数） */
export const REVISION_LOOKBACK_MONTHS = 8;

export const STATUS_LABEL: Record<CandidateStatus, string> = {
  open: '未対応',
  filed: '届出済み',
  registered: '登録済み',
  dismissed: '確認済み',
};

type Tab = 'active' | 'registered' | 'dismissed';
type Row = TrackedCandidate & { employee: EmployeeRecord; officeId: string | null };

/** その日に所属している事業所のID（担当範囲の判定用に保存する） */
function officeIdAt(e: EmployeeRecord, date: string): string | null {
  const a = e.assignments.filter((x) => x.validFrom <= date).sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
  return a?.officeId ?? null;
}

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe],
  selector: 'app-revision-list',
  styleUrl: './revision-list.scss',
  templateUrl: './revision-list.html',
})
export class RevisionList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  /** 人と支払月ごとの締め日（その人の支払区分） */
  private readonly cutoff = computed(() => cutoffResolver(this.groups(), this.employees()));
  private readonly revisionRepo = inject(RevisionRepository);

  protected readonly lookback = REVISION_LOOKBACK_MONTHS;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly thisMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly tab = signal<Tab>('active');
  /** 適用事業所で絞り込む（'' はすべて） */
  protected readonly officeFilter = signal('');
  /** 変動月（休業終了時改定は復帰した月）で絞り込む（'' はすべて） */
  protected readonly monthFilter = signal('');

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('revisions.tab', this.tab);
    pageState.keep('revisions.officeFilter', this.officeFilter);
    pageState.keep('revisions.monthFilter', this.monthFilter);
    return true;
  })(inject(PageState));
  private readonly offices = signal<Office[]>([]);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  private readonly statuses = signal<CandidateStatusRecord[]>([]);

  private readonly all = computed<Row[]>(() => {
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return trackRevisionCandidates(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.statuses(), this.cutoff()).map(
      (c) => {
        const employee = byId.get(c.employeeId)!;
        // 判定の3か月の途中で異動した人は候補にしないので、変動月の事業所が3か月の事業所になる
        return { ...c, employee, officeId: officeIdAt(employee, `${c.changeMonth}-01`) };
      },
    );
  });

  protected readonly counts = computed(() => {
    const c = { active: 0, registered: 0, dismissed: 0, open: 0, filed: 0 };
    for (const r of this.all()) {
      if (r.status === 'open' || r.status === 'filed') {
        c.active++;
        c[r.status]++;
      } else c[r.status]++;
    }
    return c;
  });

  /** タブで絞った行 */
  private readonly tabRows = computed(() => {
    const t = this.tab();
    return this.all().filter((r) =>
      t === 'active' ? r.status === 'open' || r.status === 'filed' : r.status === t,
    );
  });
  private readonly officeRows = computed(() => {
    const o = this.officeFilter();
    return o === '' ? this.tabRows() : this.tabRows().filter((r) => r.officeId === o);
  });
  private readonly monthRows = computed(() => {
    const m = this.monthFilter();
    return m === '' ? this.tabRows() : this.tabRows().filter((r) => r.changeMonth === m);
  });

  /** 表に出す行：タブ・適用事業所・変動月で絞ったもの */
  protected readonly rows = computed(() => {
    const m = this.monthFilter();
    return m === '' ? this.officeRows() : this.officeRows().filter((r) => r.changeMonth === m);
  });

  /** 適用事業所の選択肢（登録した順）と件数。件数は変動月の絞り込みに合わせる。選んでいる事業所は0件でも残す */
  protected readonly officeOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.monthRows()) if (r.officeId) counts.set(r.officeId, (counts.get(r.officeId) ?? 0) + 1);
    return this.offices()
      .filter((o) => counts.has(o.id) || o.id === this.officeFilter())
      .map((o) => ({ value: o.id, label: o.name, count: counts.get(o.id) ?? 0 }));
  });

  /** 変動月の選択肢（新しい月から）と件数。件数は事業所の絞り込みに合わせる。選んでいる月は0件でも残す */
  protected readonly monthOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.officeRows()) counts.set(r.changeMonth, (counts.get(r.changeMonth) ?? 0) + 1);
    const selected = this.monthFilter();
    if (selected !== '' && !counts.has(selected)) counts.set(selected, 0);
    return [...counts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, count]) => ({ value: month, label: yearMonthLabel(month), count }));
  });
  protected readonly officeAllCount = computed(() => this.monthRows().length);
  protected readonly monthAllCount = computed(() => this.officeRows().length);

  /** タブを切り替えたら、変動月の絞り込みは「すべて」に戻す（ほかのタブにない月を選んだままにしない）。事業所はそのまま */
  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.monthFilter.set('');
  }

  async ngOnInit(): Promise<void> {
    try {
      const ym = this.thisMonth();
      const [employees, salaries, grades, thresholds, statuses, groups, masters] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.salaryRepo.loadRange(addMonths(ym, -(REVISION_LOOKBACK_MONTHS - 1)), ym),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.revisionRepo.loadStatuses(),
        this.settingsRepo.loadPayrollGroups(),
        this.masterRepo.loadMasters(),
      ]);
      this.groups.set(groups);
      this.offices.set(masters.offices);
      this.employees.set(employees);
      this.salaries.set(salaries);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      this.statuses.set(statuses);
      if (grades.length === 0) this.error.set('等級表（grades）が登録されていません。運営者に投入を依頼してください。');
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  /** 見込みどおりに、適用見込み月からの標準報酬月額を登録する（登録済みに切り替わる） */
  protected async register(row: Row, provisional = false): Promise<void> {
    this.saving.set(true);
    try {
      await this.employeeRepo.addStandard(
        row.employeeId,
        {
          validFrom: row.expectedFrom,
          reason: row.type === 'leaveEnd' ? 'leaveEnd' : 'revision',
          healthStandard: row.expectedHealth,
          pensionStandard: row.expectedPension,
          provisional,
        },
        row.average,
      );
      // 変更の記録（残せなくても、登録はそのまま。設計書 3.1）
      try {
        await this.employeeRepo.addChangeLog(row.employeeId,
          `${row.type === 'leaveEnd' ? '休業終了時改定' : '随時改定'}の候補から標準報酬月額を${provisional ? '通知書待ちとして' : ''}登録（${yearMonthLabel(row.expectedFrom)}から 健保 ${this.yen(row.expectedHealth)}円／厚年 ${this.yen(row.expectedPension)}円）`);
      } catch (e) {
        console.error('変更の記録を残せませんでした', e);
      }
      this.employees.set(await this.employeeRepo.loadAll());
      this.notice.set(
        `${row.employee.name}さんの${yearMonthLabel(row.expectedFrom)}分からの標準報酬月額を${provisional ? '通知書待ちとして' : ''}登録しました（健保 ${this.yen(row.expectedHealth)}円／厚年 ${this.yen(row.expectedPension)}円）。`,
      );
    } catch (e) {
      console.error(e);
      this.notice.set('登録できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  /** 届出済み・確認済み・未対応に切り替える */
  protected async setStatus(row: Row, status: CandidateStatusRecord['status']): Promise<void> {
    this.saving.set(true);
    try {
      await this.revisionRepo.setStatus(row, status, officeIdAt(row.employee, `${row.changeMonth}-01`));
      this.statuses.update((list) => [...list.filter((s) => s.id !== row.id), { id: row.id, status }]);
      this.notice.set(`${row.employee.name}さんの候補（${yearMonthLabel(row.changeMonth)}${row.type === 'leaveEnd' ? 'に復帰' : 'の変動'}）を「${STATUS_LABEL[status]}」にしました。`);
    } catch (e) {
      console.error(e);
      this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }

  protected side(j: SideJudgement | null): string {
    if (!j) return '判定しない';
    const sign = j.diff > 0 ? '+' : '';
    return `${j.currentGrade}等級 ${this.yen(j.currentStandard)} → ${j.newGrade}等級 ${this.yen(j.newStandard)}（${sign}${j.diff}）`;
  }
}
