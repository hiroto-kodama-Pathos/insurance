// さかのぼる改定の差額（設計書 2.20）
// 確定した金額は書き換えず、差額を表示し、精算した給与の月を記録するまで「未精算」として知らせる。
import { PageState } from '../../core/ui/page-state';
import { Confirm } from '../../core/ui/confirm';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AdjustmentCause,
  findAdjustments,
  INSURANCE_KEYS,
  InsuranceKey,
  SettlementRecord,
  TrackedAdjustment,
  trackAdjustments,
} from '../../core/calc/adjustment';
import { OfficeClosing } from '../../core/calc/closing';
import { Masters } from '../../core/calc/employee-month';
import { ChildSupportRounding } from '../../core/calc/monthly-premium';
import { findOffice } from '../../core/calc/office';
import { addMonths } from '../../core/calc/salary';
import { AdjustmentChangedError, AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';
import { yearMonthLabel } from '../../core/calc/year-month';

/** 差額を探す確定済みの月の範囲（今月を含めた月数） */
export const ADJUSTMENT_LOOKBACK_MONTHS = 13;

export const CAUSE_LABEL: Record<AdjustmentCause, string> = {
  standard: '標準報酬月額のさかのぼる改定',
  transfer: '確定後に登録した異動',
  leave: '確定後の休業の登録・変更',
  added: '確定後に登録した資格・所属',
  other: 'そのほかの変更（適用除外・資格の喪失など）',
};

export const INSURANCE_LABEL: Record<InsuranceKey, string> = {
  health: '健康保険',
  care: '介護保険',
  childSupport: '支援金',
  pension: '厚生年金',
};

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}
function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

