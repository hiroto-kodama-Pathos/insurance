// 期間ごとの会社負担の集計（設計書 2.29・3.14）
// 開始月〜終了月の会社負担を、月別・保険別に月額と賞与に分けて出す。確定済みの月は確定した結果を、未確定の月はその場で計算した結果を使う。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Auth } from '../../core/auth/auth';
import { BonusRecord, calcEmployeeBonuses, fiscalYearOf } from '../../core/calc/bonus-premium';
import { bonusAsMonthResult, mergeBonusesWithClosings, mergeWithClosings, OfficeClosing } from '../../core/calc/closing';
import { calcEmployeeMonth, Masters } from '../../core/calc/employee-month';
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { INSURANCE_LABEL, InsuranceKey, monthRange, PeriodMonthInput, periodCsv, periodTotals } from '../../core/calc/period-total';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';

function thisMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

/** 今年度の4月（1〜3月なら前年の4月） */
export function fiscalStart(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04`;
}

@Component({
  imports: [YearMonthPipe],
  selector: 'app-period-totals',
  styleUrl: './period-totals.scss',
  templateUrl: './period-totals.html',
})
export class PeriodTotals implements OnInit {
  private readonly auth = inject(Auth);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly bonusRepo = inject(BonusRepository);

  protected readonly keys: InsuranceKey[] = ['health', 'care', 'childSupport', 'pension'];
  protected readonly labels = INSURANCE_LABEL;
  protected readonly from = signal(fiscalStart(thisMonth()));
  protected readonly to = signal(thisMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rangeError = signal<string | null>(null);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  private readonly rounding = signal<ChildSupportRounding>('combined');
  private readonly closings = signal<OfficeClosing[]>([]);
  private readonly bonuses = signal<BonusRecord[]>([]);

  /** 担当範囲（特定の事業所の担当者は、その事業所だけ） */
  protected readonly scope = computed(() => this.auth.user()?.siScope ?? 'all');
  protected readonly officeId = signal('');
  protected readonly offices = computed(() => (this.masters()?.offices ?? []).filter((o) => this.scope() === 'all' || o.id === this.scope()));

  private readonly months = computed<PeriodMonthInput[]>(() => {
    const m = this.masters();
    if (!m) return [];
    return monthRange(this.from(), this.to()).map((ym) => {
      const closings = this.closings().filter((c) => c.yearMonth === ym);
      const live = this.employees().map((e) => ({ employee: e, result: calcEmployeeMonth(e, m, ym, this.rounding()) }));
      const monthly = mergeWithClosings(live, closings).map((r) => r.result).filter((r) => r.status !== 'notInsured');
      const fy = fiscalYearOf(`${ym}-01`);
      const fyBonuses = this.bonuses().filter((b) => fiscalYearOf(b.paidDate) === fy);
      const liveBonus = this.employees()
        .flatMap((e) => calcEmployeeBonuses(e, fyBonuses, m, this.rounding()).map((result) => ({ employee: e, result })))
        .filter((r) => r.result.yearMonth === ym && r.result.target !== 'outside' && r.result.status !== 'remuneration');
      const bonus = mergeBonusesWithClosings(liveBonus, closings).map((r) => bonusAsMonthResult(r.result));
      // 保険料がかかる事業所のうち、確定していない事業所がある
      const used = new Set([...monthly, ...bonus].filter((r) => r.status === 'ok').map((r) => r.officeId));
      const target = this.officeId() || (this.scope() === 'all' ? '' : this.scope());
      const closed = new Set(closings.map((c) => c.officeId));
      const includesUnclosed = [...used].some((o) => o && (target === '' || o === target) && !closed.has(o));
      return { yearMonth: ym, monthly, bonus, includesUnclosed };
    });
  });

  protected readonly result = computed(() => {
    const office = this.officeId() || (this.scope() === 'all' ? '' : this.scope());
    return periodTotals(this.months(), office);
  });

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
      ]);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      await this.loadRange();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  /** 期間の確定結果と、期間にかかる年度の賞与を読む */
  private async loadRange(): Promise<void> {
    const months = monthRange(this.from(), this.to());
    const years = [...new Set(months.map((ym) => fiscalYearOf(`${ym}-01`)))];
    const [closings, bonuses] = await Promise.all([
      Promise.all(months.map((ym) => this.closingRepo.loadMonth(ym))),
      Promise.all(years.map((y) => this.bonusRepo.loadFiscalYear(y))),
    ]);
    this.closings.set(closings.flat());
    this.bonuses.set(bonuses.flat());
  }

  protected async setRange(key: 'from' | 'to', value: string): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const from = key === 'from' ? value : this.from();
    const to = key === 'to' ? value : this.to();
    if (from > to) {
      this.rangeError.set('開始月は終了月以前にしてください');
      return;
    }
    if (monthRange(from, to).length > 24) {
      this.rangeError.set('期間は24か月以内にしてください');
      return;
    }
    this.rangeError.set(null);
    this.from.set(from);
    this.to.set(to);
    await this.loadRange();
  }

  protected yen(v: number): string {
    return v.toLocaleString('ja-JP');
  }

  protected csvHref(): string {
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(periodCsv(this.result()));
  }
}
