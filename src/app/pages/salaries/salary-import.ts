// 給与のCSV取り込み（設計書 3.8）
// 初回に列を対応づけて保存すれば、2回目からはファイルを選ぶだけで取り込める。
// 取り込む前にプレビューで、登録される内容とエラー行を確かめる。
import { NoticeMessage } from '../../core/ui/notice-message';
import { DateLabelPipe } from '../../core/ui/year-month.pipe';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { decodeCsv, parseCsv } from '../../core/calc/csv';
import { Office } from '../../core/calc/office';
import {
  buildPreview,
  mappingConflicts,
  missingColumns,
  PreviewRow,
  PreviewStatus,
  SalaryMapping,
  TEMPLATE_HEADERS,
  TEMPLATE_MAPPING,
  templateCsv,
} from '../../core/calc/salary-import';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { needsExclusion, periodChange } from '../../core/calc/pay-period-change';
import { cutoffOf, PayrollGroup, payrollGroupAt } from '../../core/calc/payroll-group';
import { dateLabel } from '../../core/calc/year-month';

export const STATUS_LABEL: Record<PreviewStatus, string> = {
  new: '新規',
  overwrite: '上書き',
  error: 'エラー',
  closed: '確定済み',
  outOfScope: '担当範囲外',
};

const EMPTY_MAPPING: SalaryMapping = {
  employeeNumber: '', paidDate: '', paymentBaseDays: '', fixedWages: [], nonFixedWages: [], retroactiveDiff: '', inKindWages: '', workingHours: '', hourlyRate: '',
};

type SingleKey = 'employeeNumber' | 'paidDate' | 'paymentBaseDays' | 'retroactiveDiff' | 'inKindWages' | 'workingHours' | 'hourlyRate' | 'excludedAmount';
type MultiKey = 'fixedWages' | 'nonFixedWages';

@Component({
  imports: [RouterLink, NoticeMessage, DateLabelPipe],
  selector: 'app-salary-import',
  styleUrl: './salary-import.scss',
  templateUrl: './salary-import.html',
})
export class SalaryImport implements OnInit {
  private readonly auth = inject(Auth);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly singleFields: { key: SingleKey; label: string; required: boolean }[] = [
    { key: 'employeeNumber', label: '社員番号', required: true },
    { key: 'paidDate', label: '支払日', required: true },
    { key: 'paymentBaseDays', label: '支払基礎日数', required: true },
    { key: 'retroactiveDiff', label: 'うち遡及差額', required: false },
    { key: 'inKindWages', label: 'うち現物給与', required: false },
    { key: 'workingHours', label: '労働時間（未加入の人の加入の可能性に使う）', required: false },
    { key: 'hourlyRate', label: '時給単価（時給の人の随時改定に使う）', required: false },
    { key: 'excludedAmount', label: '算定から除く額（支払月・締め日の変更月だけ。その月は必須）', required: false },
  ];
  protected readonly multiFields: { key: MultiKey; label: string; hint: string }[] = [
    { key: 'fixedWages', label: '固定的賃金（必須）', hint: '基本給・役職手当・家族手当・通勤手当など' },
    { key: 'nonFixedWages', label: '非固定的賃金', hint: '時間外手当・深夜手当・歩合給など' },
  ];

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly offices = signal<Office[]>([]);
  private readonly savedMapping = signal<SalaryMapping | null>(null);

  // 読み込んだファイル
  protected readonly fileName = signal('');
  protected readonly csvRows = signal<string[][]>([]);
  protected readonly headers = computed(() => this.csvRows()[0] ?? []);
  protected readonly isTemplate = computed(
    () => this.headers().length > 0 && TEMPLATE_HEADERS.every((h) => this.headers().includes(h)),
  );
  /** 今使う対応づけ（テンプレートの形式なら対応づけなし） */
  protected readonly mapping = signal<SalaryMapping>(EMPTY_MAPPING);
  protected readonly missing = computed(() => (this.headers().length ? missingColumns(this.mapping(), this.headers()) : []));
  /** 対応づけの矛盾（同じ列を固定的賃金と非固定的賃金の両方に選んだなど）。あれば取り込み・保存をしない */
  protected readonly conflicts = computed(() => mappingConflicts(this.mapping()));
  /** 取り込めない対応づけか（CSVにない列がある・矛盾がある） */
  protected readonly mappingBlocked = computed(() => this.missing().length > 0 || this.conflicts().length > 0);

