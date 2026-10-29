// 給与の入力（設計書 2.13・3.6）
// 給与ソフトで計算した給与を支払月ごとに入れる。給与は随時改定の候補を見つけるためだけに使い、保険料は変わらない。
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfficeClosing } from '../../core/calc/closing';
import { isInsuredInMonth } from '../../core/calc/eligibility';
import { Masters } from '../../core/calc/employee-month';
import { findOffice } from '../../core/calc/office';
import {
  addMonths,
  detectFixedWageChanges,
  FixedWageChange,
  payMonths,
  SalaryErrors,
  SalaryInput,
  SalaryRecord,
  validateSalary,
} from '../../core/calc/salary';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
}

/** 入力欄の文字列（空欄は null） */
type Draft = Record<keyof SalaryInput, string>;

export type SalaryRow = {
  employee: EmployeeRecord;
  /** この月に登録済みの給与（最初の1件を編集する） */
  existing: SalaryRecord | null;
  /** この月のほかの支払い（月2回払いなど。合算して判定する） */
  others: number;
  /** 前月の固定的賃金（遡及差額を除く） */
  previousFixed: number | null;
  change: FixedWageChange | null;
  officeId: string | null;
  closed: boolean;
};

@Component({
  imports: [RouterLink],
  selector: 'app-salary-list',
  styleUrl: './salary-list.scss',
  templateUrl: './salary-list.html',
})
export class SalaryList implements OnInit {
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly closingRepo = inject(ClosingRepository);

  protected readonly yearMonth = signal(currentMonth());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal<string | null>(null);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly masters = signal<Masters | null>(null);
  /** 表示している月と前月の給与 */
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly closings = signal<OfficeClosing[]>([]);

  /** 行ごとの入力中の値（従業員ID → 入力） */
  protected readonly drafts = signal<Record<string, Draft>>({});
  protected readonly errors = signal<Record<string, SalaryErrors & { form?: string }>>({});

  protected readonly rows = computed<SalaryRow[]>(() => {
    const ym = this.yearMonth();
    const m = this.masters();
    if (!m) return [];
    const closed = new Set(this.closings().map((c) => c.officeId));
    return this.employees()
      .filter((e) => isInsuredInMonth(e.qualifications, ym))
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
      .map((e) => {
        const mine = this.salaries().filter((s) => s.employeeId === e.id);
        const thisMonth = mine.filter((s) => s.paidDate.startsWith(ym)).sort((a, b) => a.paidDate.localeCompare(b.paidDate));
        const months = payMonths(mine);
        const prev = months.find((x) => x.yearMonth === addMonths(ym, -1));
        const change = detectFixedWageChanges(months).find((c) => c.yearMonth === ym) ?? null;
        let officeId: string | null = null;
        try {
          officeId = findOffice(e.assignments, m.offices, `${ym}-01`).id;
        } catch {
          officeId = null;
        }
        return {
          employee: e,
          existing: thisMonth[0] ?? null,
          others: Math.max(0, thisMonth.length - 1),
          previousFixed: prev ? prev.fixed : null,
          change,
          officeId,
          closed: officeId !== null && closed.has(officeId),
        };
      });
  });

  protected readonly enteredCount = computed(() => this.rows().filter((r) => r.existing).length);
  protected readonly changedCount = computed(() => this.rows().filter((r) => r.change).length);

