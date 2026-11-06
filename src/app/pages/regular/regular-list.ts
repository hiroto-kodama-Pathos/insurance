// 定時決定の見込み（設計書 2.13.1・3.7）
// 7月に4〜6月の給与から見込みを一覧にし、算定基礎届を書くときにそのまま書き写せるようにする。
// 一覧はあくまで見込み。「見込みどおり登録」や一括登録をするまで、標準報酬月額も保険料も変わらない。
import { PageState } from '../../core/ui/page-state';
import { Confirm } from '../../core/ui/confirm';
import { matchesRegularStatus, REGULAR_STATUS_LABEL, RegularStatusFilter } from '../../core/calc/regular';
import { distinctOptions, matchesPerson } from '../../core/calc/person-search';
import { findOffice, Office } from '../../core/calc/office';
import { NoticeMessage } from '../../core/ui/notice-message';
import { BonusRecord } from '../../core/calc/bonus-premium';
import { BonusRepository } from '../../core/repository/bonus-repository';
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
import { cutoffResolver, legacyGroup, PayrollGroup } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { parseNumberInput } from '../../core/calc/half-width';

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
  imports: [RouterLink, NoticeMessage],
  selector: 'app-regular-list',
  styleUrl: './regular-list.scss',
  templateUrl: './regular-list.html',
})
export class RegularList implements OnInit {
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly confirm = inject(Confirm);
  private readonly masterRepo = inject(MasterRepository);
  private readonly salaryRepo = inject(SalaryRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly groups = signal<PayrollGroup[]>([legacyGroup(DEFAULT_SETTINGS)]);
  /** 人と支払月ごとの締め日（その人の支払区分） */
  private readonly cutoff = computed(() => cutoffResolver(this.groups(), this.employees()));

  protected readonly year = signal(defaultRegularYear(today()));
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);

  private readonly employees = signal<EmployeeRecord[]>([]);
  private readonly salaries = signal<SalaryRecord[]>([]);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly thresholds = signal<GradeThreshold[]>([]);
  /** 前年7月〜当年6月に支払った賞与（年4回以上支給する賞与の上乗せに使う） */
  private readonly bonuses = signal<BonusRecord[]>([]);
  private readonly bonusRepo = inject(BonusRepository);

  protected readonly rows = computed<Row[]>(() => {
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return estimateRegularAll(this.employees(), this.salaries(), this.grades(), this.thresholds(), this.year(), this.cutoff(), this.bonuses())
      .map((r) => ({ ...r, employee: byId.get(r.employeeId)! }))
      .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  });
  // ---- 絞り込み（設計書 3.7） ----
  private readonly offices = signal<Office[]>([]);
  protected readonly query = signal('');
  protected readonly officeFilter = signal('');
  protected readonly statusFilter = signal<RegularStatusFilter>('');

  /** 一覧の絞り込み・対象月を覚え、詳細から戻ってきたときに元に戻す（core/ui/page-state.ts） */
  private readonly pageStateKept = ((pageState: PageState) => {
    pageState.keep('regular.year', this.year);
    pageState.keep('regular.query', this.query);
    pageState.keep('regular.officeFilter', this.officeFilter);
    pageState.keep('regular.statusFilter', this.statusFilter);
    return true;
  })(inject(PageState));
  protected readonly statusLabels = REGULAR_STATUS_LABEL;
  protected readonly statusKeys = Object.keys(REGULAR_STATUS_LABEL) as Exclude<RegularStatusFilter, ''>[];
  /** 7月1日に所属している事業所の名前（算定基礎届を出す事業所） */
  protected officeName(r: Row): string {
    try {
      return findOffice(r.employee.assignments, this.offices(), `${this.year()}-07-01`).name;
    } catch {
      return '';
    }
  }
  protected readonly officeOptions = computed(() => distinctOptions(this.rows().map((r) => this.officeName(r))));
  /** 表に出す行（一括登録は、絞り込みに関係なく全員が対象） */
  protected readonly shownRows = computed(() =>
    this.rows().filter(
      (r) =>
        matchesPerson(r.employee.employeeNumber, r.employee.name, this.query()) &&
        (this.officeFilter() === '' || this.officeName(r) === this.officeFilter()) &&
        matchesRegularStatus(r, this.statusFilter()),
    ),
  );

  protected readonly registrable = computed(() => registrableRegular(this.rows()) as Row[]);
  protected readonly registeredCount = computed(() => this.rows().filter((r) => r.registered).length);
  /** 対象外（6月1日以降の資格取得など）で一覧に出ない人数 */
  protected readonly outsideCount = computed(() => this.employees().length - this.rows().length);

