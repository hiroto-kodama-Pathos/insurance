// 賞与の登録と賞与保険料一覧（設計書 2.4・3.3）
// 支払う前に支給日と賞与額を登録し、上限・免除・喪失月を判定した保険料と、賞与支払届の期限を確かめる。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { BonusErrors, BonusInput, validateBonus } from '../../core/calc/bonus-input';
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
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { PaymentLine, summarizeMonth } from '../../core/calc/monthly-summary';
import { PremiumResult, senToDisplayYen } from '../../core/calc/premium-calculator';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';

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
  imports: [],
  selector: 'app-bonus-list',
  styleUrl: './bonus-list.scss',
  templateUrl: './bonus-list.html',
})
export class BonusList implements OnInit {
  private readonly bonusRepo = inject(BonusRepository);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);

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
  protected readonly form = signal<BonusInput>({ employeeId: '', paidDate: '', amount: null });
  protected readonly errors = signal<BonusErrors>({});

  /** 登録の候補にする従業員（社員番号順） */
  protected readonly employeeOptions = computed(() =>
    [...this.employees()].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber)),
  );

  /** 表示している月に払う（払った）賞与。確定済みの事業所は保存した結果を使う */
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
      if (r.result.target === 'outside' || !r.result.officeId) continue;
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
    const raw = (this.totalInputs()[id] ?? '').replace(/[,\s円]/g, '');
    const total = raw === '' ? null : Number(raw);
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
      const [employees, masters, settings] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
      ]);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
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

  protected setForm<K extends keyof BonusInput>(key: K, value: string): void {
    this.form.update((f) => ({
      ...f,
      [key]: key === 'amount' ? (value.replace(/[,\s円]/g, '') === '' ? null : Number(value.replace(/[,\s円]/g, ''))) : value,
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
      await this.bonusRepo.add({ employeeId: f.employeeId, paidDate: f.paidDate, amount: f.amount! }, officeId);
      const ym = f.paidDate.slice(0, 7);
      this.yearMonth.set(ym);
      await this.loadBonuses(true);
      const name = this.employees().find((e) => e.id === f.employeeId)?.name ?? '';
      this.notice.set(`${name}さんの賞与（${f.paidDate}支給）を登録しました。`);
      this.form.set({ employeeId: '', paidDate: f.paidDate, amount: null });
    } catch (e) {
      console.error(e);
      this.errors.set({ amount: '保存できませんでした。権限と通信を確かめてください。' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(row: BonusRow): Promise<void> {
    this.saving.set(true);
    try {
      await this.bonusRepo.remove(row.result.bonus.id);
      await this.loadBonuses(true);
      this.notice.set(`${row.employee.name}さんの賞与（${row.result.bonus.paidDate}支給）を削除しました。`);
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
  protected employeeTotal(r: BonusResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen([p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }
  protected notes(r: BonusResult): string[] {
    const n: string[] = [];
    if (r.status === 'outside') n.push('資格のない日の支給（保険料・届出なし）');
    if (r.status === 'noOffice') n.push('所属事業所が未登録');
    if (r.status === 'missingRate') n.push('料率が未登録');
    if (r.target === 'lostMonth') n.push('資格喪失月（保険料なし・累計に含める）');
    if (r.exemption === 'maternity') n.push('産休免除');
    if (r.exemption === 'childcare') n.push('育休免除');
    if (r.capped.health) n.push(`健保の年度累計の上限（${this.yen(r.base.health)}円まで）`);
    if (r.capped.pension) n.push(`厚年の同月の上限（${this.yen(r.base.pension)}円まで）`);
    if (r.multiOfficeReview) n.push('二以上事業所勤務のため要確認（他社の賞与と合わせると上限にかかるおそれ）');
    return n;
  }
  protected officeName(id: string): string {
    return this.masters()?.offices.find((o) => o.id === id)?.name ?? id;
  }
}
