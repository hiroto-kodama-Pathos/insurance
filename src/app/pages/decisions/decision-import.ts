// 決定通知書のCSVの取り込み（設計書 2.13.2・3.8）
// 電子申請で届いた決定通知書を、日本年金機構の変換ツールでCSVにして取り込み、標準報酬月額の履歴に登録する。
// 取り込む前にプレビューで、登録する内容・見込みと違う人・エラー行を確かめる。
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { decodeCsv, parseCsv } from '../../core/calc/csv';
import {
  buildDecisionPreview,
  DECISION_STATUS_LABEL,
  DECISION_TEMPLATE_HEADERS,
  DECISION_TEMPLATE_MAPPING,
  DecisionExpectation,
  DecisionMapping,
  DecisionRow,
  DecisionStatus,
  decisionTemplateCsv,
  EMPTY_DECISION_MAPPING,
  missingDecisionColumns,
  parseYearMonthLoose,
} from '../../core/calc/decision-import';
import { GradeRow } from '../../core/calc/grade-suggest';
import { cutoffResolver, legacyGroup, PayrollGroup } from '../../core/calc/payroll-group';
import { estimateRegularAll } from '../../core/calc/regular';
import { GradeThreshold, trackRevisionCandidates } from '../../core/calc/revision';
import { addMonths, SalaryRecord } from '../../core/calc/salary';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';

type Field = keyof DecisionMapping;

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe],
  selector: 'app-decision-import',
  styleUrl: './decision-import.scss',
  templateUrl: './decision-import.html',
})
export class DecisionImport implements OnInit {
  private readonly auth = inject(Auth);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly settingsRepo = inject(SettingsRepository);

  protected readonly statusLabel = DECISION_STATUS_LABEL;
  protected readonly fields: { key: Field; label: string }[] = [
    { key: 'employeeNumber', label: '社員番号' },
    { key: 'name', label: '氏名' },
    { key: 'birthDate', label: '生年月日' },
    { key: 'validFrom', label: '適用年月（必須）' },
    { key: 'healthStandard', label: '健康保険の標準報酬月額（必須）' },
    { key: 'pensionStandard', label: '厚生年金の標準報酬月額' },
  ];

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly isAdmin = computed(() => this.auth.isAdmin());

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly savedMapping = signal<DecisionMapping | null>(null);

  protected readonly fileName = signal('');
  protected readonly csvRows = signal<string[][]>([]);
  protected readonly headers = computed(() => this.csvRows()[0] ?? []);
  protected readonly isTemplate = computed(
    () => this.headers().length > 0 && DECISION_TEMPLATE_HEADERS.every((h) => this.headers().includes(h)),
  );
  protected readonly mapping = signal<DecisionMapping>(EMPTY_DECISION_MAPPING);
  protected readonly missing = computed(() => (this.headers().length ? missingDecisionColumns(this.mapping(), this.headers()) : []));
  /** 見込みと違う人だけを出す */
  protected readonly onlyDiffers = signal(true);

  /** 見込み（随時改定・休業終了時改定の候補、定時決定の見込み）。適用開始月ごと */
  private readonly expectations = computed<DecisionExpectation[]>(() => {
    const cutoff = cutoffResolver(this.groups(), this.employees());
    const revisions = trackRevisionCandidates(this.employees(), this.salaries(), this.grades(), this.thresholds(), [], cutoff).map((c) => ({
      employeeId: c.employeeId,
      validFrom: c.expectedFrom,
      healthStandard: c.expectedHealth,
      pensionStandard: c.expectedPension,
      reason: c.type === 'leaveEnd' ? ('leaveEnd' as const) : ('revision' as const),
    }));
    const years = [...new Set(this.fileMonths().filter((m) => m.endsWith('-09')).map((m) => Number(m.slice(0, 4))))];
    const regular = years.flatMap((y) =>
      estimateRegularAll(this.employees(), this.salaries(), this.grades(), this.thresholds(), y, cutoff)
        .filter((r) => r.average !== null && !r.revisionInJulSep)
        .map((r) => ({
          employeeId: r.employeeId,
          validFrom: `${y}-09`,
          healthStandard: r.expectedHealth,
          pensionStandard: r.expectedPension,
          reason: 'regular' as const,
        })),
    );
    return [...revisions, ...regular];
  });