  async ngOnInit(): Promise<void> {
    try {
      const [employees, grades, thresholds, groups, masters] = await Promise.all([
        this.employeeRepo.loadAll(),
        this.masterRepo.loadGrades(),
        this.masterRepo.loadGradeThresholds(),
        this.settingsRepo.loadPayrollGroups(),
        this.masterRepo.loadMasters(),
      ]);
      this.offices.set(masters.offices);
      this.groups.set(groups);
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
    const [salaries, bonuses] = await Promise.all([
      this.salaryRepo.loadRange(`${y - 1}-07`, `${y}-09`),
      this.bonusRepo.loadRange(`${y - 1}-07-01`, `${y}-06-30`),
    ]);
    if (y !== this.year()) return;
    this.salaries.set(salaries);
    this.bonuses.set(bonuses);
  }

  protected onYearChange(value: string): void {
    const y = parseNumberInput(value);
    if (y === null || !Number.isInteger(y) || y < 2000) return;
    this.year.set(y);
    this.notice.set(null);
    void this.loadYear();
  }

  /** 通知書待ちとして登録する（決定通知書が給与計算に間に合わないとき） */
  protected readonly provisional = signal(false);

  private input(r: Row) {
    return {
      validFrom: `${r.year}-09`,
      reason: 'regular' as const,
      healthStandard: r.expectedHealth,
      pensionStandard: r.expectedPension,
      provisional: this.provisional(),
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
        const input = this.input(r);
        await this.employeeRepo.addStandard(r.employeeId, input, r.average);
        // 変更の記録（残せなくても、登録はそのまま。設計書 3.1）
        try {
          await this.employeeRepo.addChangeLog(r.employeeId,
            `定時決定で${input.provisional ? '通知書待ちとして' : ''}標準報酬月額を登録（${this.year()}年9月から 健保 ${((input.healthStandard ?? 0) / 10_000).toLocaleString('ja-JP')}万円／厚年 ${((input.pensionStandard ?? 0) / 10_000).toLocaleString('ja-JP')}万円）`);
        } catch (e) {
          console.error('変更の記録を残せませんでした', e);
        }
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

  // ---- 登録の取り消し（設計書 3.7） ----
  // 見込みどおり登録した9月分からの標準報酬月額を、決定通知書と違ったときなどに取り消す。
  // 7〜9月に随時改定がある人の9月分は、随時改定の登録なので取り消さない（行にボタンを出さない）

  /** 取り消せる登録（9月分からの標準報酬月額の履歴） */
  private undoTarget(r: Row): { employeeId: string; standardId: string; log: string } | null {
    if (!r.registered || r.revisionInJulSep) return null;
    const ym = `${this.year()}-09`;
    const s = this.employees().find((e) => e.id === r.employeeId)?.standardHistory.find((h) => h.validFrom === ym) as { id?: string; healthStandard: number; pensionStandard: number } | undefined;
    if (!s?.id) return null;
    const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    return { employeeId: r.employeeId, standardId: s.id, log: `定時決定の登録を取り消しました（${this.year()}年9月からの標準報酬月額 健保 ${man(s.healthStandard)}／厚年 ${man(s.pensionStandard)}を削除）` };
  }

  protected canUndo(r: Row): boolean {
    return this.undoTarget(r) !== null;
  }

  /** 表示している中で、取り消せる登録 */
  protected readonly undoable = computed(() => this.shownRows().filter((r) => this.canUndo(r)));

  protected async undo(list: Row[]): Promise<void> {
    const targets = list.map((r) => this.undoTarget(r)).filter((x): x is NonNullable<typeof x> => x !== null);
    if (targets.length === 0) return;
    const ok = await this.confirm.ask({
      title: '登録を取り消しますか',
      message:
        `${targets.length === 1 ? `${list[0].employee.name}さんの` : `表示している${targets.length}人の`}${this.year()}年9月分からの標準報酬月額の登録を取り消します。` +
        '9月分以降の保険料は、前の標準報酬月額に戻ります。確定済みの月に関わるときは、差額の画面にさかのぼる差額が出ます。',
      ok: `${targets.length}人の登録を取り消す`,
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.employeeRepo.deleteStandards(targets);
      this.notice.set(`${targets.length}人の${this.year()}年9月分からの登録を取り消しました。見込みどおり登録し直すか、従業員の詳細で通知書の値を入れてください。`);
    } catch (e) {
      console.error(e);
      this.notice.set('取り消せませんでした。権限と通信を確かめてください。');
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