  // プレビュー
  private readonly closed = signal<Set<string>>(new Set());
  private readonly existingIds = signal<Set<string>>(new Set());
  protected readonly overwrite = signal(false);

  protected readonly isAdmin = computed(() => this.auth.isAdmin());

  protected readonly preview = computed<PreviewRow[]>(() => {
    // 支払区分を読めないと、算定から除く額の要る月（支払月・締め日の変更月）を確かめられないので、プレビューを作らない
    const need = this.needsExclusionFn();
    if (this.csvRows().length < 2 || this.mappingBlocked() || !need) return [];
    return buildPreview(this.csvRows(), this.mapping(), {
      employees: this.employees(),
      offices: this.offices(),
      closed: this.closed(),
      existingIds: this.existingIds(),
      scope: this.auth.user()?.siScope ?? 'all',
      needsExclusion: need,
    });
  });

  /** 支払区分（支払月・締め日の変更月を見分ける） */
  private readonly groups = signal<PayrollGroup[] | null>(null);
  /** その人のその支払月が、算定から除く額の要る月か（支払区分を読めなければ undefined。取り込めない） */
  private readonly needsExclusionFn = computed(() => {
    const groups = this.groups();
    if (!groups) return undefined;
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return (employeeId: string, ym: string) => {
      const e = byId.get(employeeId);
      if (!e) return false;
      return needsExclusion(periodChange(ym, (x) => cutoffOf(payrollGroupAt(groups, e.payrollAssignments, `${x}-01`))));
    };
  });

  /** エラー・注意の行（登録しない行と、登録済みを上書きする行）だけを表示するか */
  protected readonly onlyIssues = signal(false);
  protected readonly shownPreview = computed(() => (this.onlyIssues() ? this.preview().filter((r) => r.status !== 'new') : this.preview()));

  protected readonly counts = computed(() => {
    const c: Record<PreviewStatus, number> = { new: 0, overwrite: 0, error: 0, closed: 0, outOfScope: 0 };
    for (const r of this.preview()) c[r.status]++;
    return c;
  });

  /** 登録する行（上書きは確認したときだけ） */
  protected readonly toSave = computed(() =>
    this.preview().filter((r) => r.status === 'new' || (r.status === 'overwrite' && this.overwrite())),
  );