  /** ファイルに書いてある適用年月 */
  private readonly fileMonths = computed(() => {
    const col = this.headers().indexOf(this.mapping().validFrom);
    if (col < 0) return [];
    return [...new Set(this.csvRows().slice(1).map((r) => parseYearMonthLoose(r[col] ?? '')).filter((m): m is string => !!m))].sort();
  });

  protected readonly preview = computed<DecisionRow[]>(() => {
    if (this.csvRows().length < 2 || this.missing().length > 0) return [];
    return buildDecisionPreview(this.csvRows(), this.mapping(), this.employees(), this.expectations());
  });

  /** 表に出す行（見込みと違う人だけ、またはすべて。エラー行はいつも出す） */
  protected readonly shown = computed(() =>
    this.preview().filter((r) => !this.onlyDiffers() || r.differs || r.status === 'error'),
  );

  protected readonly counts = computed(() => {
    const c: Record<DecisionStatus, number> = { new: 0, confirm: 0, same: 0, error: 0 };
    for (const r of this.preview()) c[r.status]++;
    return { ...c, differs: this.preview().filter((r) => r.differs && r.status !== 'error').length };
  });

  protected readonly toSave = computed(() => this.preview().filter((r) => r.save !== null));

  async ngOnInit(): Promise<void> {
    try {
      const [employees, grades, thresholds, groups, mapping] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.settingsRepo.loadPayrollGroups(),
        this.settingsRepo.loadDecisionMapping(),
      ]);
      this.employees.set(employees);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      this.groups.set(groups);
      this.savedMapping.set(mapping);
      this.mapping.set(mapping ?? EMPTY_DECISION_MAPPING);
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
    input.value = '';
  }

  async loadText(name: string, text: string): Promise<void> {
    this.notice.set(null);
    this.fileName.set(name);
    this.csvRows.set(parseCsv(text));
    this.mapping.set(this.isTemplate() ? DECISION_TEMPLATE_MAPPING : (this.savedMapping() ?? EMPTY_DECISION_MAPPING));
    await this.loadSalaries();
  }

  /** 見込みを出すための給与（いちばん早い適用年月の15か月前から） */
  private async loadSalaries(): Promise<void> {
    const months = this.fileMonths();
    if (months.length === 0) return;
    this.salaries.set(await this.salaryRepo.loadRange(addMonths(months[0], -15), months.at(-1)!));
  }

  protected setField(key: Field, value: string): void {
    this.mapping.update((m) => ({ ...m, [key]: value }));
    void this.loadSalaries();
  }

  protected async saveMapping(): Promise<void> {
    this.busy.set(true);
    try {
      await this.settingsRepo.saveDecisionMapping(this.mapping());
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
      await this.employeeRepo.saveDecisions(rows.map((r) => r.save!));
      const confirmed = rows.filter((r) => r.status === 'confirm').length;
      this.notice.set(
        `${rows.length}件の標準報酬月額を登録しました（うち通知書待ちの確定 ${confirmed}件）。すでに確定した月の額が変わった人は、差額の画面に出ます。`,
      );
      this.csvRows.set([]);
      this.fileName.set('');
      this.employees.set(await this.employeeRepo.loadAll());
    } catch (e) {
      console.error(e);
      this.notice.set('登録できませんでした。権限と通信を確かめてください。');
    } finally {
      this.busy.set(false);
    }
  }

  protected templateHref(): string {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + decisionTemplateCsv());
  }

  protected man(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : `${(v / 1000).toLocaleString('ja-JP')}千円`;
  }
}