type Row = TrackedAdjustment & { employee: EmployeeRecord | null; currentOffice: string };

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe],
  selector: 'app-adjustment-list',
  styleUrl: './adjustment-list.scss',
  templateUrl: './adjustment-list.html',
})
export class AdjustmentList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly confirm = inject(Confirm);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly closingRepo = inject(ClosingRepository);
  private readonly adjustmentRepo = inject(AdjustmentRepository);

  protected readonly causeLabel = CAUSE_LABEL;
  protected readonly insuranceLabel = INSURANCE_LABEL;
  protected readonly keys = INSURANCE_KEYS;
  protected readonly lookback = ADJUSTMENT_LOOKBACK_MONTHS;
  protected readonly thisMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly tab = signal<'open' | 'settled'>('open');

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('adjustments.tab', this.tab);
    return true;
  })(inject(PageState));

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  private readonly rounding = signal<ChildSupportRounding>('combined');
  private readonly closings = signal<OfficeClosing[]>([]);
  private readonly settlements = signal<SettlementRecord[]>([]);
  /** 行ごとの精算月の入力（差額ID → 'YYYY-MM'） */
  protected readonly settleMonths = signal<Record<string, string>>({});

  private readonly all = computed<Row[]>(() => {
    const m = this.masters();
    if (!m) return [];
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return trackAdjustments(findAdjustments(this.employees(), m, this.closings(), this.rounding()), this.settlements()).map((a) => {
      const e = byId.get(a.employeeId) ?? null;
      let currentOffice = '';
      try {
        currentOffice = e ? findOffice(e.assignments, m.offices, today()).name : '';
      } catch {
        currentOffice = '';
      }
      return { ...a, employee: e, currentOffice };
    });
  });

  protected readonly openRows = computed(() => this.all().filter((r) => r.settledMonth === null));
  protected readonly settledRows = computed(() => this.all().filter((r) => r.settledMonth !== null));
  protected readonly rows = computed(() => (this.tab() === 'open' ? this.openRows() : this.settledRows()));

  /** 未精算の差額の、事業所ごとの納付見込額の差額（納付書との照合の参考） */
  protected readonly officeTotals = computed(() => {
    const map = new Map<string, { officeId: string; fullSen: number; employee: number; count: number }>();
    for (const r of this.openRows()) {
      const t = map.get(r.officeId) ?? { officeId: r.officeId, fullSen: 0, employee: 0, count: 0 };
      t.fullSen += INSURANCE_KEYS.reduce((s, k) => s + r.remaining[k].fullSen, 0);
      t.employee += r.remainingEmployeeTotal;
      t.count++;
      map.set(r.officeId, t);
    }
    return [...map.values()];
  });

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters, settings, closings, settlements] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.settingsRepo.loadSettings(),
        this.closingRepo.loadRecent(this.thisMonth(), ADJUSTMENT_LOOKBACK_MONTHS),
        this.adjustmentRepo.loadSettlements(),
      ]);
      this.employees.set(employees);
      this.masters.set(masters);
      this.rounding.set(settings.childSupportRounding);
      this.closings.set(closings);
      this.settlements.set(settlements);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  /** 精算月の初期値：来月の給与 */
  protected settleMonth(id: string): string {
    return this.settleMonths()[id] ?? addMonths(this.thisMonth(), 1);
  }

  protected setSettleMonth(id: string, value: string): void {
    this.settleMonths.update((m) => ({ ...m, [id]: value }));
  }

  protected async settle(row: Row): Promise<void> {
    const month = this.settleMonth(row.id);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      this.notice.set('精算する給与の月を入れてください。');
      return;
    }
    const ok = await this.confirm.ask({
      title: '精算済みにしますか',
      message: `${row.employee?.name ?? ''}さんの${yearMonthLabel(row.yearMonth)}分の差額を、${yearMonthLabel(month)}の給与で精算したものとして記録します。`,
      ok: '精算済みにする',
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.adjustmentRepo.settle(row, month, this.settlements().find((s) => s.id === row.id));
      this.settlements.set(await this.adjustmentRepo.loadSettlements());
      this.notice.set(`${row.employee?.name ?? ''}さんの${yearMonthLabel(row.yearMonth)}分の差額を、${yearMonthLabel(month)}の給与で精算済みにしました。`);
    } catch (e) {
      console.error(e);
      if (e instanceof AdjustmentChangedError) {
        // ほかの担当者が先に精算・取り消しをした。今の記録を読み直して見せる（古い記録のまま書くと、二重に精算するため）
        this.settlements.set(await this.adjustmentRepo.loadSettlements().catch(() => this.settlements()));
        this.notice.set('ほかの担当者が先にこの差額の精算を記録・取り消ししました。最新の状態を読み込んだので、確かめてからやり直してください。');
      } else this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  /** 精算済みを取り消して、未精算に戻す（精算した給与の月の誤り・まだ精算していなかったときなど） */
  protected async unsettle(row: Row): Promise<void> {
    const record = this.settlements().find((s) => s.id === row.id);
    if (!record || record.entries.length === 0) return;
    const last = record.entries.at(-1)!;
    const ok = await this.confirm.ask({
      title: '未精算に戻しますか',
      message: `${row.employee?.name ?? ''}さんの${yearMonthLabel(row.yearMonth)}分の差額の、${yearMonthLabel(last.settledMonth)}の給与での精算の記録を取り消します。差額は未精算に戻り、精算する給与の月を入れ直せます。`,
      ok: '未精算に戻す',
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.adjustmentRepo.unsettle(row.id, record);
      this.settlements.set(await this.adjustmentRepo.loadSettlements());
      this.notice.set(`${row.employee?.name ?? ''}さんの${yearMonthLabel(row.yearMonth)}分の差額を、未精算に戻しました。`);
    } catch (e) {
      console.error(e);
      if (e instanceof AdjustmentChangedError) {
        // ほかの担当者が先に精算・取り消しをした。今の記録を読み直して見せる（古い記録のまま書くと、二重に精算するため）
        this.settlements.set(await this.adjustmentRepo.loadSettlements().catch(() => this.settlements()));
        this.notice.set('ほかの担当者が先にこの差額の精算を記録・取り消ししました。最新の状態を読み込んだので、確かめてからやり直してください。');
      } else this.notice.set('保存できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(false);
    }
  }

  protected officeName(id: string): string {
    return this.masters()?.offices.find((o) => o.id === id)?.name ?? id;
  }

  protected yen(v: number): string {
    return (v > 0 ? '+' : '') + v.toLocaleString('ja-JP');
  }

  /** 銭を円にして表示（円未満は切り捨て） */
  protected senYen(sen: number): string {
    return this.yen(Math.trunc(sen / 100));
  }

  protected employerTotal(r: Row): number {
    return INSURANCE_KEYS.reduce((s, k) => s + r.remaining[k].employerSen, 0);
  }

  protected fullTotal(r: Row): number {
    return INSURANCE_KEYS.reduce((s, k) => s + r.remaining[k].fullSen, 0);
  }

  protected man(s: { health: number; pension: number } | null): string {
    if (!s) return '―';
    const f = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    return s.health === s.pension ? f(s.health) : `健保 ${f(s.health)}／厚年 ${f(s.pension)}`;
  }
}
