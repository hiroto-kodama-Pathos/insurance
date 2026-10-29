// 従業員一覧と新規登録（設計書 3.1）
import { INSURED_TYPE_LABEL, InsuredType } from '../../../core/calc/insured-type';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { monthOf } from '../../../core/calc/date';
import { isInsuredInMonth } from '../../../core/calc/eligibility';
import { findEffective } from '../../../core/calc/employee-month';
import { GradeRow, GradeSuggestion, suggestStandards } from '../../../core/calc/grade-suggest';
import { isValidDate, NewEmployeeErrors, NewEmployeeInput, validateNewEmployee } from '../../../core/calc/new-employee';
import { defaultOfficeId, findOffice, Office } from '../../../core/calc/office';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';

/** 今日（日本時間）'YYYY-MM-DD' */
function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** 一覧の1行 */
export type EmployeeRow = {
  employee: EmployeeRecord;
  officeName: string;
  officeId: string;
  status: '加入中' | '資格なし' | '未加入';
  standard: string;
};

type TextKey = 'employeeNumber' | 'name' | 'birthDate' | 'acquiredDate' | 'officeId';
type AmountKey = 'remuneration' | 'healthStandard' | 'pensionStandard';

@Component({
  imports: [RouterLink],
  selector: 'app-employee-list',
  styleUrl: './employee-list.scss',
  templateUrl: './employee-list.html',
})
export class EmployeeList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly employees = signal<EmployeeRecord[]>([]);
  protected readonly offices = signal<Office[]>([]);
  private readonly grades = signal<GradeRow[]>([]);

  protected readonly showForm = signal(false);
  protected readonly insuredTypeLabel = INSURED_TYPE_LABEL;
  protected readonly insuredTypes = Object.keys(INSURED_TYPE_LABEL) as InsuredType[];
  protected readonly form = signal<NewEmployeeInput>(this.emptyForm());
  protected readonly errors = signal<NewEmployeeErrors>({});
  protected readonly saving = signal(false);
  protected readonly notice = signal<string | null>(null);
  /** 直近の「提案を入力」の結果（等級の表示に使う） */
  protected readonly suggestion = signal<GradeSuggestion | null>(null);
  protected readonly suggestMessage = signal<string | null>(null);

  /** 一覧の絞り込み */
  protected readonly statusFilter = signal<'all' | EmployeeRow['status']>('all');
  protected readonly query = signal('');
  protected readonly officeFilter = signal('');
  protected readonly statusTabs: ('all' | EmployeeRow['status'])[] = ['all', '加入中', '資格なし', '未加入'];

  /** 絞り込んだ一覧 */
  protected readonly filteredRows = computed(() => {
    const q = this.query().replace(/[\s　]/g, '');
    const st = this.statusFilter();
    const office = this.officeFilter();
    return this.rows().filter(
      (r) =>
        (st === 'all' || r.status === st) &&
        (office === '' || r.officeId === office) &&
        (q === '' || r.employee.employeeNumber.includes(q) || r.employee.name.replace(/[\s　]/g, '').includes(q)),
    );
  });

  /** 状態ごとの人数（タブに出す） */
  protected readonly counts = computed(() => {
    const c: Record<string, number> = { all: this.rows().length, 加入中: 0, 資格なし: 0, 未加入: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });

  protected readonly rows = computed<EmployeeRow[]>(() => {
    const d = today();
    const ym = monthOf(d);
    return [...this.employees()]
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
      .map((e) => {
        let officeName = '';
        let officeId = '';
        try {
          const o = findOffice(e.assignments, this.offices(), d);
          officeName = o.name;
          officeId = o.id;
        } catch {
          officeName = '';
        }
        const std = findEffective(e.standardHistory, ym);
        const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
        const standard = !std
          ? ''
          : std.healthStandard === std.pensionStandard
            ? man(std.healthStandard)
            : `健保 ${man(std.healthStandard)}／厚年 ${man(std.pensionStandard)}`;
        const status: EmployeeRow['status'] =
          e.qualifications.length === 0
            ? '未加入'
            : isInsuredInMonth(e.qualifications, ym)
              ? '加入中'
              : '資格なし';
        return { employee: e, officeName, officeId, status, standard };
      });
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private emptyForm(): NewEmployeeInput {
    return {
      employeeNumber: '',
      name: '',
      birthDate: '',
      officeId: defaultOfficeId(this.offices?.() ?? []),
      insured: true,
      acquiredDate: today(),
      remuneration: null,
      healthStandard: null,
      pensionStandard: null,
    };
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [employees, masters, grades] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadMasters(),
        this.masterRepo.loadGrades(),
      ]);
      this.employees.set(employees);
      this.offices.set(masters.offices);
      this.grades.set(grades);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected openForm(): void {
    this.form.set(this.emptyForm());
    this.errors.set({});
    this.notice.set(null);
    this.suggestion.set(null);
    this.suggestMessage.set(null);
    this.showForm.set(true);
  }

  protected closeForm(): void {
    this.showForm.set(false);
  }

  protected setInsuredType(value: InsuredType): void {
    this.form.update((f) => ({ ...f, insuredType: value }));
  }

  protected setText(key: TextKey, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected setInsured(insured: boolean): void {
    this.form.update((f) => ({ ...f, insured }));
  }

  protected setAmount(key: AmountKey, value: string): void {
    const n = value.replace(/[,\s円]/g, '');
    const amount = n === '' ? null : Number(n);
    this.form.update((f) => ({ ...f, [key]: amount }));
    if (key !== 'remuneration') this.suggestion.set(null);
  }

  /** 報酬月額から、協会けんぽの保険料額表の等級で標準報酬月額を入れる */
  protected suggest(): void {
    const f = this.form();
    this.suggestMessage.set(null);
    if (f.remuneration === null || !(f.remuneration > 0)) {
      this.suggestMessage.set('先に報酬月額（見込み）を入力してください。');
      return;
    }
    const ym = isValidDate(f.acquiredDate) ? monthOf(f.acquiredDate) : monthOf(today());
    const s = suggestStandards(f.remuneration, this.grades(), ym, isValidDate(f.birthDate) ? f.birthDate : '');
    if (!s) {
      this.suggestMessage.set('この月に使える等級表が登録されていません。管理者に確認してください。');
      return;
    }
    this.form.update((x) => ({ ...x, healthStandard: s.healthStandard, pensionStandard: s.pensionStandard }));
    this.suggestion.set(s);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    let input = this.form();
    // 事業所を選んでいなければ、デフォルトの事業所にする
    if (!input.officeId) input = { ...input, officeId: defaultOfficeId(this.offices()) };
    this.form.set(input);
    const errors = validateNewEmployee(
      input,
      this.employees().map((e) => e.employeeNumber),
    );
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.saving.set(true);
    try {
      await this.employeeRepo.create(input, today());
      this.notice.set(`${input.name.trim()}さんを登録しました。`);
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.errors.set({ employeeNumber: '登録できませんでした。権限と通信を確かめてください。' });
    } finally {
      this.saving.set(false);
    }
  }
}