  async ngOnInit(): Promise<void> {
    try {
      // 支払区分も一緒に読む。読めなければ取り込まない（算定から除く額の要る月を確かめられず、
      // 必須のチェックを飛ばして取り込むと、随時改定・定時決定の平均を誤るため）
      const [employees, masters, mapping, groups] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSalaryMapping(),
        this.settingsRepo.loadPayrollGroups(),
      ]);
      this.groups.set(groups);
      this.employees.set(employees);
      this.offices.set(masters.offices);
      this.savedMapping.set(mapping);
      this.mapping.set(mapping ?? EMPTY_MAPPING);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.loadText(file.name, decodeCsv(new Uint8Array(await file.arrayBuffer())));
    // 同じファイルをもう一度選んでも読み直せるように、選択を空にしておく
    input.value = '';
  }

  /** CSVの中身を読み、確定済みの月と登録済みの給与を調べる */
  async loadText(name: string, text: string): Promise<void> {
    this.notice.set(null);
    this.overwrite.set(false);
    this.fileName.set(name);
    const rows = parseCsv(text);
    this.csvRows.set(rows);
    this.mapping.set(this.isTemplate() ? TEMPLATE_MAPPING : (this.savedMapping() ?? EMPTY_MAPPING));
    await this.refreshContext();
  }

  /** プレビューに使う、確定済みの月と登録済みの給与（ファイルの支払月の分） */
  private async refreshContext(): Promise<void> {
    if (this.mappingBlocked()) return;
    const months = [
      ...new Set(
        buildPreview(this.csvRows(), this.mapping(), {
          employees: this.employees(), offices: this.offices(), closed: new Set(), existingIds: new Set(), scope: 'all',
        })
          .map((r) => r.salary?.paidDate.slice(0, 7))
          .filter((m): m is string => !!m),
      ),
    ].sort();
    if (months.length === 0) return;
    const [closings, existing] = await Promise.all([
      Promise.all(months.map((m) => this.closingRepo.loadMonth(m))),
      this.salaryRepo.loadRange(months[0], months.at(-1)!),
    ]);
    this.closed.set(new Set(closings.flat().map((c) => `${c.yearMonth}|${c.officeId}`)));
    this.existingIds.set(new Set(existing.map((s) => s.id)));
  }

  protected setSingle(key: SingleKey, value: string): void {
    this.mapping.update((m) => ({ ...m, [key]: value }));
    void this.refreshContext();
  }

  protected toggleMulti(key: MultiKey, column: string, checked: boolean): void {
    this.mapping.update((m) => ({
      ...m,
      [key]: checked ? [...m[key].filter((c) => c !== column), column] : m[key].filter((c) => c !== column),
    }));
    void this.refreshContext();
  }

  protected isChecked(key: MultiKey, column: string): boolean {
    return this.mapping()[key].includes(column);
  }

  protected async saveMapping(): Promise<void> {
    if (this.mappingBlocked()) return;
    this.busy.set(true);
    try {
      await this.settingsRepo.saveSalaryMapping(this.mapping());
      this.savedMapping.set(this.mapping());
      this.notice.set('列の対応づけを保存しました。次回からは、ファイルを選ぶだけで取り込めます。');
    } catch (e) {
      console.error(e);
      this.notice.set('保存できませんでした。列の対応づけを変えられるのは管理者だけです。');
    } finally {
      this.busy.set(false);
    }
  }

  protected async importRows(): Promise<void> {
    const rows = this.toSave();
    if (rows.length === 0) return;
    this.busy.set(true);
    try {
      const r = await this.salaryRepo.saveMany(rows.map((x) => ({ salary: x.salary!, officeId: x.officeId!, overwrite: x.status === 'overwrite' })));
      const skipped = this.preview().length - rows.length;
      // 算定から除く額がなくて取り込まなかった行（支払月・締め日の変更月）は、別に知らせる
      const noExclusion = this.preview().filter((p) => p.errors.some((e) => e.includes('算定から除く額が要ります'))).length;
      const nameOf = (employeeId: string) => this.employees().find((e) => e.id === employeeId)?.name ?? '';
      const parts = [
        `${r.saved}件の給与を取り込みました。`,
        skipped > 0 ? `取り込まなかった行は${skipped}件です。` : '',
        noExclusion > 0
          ? `このうち${noExclusion}件は、支払月・締め日の変更月の給与で「算定から除く額」がないため取り込んでいません。CSVの「算定から除く額」の列に額（なければ0）を入れて取り込み直すか、給与の画面で入れてください。`
          : '',
        r.conflicts.length > 0
          ? `${r.conflicts.length}件は、確認のあとにほかの担当者が同じ支払日の給与を登録したため、上書きせずに取り込んでいません（${r.conflicts
              .slice(0, 5)
              .map((s) => `${nameOf(s.employeeId)}さん ${dateLabel(s.paidDate)}`)
              .join('、')}${r.conflicts.length > 5 ? ' ほか' : ''}）。内容を確かめ、上書きするときは「上書きする」を選んで取り込み直してください。`
          : '',
        r.failed > 0
          ? `${r.failed}件は、途中で書き込めなかったため取り込めていません（確定済みの月が含まれていないか、権限と通信を確かめてください）。同じファイルを取り込み直すと、取り込めた行は「登録済み」として出るので、二重にはなりません。`
          : '',
      ];
      if (r.error) console.error(r.error);
      this.notice.set(parts.join(''));
      if (r.failed > 0 || r.conflicts.length > 0) {
        // 一部だけ取り込めたときは、ファイルを残して、登録済みの給与を読み直す（取り込めた行は「上書き」に変わる）
        this.overwrite.set(false);
        await this.refreshContext();
      } else {
        this.csvRows.set([]);
        this.fileName.set('');
      }
    } catch (e) {
      console.error(e);
      this.notice.set('取り込めませんでした。確定済みの月が含まれていないか、権限と通信を確かめてください。');
    } finally {
      this.busy.set(false);
    }
  }

  /** テンプレートのCSV（Excelで文字化けしないようにBOMつきUTF-8） */
  protected templateHref(): string {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + templateCsv());
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }
}
