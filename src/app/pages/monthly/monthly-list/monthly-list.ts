// 月次保険料一覧（設計書 3.2）
// 対象月を選ぶと、全従業員の保険料と、適用事業所別の小計・会社合計を表示する。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Auth } from '../../../core/auth/auth';
import { BonusRecord, calcEmployeeBonuses, fiscalYearOf } from '../../../core/calc/bonus-premium';
import {
  BonusRowInput,
  buildOfficeClosing,
  canCloseOffice,
  closeBlockers,
  mergeWithClosings,
  OfficeClosing,
  RowInput,
} from '../../../core/calc/closing';
import { calcEmployeeMonth, EmployeeMonthResult, findEffective, Masters } from '../../../core/calc/employee-month';
import { summarizeMonth, PaymentLine } from '../../../core/calc/monthly-summary';
import { PremiumResult, senToDisplayYen } from '../../../core/calc/premium-calculator';
import { BonusRepository } from '../../../core/repository/bonus-repository';
import { ClosingRepository } from '../../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { ChildSupportRounding } from '../../../core/calc/monthly-premium';
import { exemptionNote } from '../../../core/calc/exemption';
import { checkDeduction, DeductionCheck, DeductionTiming, payMonthFor } from '../../../core/calc/deduction';
import { addMonths, SalaryRecord } from '../../../core/calc/salary';
import { SalaryRepository } from '../../../core/repository/salary-repository';
import { AdjustmentRepository } from '../../../core/repository/adjustment-repository';
import { SettlementRecord, settledAmountFor } from '../../../core/calc/adjustment';

/** 一覧の1行 */
export type MonthlyRow = RowInput & {
  officeName: string;
  /** 確定済みの結果か */
  closed: boolean;
};

/** 適用事業所ごとの確定の状況 */
export type OfficeStatus = {
  officeId: string;
  name: string;
  closing: OfficeClosing | null;
  /** 確定できない理由（空なら確定できる） */
  blockers: string[];
  /** ログイン中の人が確定・解除できるか */
  canOperate: boolean;
  /** その月に支給する賞与の件数（確定すると一緒に保存する） */
  bonusCount: number;
};

const STATUS_LABEL: Record<EmployeeMonthResult['status'], string> = {
  ok: '',
  notInsured: '資格なし',
  noOffice: '所属事業所が未登録',
  noStandard: '標準報酬月額が未登録',
  missingRate: '料率が未登録',
};

const LINE_LABEL: Record<PaymentLine, string> = {
  healthCare: '健康保険（介護保険を含む）',
  childSupport: '子ども・子育て支援金',
  pension: '厚生年金保険',
};

/** 今月（日本時間）'YYYY-MM' */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