  async ngOnInit(): Promise<void> {
    try {
      const [employees, masters] = await Promise.all([this.employeeRepo.loadAll(), this.masterRepo.loadMasters()]);
      this.employees.set(employees);
      this.masters.set(masters);
      await this.loadMonth();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMonth(): Promise<void> {
    const ym = this.yearMonth();
    const [salaries, closings] = await Promise.all([
      this.salaryRepo.loadRange(addMonths(ym, -1), ym),
      this.closingRepo.loadMonth(ym),
    ]);
    if (ym !== this.yearMonth()) return;
    this.salaries.set(salaries);
    this.closings.set(closings);
    this.resetDrafts();
  }

  /** 入力欄を、登録済みの値（なければ空欄と支払日の初期値）に戻す */
  private resetDrafts(): void {
    const ym = this.yearMonth();
    const drafts: Record<string, Draft> = {};
    for (const r of this.rows()) {
      const s = r.existing;
      const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
      drafts[r.employee.id] = {
        paidDate: s?.paidDate ?? `${ym}-25`,
        fixedWages: str(s?.fixedWages),
        nonFixedWages: str(s?.nonFixedWages),
        paymentBaseDays: str(s?.paymentBaseDays),
        retroactiveDiff: str(s?.retroactiveDiff),
        inKindWages: str(s?.inKindWages),
      };
    }
    this.drafts.set(drafts);
    this.errors.set({});
  }

  protected onMonthChange(value: string): void {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    this.yearMonth.set(value);
    this.notice.set(null);
    void this.loadMonth();
  }

  protected draft(id: string, key: keyof SalaryInput): string {
    return this.drafts()[id]?.[key] ?? '';
  }

  protected setDraft(id: string, key: keyof SalaryInput, value: string): void {
    this.drafts.update((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  }

  private toInput(d: Draft): SalaryInput {
    const num = (v: string) => {
      const t = v.replace(/[,\s円日]/g, '');
      return t === '' ? null : Number(t);
    };
    return {
      paidDate: d.paidDate,
      fixedWages: num(d.fixedWages),
      nonFixedWages: num(d.nonFixedWages),
      paymentBaseDays: num(d.paymentBaseDays),
      retroactiveDiff: num(d.retroactiveDiff),
      inKindWages: num(d.inKindWages),
    };
  }

  protected async save(row: SalaryRow): Promise<void> {
    const id = row.employee.id;
    const input = this.toInput(this.drafts()[id]);
    const errors: SalaryErrors & { form?: string } = validateSalary(input);
    if (!errors.paidDate && !input.paidDate.startsWith(this.yearMonth()))
      errors.paidDate = `支払日は${this.yearMonth()}の日付にしてください（随時改定は支払月で数えます）`;
    if (!row.officeId) errors.form = 'この月に所属している適用事業所がありません';
    if (row.closed) errors.form = 'この月は確定済みです。月次保険料一覧で確定を解除してから入力してください';
    this.errors.update((e) => ({ ...e, [id]: errors }));
    if (Object.keys(errors).length > 0) return;

    this.saving.set(id);
    try {
      await this.salaryRepo.save(
        {
          employeeId: id,
          paidDate: input.paidDate,
          fixedWages: input.fixedWages!,
          nonFixedWages: input.nonFixedWages ?? 0,
          paymentBaseDays: input.paymentBaseDays!,
          retroactiveDiff: input.retroactiveDiff || null,
          inKindWages: input.inKindWages || null,
        },
        row.officeId!,
      );
      // 支払日を直したときは、前の支払日の給与を消す（同じ月に2件にならないように）
      if (row.existing && row.existing.paidDate !== input.paidDate) await this.salaryRepo.remove(row.existing.id);
      await this.loadMonth();
      this.notice.set(`${row.employee.name}さんの給与（${input.paidDate}支払）を保存しました。`);
    } catch (e) {
      console.error(e);
      this.errors.update((x) => ({ ...x, [id]: { form: '保存できませんでした。権限と通信を確かめてください。' } }));
    } finally {
      this.saving.set(null);
    }
  }

  protected async remove(row: SalaryRow): Promise<void> {
    if (!row.existing) return;
    this.saving.set(row.employee.id);
    try {
      await this.salaryRepo.remove(row.existing.id);
      await this.loadMonth();
      this.notice.set(`${row.employee.name}さんの給与（${row.existing.paidDate}支払）を削除しました。`);
    } catch (e) {
      console.error(e);
      this.notice.set('削除できませんでした。権限と通信を確かめてください。');
    } finally {
      this.saving.set(null);
    }
  }

  protected err(id: string, key: keyof SalaryInput | 'form'): string {
    return this.errors()[id]?.[key] ?? '';
  }

  protected yen(v: number | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }

}
