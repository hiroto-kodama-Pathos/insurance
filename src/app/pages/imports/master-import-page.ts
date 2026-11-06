// 従業員・標準報酬月額・賞与のCSVの取り込み（設計書 3.8）
// 導入時に、今の従業員・標準報酬月額・その年度の賞与をまとめて登録する。
// 種類を選んでファイルを読み、列の対応づけ（テンプレートなら不要）を合わせ、プレビューで確かめてから登録する。
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { BonusType } from '../../core/calc/bonus-type';
import { OfficeClosing } from '../../core/calc/closing';
import { decodeCsv, parseCsv } from '../../core/calc/csv';
import { GradeRow } from '../../core/calc/grade-suggest';
import {
  importKindFromQuery,
  BonusImportContext,
  bonusDateRange,
  buildBonusImport,
  buildEmployeeImport,
  buildStandardImport,
  buildDependentImport,
  DependentToImport,
  BonusToImport,
  EmployeeToImport,
  StandardToImport,
  ColumnMapping,
  emptyMapping,
  IMPORT_FIELDS,
  IMPORT_KIND_LABEL,
  IMPORT_STATUS_LABEL,
  importTemplateCsv,
  ImportKind,
  ImportRow,
  ImportStatus,
  isTemplateHeaders,
  missingImportColumns,
  templateMapping,
} from '../../core/calc/master-import';
import { Office } from '../../core/calc/office';
import { PayrollGroup } from '../../core/calc/payroll-group';
import { monthRange } from '../../core/calc/period-total';
import { dateLabel } from '../../core/calc/year-month';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeNumberTakenError, EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';

