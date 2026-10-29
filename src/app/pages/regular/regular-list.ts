// 定時決定の見込み（設計書 2.13.1・3.7）
// 7月に4〜6月の給与から見込みを一覧にし、算定基礎届を書くときにそのまま書き写せるようにする。
// 一覧はあくまで見込み。「見込みどおり登録」や一括登録をするまで、標準報酬月額も保険料も変わらない。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GradeRow } from '../../core/calc/grade-suggest';
import { estimateRegularAll, RegularEstimate, RegularSide, registrableRegular } from '../../core/calc/regular';
import { GradeThreshold } from '../../core/calc/revision';
import { SalaryRecord } from '../../core/calc/salary';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { DEFAULT_CUTOFF, PayrollCutoff } from '../../core/calc/insured-type';

/** 表示する年の初期値：7月以降はその年、1〜6月は前の年の定時決定 */
export function defaultRegularYear(today: string): number {
  const [y, m] = today.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

type Row = RegularEstimate & { employee: EmployeeRecord };

@Component({
  imports: [RouterLink],
  selector: 'app-regular-list',
  styleUrl: './regular-list.scss',
  templateUrl: './regular-list.html',
})
export class RegularList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly cutoff = signal<PayrollCutoff>(DEFAULT_CUTOFF);

  protected readonly year = signal(defaultRegularYear(today()));
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);

  protected readonly rows = computed<Row[]>(() => {
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return estimateRegularAll(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.year(), this.cutoff())
      .map((r) => ({ ...r, employee: byId.get(r.employeeId)! }))
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  });
  protected readonly registrable = computed(() => registrableRegular(this.rows()) as Row[]);
  protected readonly registeredCount = computed(() => this.rows().filter((r) => r.registered).length);
  /** 対象外（6月1日以降の資格取得など）で一覧に出ない人数 */
  protected readonly outsideCount = computed(() => this.employees().length - this.rows().length);

  async ngOnInit(): Promise<void> {
    try {
      const [employees, grades, thresholds, settings] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.settingsRepo.loadSettings(),
      ]);
      this.cutoff.set(settings.payrollCutoff);
      this.employees.set(employees);
      this.grades.set(grades);
      this.thresholds.set(thresholds);
      await this.loadYear();
      if (grades.length === 0) this.error.set('等級表（grades）が登録されていません。運営者に投入を依頼してください。');
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  /** 前年7月〜当年9月の給与（年間平均の特例と、7〜9月の随時改定の判定に使う） */
  async loadYear(): Promise<void> {
    const y = this.year();
    const salaries = await this.salaryRepo.loadRange(`${y - 1}-07`, `${y}-09`);
    if (y === this.year()) this.salaries.set(salaries);
  }

  protected onYearChange(value: string): void {
    const y = Number(value);
    if (!Number.isInteger(y) || y < 2000) return;
    this.year.set(y);
    this.notice.set(null);
    void this.loadYear();
  }

  private input(r: Row) {
    return {
      validFrom: `${r.year}-09`,
      reason: 'regular' as const,
      healthStandard: r.expectedHealth,
      pensionStandard: r.expectedPension,
    };
  }

  protected async register(r: Row): Promise<void> {
    await this.registerMany([r]);
  }

  /** 決定通知書が届いたら一括登録する（通知書と違う人は、あとで従業員の詳細から直す） */
  protected async registerAll(): Promise<void> {
    await this.registerMany(this.registrable());
  }

  private async registerMany(list: Row[]): Promise<void> {
    if (list.length === 0) return;
    this.saving.set(true);
    let done = 0;
    try {
      for (const r of list) {
        await this.employeeRepo.addStandard(r.employeeId, this.input(r), r.average);
        done++;
      }
      this.notice.set(
        list.length === 1
          ? `${list[0].employee.name}さんの${this.year()}年9月分からの標準報酬月額を登録しました。`
          : `${done}人の${this.year()}年9月分からの標準報酬月額を登録しました。決定通知書と違う人は、従業員の詳細から直してください。`,
      );
    } catch (e) {
      console.error(e);
      this.notice.set(`${done}人まで登録したところで止まりました。権限と通信を確かめて、もう一度押してください（登録済みの人は二重に登録されません）。`);
    } finally {
      this.employees.set(await this.employeeRepo.loadAll());
      this.saving.set(false);
    }
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }

  protected side(s: RegularSide | null): string {
    if (!s) return '―';
    const cur = s.currentGrade === null ? '' : `${s.currentGrade}等級 `;
    return `${cur}${this.yen(s.currentStandard)} → ${s.newGrade}等級 ${this.yen(s.newStandard)}`;
  }
}