@Component({
  imports: [],
  selector: 'app-monthly-list',
  styleUrl: './monthly-list.scss',
  templateUrl: './monthly-list.html',
})
export class MonthlyList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly bonusRepo = inject(BonusRepository);
  private readonly auth = inject(Auth);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly adjustmentRepo = inject(AdjustmentRepository);
  private readonly settlements = signal<SettlementRecord[]>([]);

  protected readonly yearMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  /** 支援金の端数処理（会社の設定） */
  private readonly rounding = signal<ChildSupportRounding>('combined');
  private readonly closings = signal<OfficeClosing[]>([]);
  /** 表示している月の年度の賞与（上限の計算に年度分すべてが要る） */
  private readonly fyBonuses = signal<BonusRecord[]>([]);
  protected readonly saving = signal(false);
  protected readonly notice = signal<string | null>(null);
  /** 保険料を控除する給与（会社の設定） */
  protected readonly timing = signal<DeductionTiming>('nextMonth');
  /** 表示している月と翌月に支払った給与（控除できるかの判定に使う） */
  private readonly salaries = signal<SalaryRecord[]>([]);

  protected readonly lineLabels = LINE_LABEL;
  protected readonly lines: PaymentLine[] = ['healthCare', 'childSupport', 'pension'];

  /** その場で計算した結果（確定前の値） */
  private readonly liveRows = computed<RowInput[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    return this.employees().map((e) => ({ employee: e, result: calcEmployeeMonth(e, m, ym, this.rounding()) }));
  });

  /** その月に支給する賞与（その場で計算した結果） */
  private readonly liveBonusRows = computed<BonusRowInput[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    return this.employees()
      .flatMap((e) => calcEmployeeBonuses(e, this.fyBonuses(), m, this.rounding()).map((result) => ({ employee: e, result })))
      .filter((r) => r.result.yearMonth === ym && r.result.target !== 'outside');
  });

  /** 資格のない人を除いた、一覧に出す行（社員番号順）。確定済みの事業所は保存した結果を使う */
  protected readonly rows = computed<MonthlyRow[]>(() => {
    const m = this.masters();
    if (!m) return [];
    return mergeWithClosings(this.liveRows(), this.closings())
      .filter((r) => r.result.status !== 'notInsured')
      .map((r) => ({ ...r, officeName: m.offices.find((o) => o.id === r.result.officeId)?.name ?? '' }))
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  });

  /** 保険料がかかる人がいる事業所と、確定済みの事業所の、確定の状況 */
  protected readonly officeStatuses = computed<OfficeStatus[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const ym = this.yearMonth();
    const scope = this.auth.user()?.siScope ?? null;
    const live = this.liveRows();
    const bonuses = this.liveBonusRows();
    return m.offices
      .map((o) => {
        const closing = this.closings().find((c) => c.officeId === o.id) ?? null;
        const bonusCount = closing
          ? (closing.bonusRows ?? []).length
          : bonuses.filter((b) => b.result.officeId === o.id).length;
        const used =
          live.some((r) => r.result.officeId === o.id && r.result.status !== 'notInsured') || bonusCount > 0;
        if (!closing && !used) return null;
        return {
          officeId: o.id,
          name: o.name,
          closing,
          blockers: closing ? [] : closeBlockers(ym, o.id, live, bonuses),
          canOperate: canCloseOffice(scope, o.id),
          bonusCount,
        };
      })
      .filter((x): x is OfficeStatus => x !== null);
  });

  /** すべての事業所が確定済みか */
  protected readonly allClosed = computed(
    () => this.officeStatuses().length > 0 && this.officeStatuses().every((s) => s.closing !== null),
  );
  /** まとめて確定できる事業所（自分が操作でき、問題がなく、未確定） */
  protected readonly closableOffices = computed(() =>
    this.officeStatuses().filter((s) => !s.closing && s.canOperate && s.blockers.length === 0),
  );

  /** 「10月分保険料（11月支給給与から控除）」の、控除する給与の月（ふつうの人） */
  protected readonly payMonth = computed(() => (this.timing() === 'sameMonth' ? this.yearMonth() : addMonths(this.yearMonth(), 1)));

  /** 1人ずつ、控除する給与で本人負担を控除しきれるか（設計書 2.21） */
  protected readonly deductions = computed(() => {
    const m = this.masters();
    const map = new Map<string, DeductionCheck>();
    if (!m) return map;
    const ym = this.yearMonth();
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    for (const row of this.rows()) {
      const e = byId.get(row.employee.id);
      if (!e) continue;
      const premiumOf = (pym: string) => {
        const r = pym === ym ? row.result : calcEmployeeMonth(e, m, pym, this.rounding());
        const p = r.premium;
        if (!p) return 0;
        return Number([p.health, p.care, p.childSupport, p.pension].reduce((t, x) => t + (x?.employeeYen ?? 0n), 0n));
      };
      const payYm = payMonthFor(ym, this.timing(), e.qualifications);
      map.set(
        e.id,
        checkDeduction(e.id, e.qualifications, payYm, this.timing(), this.salaries(), premiumOf, settledAmountFor(e.id, payYm, this.settlements())),
      );
    }
    return map;
  });

  protected readonly summary = computed(() =>
    summarizeMonth(
      this.yearMonth(),
      this.rows().map((r) => r.result),
    ),
  );

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, settlements] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
        this.adjustmentRepo.loadSettlements(),
      ]);
      this.settlements.set(settlements);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.timing.set(settings.deductionTiming);
      await this.loadClosings();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected onMonthChange(value: string): void {
    if (/^\d{4}-\d{2}$/.test(value)) {
      this.yearMonth.set(value);
      this.notice.set(null);
      void this.loadClosings();
    }
  }

  private async loadClosings(): Promise<void> {
    const ym = this.yearMonth();
    const [list, bonuses, salaries] = await Promise.all([
      this.closingRepo.loadMonth(ym),
      this.bonusRepo.loadFiscalYear(fiscalYearOf(`${ym}-01`)),
      this.salaryRepo.loadRange(ym, addMonths(ym, 1)),
    ]);
    if (ym === this.yearMonth()) {
      this.closings.set(list);
      this.fyBonuses.set(bonuses);
      this.salaries.set(salaries);
    }
  }

  /** 事業所ごとに確定する（officeIds を順に保存する） */
  protected async close(officeIds: string[]): Promise<void> {
    const uid = this.auth.user()?.uid ?? '';
    const ym = this.yearMonth();
    await this.run(async () => {
      for (const id of officeIds) {
        await this.closingRepo.close(buildOfficeClosing(ym, id, this.liveRows(), uid, this.liveBonusRows()));
      }
    }, `${ym}分を確定しました（${officeIds.map((id) => this.officeName(id)).join('・')}）。`);
  }

  protected async reopen(officeId: string): Promise<void> {
    await this.run(
      () => this.closingRepo.reopen(this.yearMonth(), officeId),
      `${this.officeName(officeId)}の${this.yearMonth()}分の確定を解除しました。`,
    );
  }

  private async run(action: () => Promise<void>, message: string): Promise<void> {
    this.saving.set(true);
    this.notice.set(null);
    try {
      await action();
      this.notice.set(message);
    } catch (e) {
      console.error(e);
      this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      await this.loadClosings();
      this.saving.set(false);
    }
  }

  protected closedAtLabel(c: OfficeClosing): string {
    return c.closedAt ? new Date(c.closedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
  }

  protected officeName(officeId: string): string {
    return this.masters()?.offices.find((o) => o.id === officeId)?.name ?? officeId;
  }

  protected statusLabel(row: MonthlyRow): string {
    return STATUS_LABEL[row.result.status];
  }

  /** 円を3桁区切りで表示する */
  protected yen(value: bigint | null | undefined): string {
    return value === null || value === undefined ? '' : value.toLocaleString('ja-JP');
  }

  /** 会社負担（銭）を、円未満を切り捨てて表示する */
  protected employerYen(p: PremiumResult | null | undefined): string {
    return p ? this.yen(senToDisplayYen(p.employerSen)) : '';
  }

  /** その人の本人負担の合計 */
  protected employeeTotal(row: MonthlyRow): string {
    const p = row.result.premium;
    if (!p) return '';
    const parts = [p.health, p.care, p.childSupport, p.pension];
    return this.yen(parts.reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }

  /** 介護保険の欄に出す説明（かからない人の理由） */
  protected careNote(row: MonthlyRow): string {
    const p = row.result.premium;
    if (!p || p.care) return '';
    if (p.careLabel === 'first') return '第1号（65歳以上）';
    if (p.careLabel === 'none') return '対象外（40歳未満）';
    return '';
  }

  /** 適用除外で0円にしている保険（確定済みの行は、今の登録から表示する） */
  protected exemptionLabel(row: MonthlyRow): string {
    const e = this.employees().find((x) => x.id === row.employee.id);
    return e ? exemptionNote(e.exemptions, this.yearMonth()) : '';
  }

  /** 二以上事業所勤務の按分（自社の報酬／合計の報酬） */
  protected multiOfficeLabel(row: MonthlyRow): string {
    const e = this.employees().find((x) => x.id === row.employee.id);
    const s = e ? findEffective(e.standardHistory, this.yearMonth()) : null;
    if (!s?.ownRemuneration || !s.totalRemuneration || s.ownRemuneration >= s.totalRemuneration) return '';
    const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    return `二以上事業所勤務（${man(s.ownRemuneration)}／${man(s.totalRemuneration)}で按分）`;
  }

  protected monthLabel(ym: string): string {
    return `${Number(ym.slice(5))}月`;
  }

  /** 標準報酬月額の表示（健保と厚年が違えば両方） */
  protected standardLabel(row: MonthlyRow): string {
    const s = row.result.standard;
    if (!s) return '';
    const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    return s.health === s.pension ? man(s.health) : `健保 ${man(s.health)}／厚年 ${man(s.pension)}`;
  }
}