@Component({
  imports: [RouterLink, NoticeMessage],
  selector: 'app-master-import-page',
  styleUrl: './master-import-page.scss',
  templateUrl: './master-import-page.html',
})
export class MasterImportPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly bonusRepo = inject(BonusRepository);
  private readonly closingRepo = inject(ClosingRepository);

  protected readonly kinds: ImportKind[] = ['employee', 'dependent', 'standard', 'bonus'];
  protected readonly kindLabels = IMPORT_KIND_LABEL;
  protected readonly statusLabels = IMPORT_STATUS_LABEL;
  protected readonly kind = signal<ImportKind>('employee');
  protected readonly fields = computed(() => IMPORT_FIELDS[this.kind()]);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly isAdmin = computed(() => this.auth.isAdmin());
  private readonly scope = computed(() => this.auth.user()?.siScope ?? 'all');

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly offices = signal<Office[]>([]);
  private readonly groups = signal<PayrollGroup[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly bonusTypes = signal<BonusType[]>([]);
  private readonly savedMappings = signal<Partial<Record<ImportKind, ColumnMapping>>>({});
  /** 賞与：ファイルの支給日の範囲の登録済みの賞与と確定 */
  private readonly existingBonuses = signal<BonusImportContext['existing']>([]);
  /** 登録済みの賞与で内容が違う行（訂正の候補）を、訂正として取り込むか */
  protected readonly correct = signal(false);
  private readonly closings = signal<OfficeClosing[]>([]);

  protected readonly fileName = signal('');
  protected readonly csvRows = signal<string[][]>([]);
  protected readonly headers = computed(() => this.csvRows()[0] ?? []);
  protected readonly isTemplate = computed(() => isTemplateHeaders(this.kind(), this.headers()));
  protected readonly mapping = signal<ColumnMapping>(emptyMapping('employee'));
  protected readonly missing = computed(() => (this.headers().length ? missingImportColumns(this.kind(), this.mapping(), this.headers()) : []));

  private readonly ready = computed(() => this.csvRows().length >= 2 && this.missing().length === 0);

  private readonly employeePreview = computed<ImportRow<EmployeeToImport>[]>(() =>
    this.ready() && this.kind() === 'employee'
      ? buildEmployeeImport(this.csvRows(), this.mapping(), {
          existingNumbers: this.employees().map((e) => e.employeeNumber),
          offices: this.offices(),
          groups: this.groups(),
          scope: this.scope(),
        })
      : [],
  );

  private readonly dependentPreview = computed<ImportRow<DependentToImport>[]>(() =>
    this.ready() && this.kind() === 'dependent'
      ? buildDependentImport(this.csvRows(), this.mapping(), this.employees(), this.scope(), new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()))
      : [],
  );

  private readonly standardPreview = computed<ImportRow<StandardToImport>[]>(() =>
    this.ready() && this.kind() === 'standard'
      ? buildStandardImport(this.csvRows(), this.mapping(), this.employees(), this.grades(), this.scope())
      : [],
  );

  private readonly bonusPreview = computed<ImportRow<BonusToImport>[]>(() =>
    this.ready() && this.kind() === 'bonus'
      ? buildBonusImport(this.csvRows(), this.mapping(), {
          employees: this.employees(),
          existing: this.existingBonuses(),
          types: this.bonusTypes(),
          closed: new Set(this.closings().map((c) => `${c.yearMonth}|${c.officeId}`)),
          scope: this.scope(),
        })
      : [],
  );

  /** 表に出す行（選んでいる種類の分） */
  protected readonly preview = computed<ImportRow<unknown>[]>(() =>
    ({ employee: this.employeePreview, dependent: this.dependentPreview, standard: this.standardPreview, bonus: this.bonusPreview })[this.kind()](),
  );

  protected readonly counts = computed(() => {
    const c: Record<ImportStatus, number> = { new: 0, update: 0, same: 0, error: 0, closed: 0, outOfScope: 0 };
    for (const r of this.preview()) c[r.status]++;
    return c;
  });

  /** 登録する行。登録済みと違う行（訂正）は、「訂正する」を選んだときだけ */
  protected readonly toSave = computed(() => this.preview().filter((r) => r.save !== null && (r.status !== 'update' || this.correct())));
  /** エラー・注意の行（登録しない行）だけを表示するか */
  protected readonly onlyIssues = signal(false);
  /** 表に出す行。登録する行の数（toSave）は、表示に関係なく全部で数える */
  protected readonly shownPreview = computed(() =>
    this.onlyIssues() ? this.preview().filter((r) => r.status === 'error' || r.status === 'closed' || r.status === 'outOfScope') : this.preview(),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, groups, grades, types, emp, std, bonus, dep] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadPayrollGroups(),
        this.masterRepo.loadGrades(),
        this.settingsRepo.loadBonusTypes(),
        this.settingsRepo.loadCsvMapping('employee'),
        this.settingsRepo.loadCsvMapping('standard'),
        this.settingsRepo.loadCsvMapping('bonus'),
        this.settingsRepo.loadCsvMapping('dependent'),
      ]);
      this.employees.set(employees);
      this.offices.set(masters.offices);
      this.groups.set(groups);
      this.grades.set(grades);
      this.bonusTypes.set(types);
      this.savedMappings.set({ employee: emp ?? undefined, dependent: dep ?? undefined, standard: std ?? undefined, bonus: bonus ?? undefined });
      this.mapping.set(emp ?? emptyMapping('employee'));
      // 賞与の画面などから ?kind=bonus で開いたときは、その種類のタブで開く
      const kind = importKindFromQuery(this.route.snapshot.queryParamMap.get('kind'));
      if (kind) this.setKind(kind);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected setKind(kind: ImportKind): void {
    this.kind.set(kind);
    this.csvRows.set([]);
    this.fileName.set('');
    this.notice.set(null);
    this.mapping.set(this.savedMappings()[kind] ?? emptyMapping(kind));
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.loadText(file.name, decodeCsv(new Uint8Array(await file.arrayBuffer())));
    input.value = '';
  }

  async loadText(name: string, text: string): Promise<void> {
    this.notice.set(null);
    this.fileName.set(name);
    this.csvRows.set(parseCsv(text));
    const kind = this.kind();
    this.mapping.set(this.isTemplate() ? templateMapping(kind) : (this.savedMappings()[kind] ?? emptyMapping(kind)));
    await this.loadBonusContext();
  }

  /** 賞与：ファイルの支給日の範囲の、登録済みの賞与と確定を読む */
  private async loadBonusContext(): Promise<void> {
    if (this.kind() !== 'bonus' || this.missing().length > 0) return;
    const range = bonusDateRange(this.csvRows(), this.mapping());
    if (!range) return;
    const months = monthRange(range.from.slice(0, 7), range.to.slice(0, 7));
    const [bonuses, closings] = await Promise.all([
      this.bonusRepo.loadRange(range.from, range.to),
      Promise.all(months.map((ym) => this.closingRepo.loadMonth(ym))),
    ]);
    this.existingBonuses.set(bonuses);
    this.closings.set(closings.flat());
  }

  protected setField(key: string, value: string): void {
    this.mapping.update((m) => ({ ...m, [key]: value }));
    void this.loadBonusContext();
  }

  protected async saveMapping(): Promise<void> {
    const kind = this.kind();
    await this.run(async () => {
      await this.settingsRepo.saveCsvMapping(kind, this.mapping());
      this.savedMappings.update((s) => ({ ...s, [kind]: this.mapping() }));
      this.notice.set('列の対応づけを保存しました。次回からは、ファイルを選ぶだけで取り込めます。');
    }, '保存できませんでした。列の対応づけを変えられるのは管理者だけです。');
  }

  protected async importRows(): Promise<void> {
    const rows = this.toSave();
    if (rows.length === 0) return;
    const kind = this.kind();
    await this.run(async () => {
      const saves = <T>(list: ImportRow<T>[]) => list.flatMap((r) => (r.save ? [r.save] : []));
      if (kind === 'employee') {
        try {
          await this.employeeRepo.importEmployees(saves(this.employeePreview()));
        } catch (e) {
          if (!(e instanceof EmployeeNumberTakenError)) throw e;
          // 画面の一覧（担当範囲の人だけ・少し前に読んだもの）では分からなかった重なり。何も登録していない
          this.notice.set(
            `社員番号 ${e.numbers.slice(0, 10).join('・')}${e.numbers.length > 10 ? ` ほか${e.numbers.length - 10}件` : ''} はすでに登録されているため、取り込んでいません` +
              '（ほかの担当者が登録したか、担当外の事業所の人が使っています）。CSVからその行を除くか、社員番号を直してから取り込んでください。',
          );
          return;
        }
      }
      else if (kind === 'dependent') await this.employeeRepo.importDependents(saves(this.dependentPreview()));
      else if (kind === 'standard') await this.employeeRepo.saveDecisions(saves(this.standardPreview()));
      else {
        const list = this.bonusPreview().flatMap((r) => (r.save && (r.status !== 'update' || this.correct()) ? [r.save] : []));
        const r = await this.bonusRepo.importMany(list);
        if (r.error) console.error(r.error);
        const nameOf = (id: string) => this.employees().find((e) => e.id === id)?.name ?? '';
        await this.loadBonusContext();
        this.correct.set(false);
        this.notice.set(
          `賞与を${r.added}件登録しました。` +
            (r.updated > 0 ? `${r.updated}件は登録済みの賞与を訂正しました（賞与支払届を届け出たあとなら、訂正の届出も確かめてください）。` : '') +
            (r.conflicts.length > 0
              ? `${r.conflicts.length}件は、確認のあとにほかの担当者が同じ支給日の賞与を登録したため、登録していません（${r.conflicts
                  .slice(0, 5)
                  .map((c) => `${nameOf(c.employeeId)}さん ${dateLabel(c.paidDate)}`)
                  .join('、')}${r.conflicts.length > 5 ? ' ほか' : ''}）。`
              : '') +
            (r.failed > 0
              ? `${r.failed}件は、途中で書き込めなかったため登録できていません（確定済みの月・権限・通信を確かめてください）。同じファイルを取り込み直すと、登録できた行は「登録済み」として出るので、二重にはなりません。`
              : ''),
        );
        return;
      }
      this.employees.set(await this.employeeRepo.loadAll());
      await this.loadBonusContext();
      this.notice.set(
        `${IMPORT_KIND_LABEL[kind]}を${rows.length}件登録しました。` +
          (kind === 'employee' ? '続けて、被扶養者・標準報酬月額のCSVを取り込んでください。' : ''),
      );
    }, '登録できませんでした。権限と通信を確かめてください。');
  }

  private async run(fn: () => Promise<void>, failure: string): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      this.notice.set(failure);
    } finally {
      this.busy.set(false);
    }
  }

  protected templateHref(): string {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + importTemplateCsv(this.kind()));
  }
}
