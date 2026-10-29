// 従業員の詳細（設計書 3.1）：資格・所属事業所・標準報酬月額・休業の履歴と、保険料の推移
import { isValidDate } from '../../../core/calc/new-employee';
import { INSURED_TYPE_LABEL, InsuredType, insuredTypeAt } from '../../../core/calc/insured-type';
import { checkDependent, checkRemoval, dependentReportDeadline, DependentInput } from '../../../core/calc/dependent';
import {
  checkExemption,
  EXEMPTION_DATE_HINT,
  EXEMPTION_LABEL,
  EXEMPTION_TARGETS,
  ExemptionInput,
  exemptionNote,
  exemptionNotice,
  ExemptionType,
} from '../../../core/calc/exemption';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { monthOf } from '../../../core/calc/date';
import {
  checkLeave,
  checkLoss,
  checkReacquire,
  checkRetirement,
  checkStandard,
  checkTransfer,
  Errors,
  LeaveInput,
  openQualification,
  StandardInput,
} from '../../../core/calc/employee-edit';
import { calcEmployeeMonth, EmployeeMonthResult, findEffective, Masters } from '../../../core/calc/employee-month';
import { GradeRow, suggestStandards } from '../../../core/calc/grade-suggest';
import { senToDisplayYen } from '../../../core/calc/premium-calculator';
import { EmployeeDetail as Detail, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { ChildSupportRounding } from '../../../core/calc/monthly-premium';

type Mode =
  | null | 'retire' | 'loss' | 'reacquire' | 'transfer' | 'standard' | 'leave' | 'insuredType' | 'exemption' | 'exemptionEnd'
  | 'dependent' | 'dependentRemove' | { leaveId: string };

export const LOST_REASONS: Record<string, string> = {
  retirement: '退職',
  conditions: '加入の条件から外れた（労働時間の短縮など）',
  age75: '75歳到達',
  death: '死亡',
  reemployment: '退職後の継続再雇用',
  other: 'その他',
};

export const STANDARD_REASONS: Record<StandardInput['reason'], string> = {
  acquisition: '資格取得時決定',
  regular: '定時決定',
  revision: '随時改定',
  leaveEnd: '休業終了時改定',
};

/** 今日（日本時間）'YYYY-MM-DD' */
function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

/** 'YYYY-MM' の n か月前 */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function toAmount(value: string): number | null {
  const n = value.replace(/[,\s円]/g, '');
  return n === '' ? null : Number(n);
}

@Component({
  imports: [RouterLink],
  selector: 'app-employee-detail',
  styleUrl: './employee-detail.scss',
  templateUrl: './employee-detail.html',
})
export class EmployeeDetail implements OnInit {
  private readonly repo = inject(EmployeeRepository);
  private readonly masterRepo = inject(MasterRepository);
  private readonly settingsRepo = inject(SettingsRepository);
  private readonly route = inject(ActivatedRoute);

  protected readonly lostReasons = LOST_REASONS;
  protected readonly lostReasonKeys = Object.keys(LOST_REASONS).filter((k) => k !== 'retirement');
  protected readonly standardReasons = STANDARD_REASONS;
  protected readonly standardReasonKeys = Object.keys(STANDARD_REASONS) as StandardInput['reason'][];
  protected readonly insuredTypeLabel = INSURED_TYPE_LABEL;
  protected readonly insuredTypeKeys = Object.keys(INSURED_TYPE_LABEL) as InsuredType[];
  protected readonly insuredType = signal<InsuredType>('general');
  protected readonly exemptionLabel = EXEMPTION_LABEL;
  protected readonly exemptionTargets = EXEMPTION_TARGETS;
  protected readonly exemptionHint = EXEMPTION_DATE_HINT;
  protected readonly exemptionTypes = Object.keys(EXEMPTION_LABEL) as ExemptionType[];
  protected readonly exemptionForm = signal<ExemptionInput>({ type: 'care', startDate: '', endDate: '' });
  /** 非該当年月日を入れる適用除外のID */
  protected readonly editingExemptionId = signal<string | null>(null);
  protected readonly exemptionNotice = exemptionNotice;
  protected readonly dependentForm = signal<DependentInput>({ name: '', birthDate: '', certifiedDate: '' });
  protected readonly editingDependentId = signal<string | null>(null);
  protected readonly dependentDeadline = dependentReportDeadline;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly masters = signal<Masters | null>(null);
  private readonly grades = signal<GradeRow[]>([]);
  private readonly rounding = signal<ChildSupportRounding>('combined');

  protected readonly mode = signal<Mode>(null);
  protected readonly errors = signal<Errors>({});
  protected readonly saving = signal(false);
  protected readonly notice = signal<string | null>(null);

  // 入力欄
  protected readonly date = signal('');
  protected readonly reason = signal('');
  protected readonly officeId = signal('');
  protected readonly standardForm = signal<StandardInput>({
    validFrom: '',
    reason: 'revision',
    healthStandard: null,
    pensionStandard: null,
  });
  protected readonly remuneration = signal<number | null>(null);
  /** 標準報酬月額の追加で、二以上事業所勤務の項目を出すか */
  protected readonly multiOffice = signal(false);
  protected readonly leaveForm = signal<LeaveInput>({ type: 'childcare', startDate: '', endDate: '', workedDays: null });

  protected readonly sortedQualifications = computed(() =>
    [...(this.detail()?.qualifications ?? [])].sort((a, b) => b.acquiredDate.localeCompare(a.acquiredDate)),
  );
  protected readonly sortedAssignments = computed(() =>
    [...(this.detail()?.assignments ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  protected readonly sortedStandards = computed(() =>
    [...(this.detail()?.standardHistory ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  protected readonly sortedLeaves = computed(() =>
    [...(this.detail()?.leaves ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  );
  protected readonly sortedDependents = computed(() =>
    [...(this.detail()?.dependents ?? [])].sort((a, b) => b.certifiedDate.localeCompare(a.certifiedDate)),
  );
  protected readonly sortedExemptions = computed(() =>
    [...(this.detail()?.exemptions ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  );
  protected readonly sortedInsuredTypes = computed(() =>
    [...(this.detail()?.insuredTypes ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
  );
  /** 今日の被保険者区分 */
  protected readonly currentInsuredType = computed(() => insuredTypeAt(this.detail()?.insuredTypes, today()));
  protected readonly isInsuredNow = computed(() => openQualification(this.detail()?.qualifications ?? []) !== null);

  /** 直近12か月の保険料（問い合わせの対応用） */
  protected readonly history = computed<EmployeeMonthResult[]>(() => {
    const d = this.detail();
    const m = this.masters();
    if (!d || !m) return [];
    const now = monthOf(today());
    return Array.from({ length: 12 }, (_, i) => calcEmployeeMonth(d, m, addMonths(now, -i), this.rounding()));
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      const [detail, masters, grades, settings] = await Promise.all([
        this.repo.loadDetail(id),
        this.masterRepo.loadMasters(),
        this.masterRepo.loadGrades(),
        this.settingsRepo.loadSettings(),
      ]);
      this.rounding.set(settings.childSupportRounding);
      if (!detail) this.error.set('この従業員は見つかりませんでした。');
      this.detail.set(detail);
      this.masters.set(masters);
      this.grades.set(grades);
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  // ---- 表示用 ----
  protected officeName(id: string): string {
    return this.masters()?.offices.find((o) => o.id === id)?.name ?? id;
  }
  protected man(v: number): string {
    return `${(v / 10_000).toLocaleString('ja-JP')}万円`;
  }
  protected yen(v: bigint | null | undefined): string {
    return v === null || v === undefined ? '' : v.toLocaleString('ja-JP');
  }
  protected employeeTotal(r: EmployeeMonthResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen([p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x?.employeeYen ?? 0n), 0n));
  }
  protected employerTotal(r: EmployeeMonthResult): string {
    const p = r.premium;
    if (!p) return '';
    return this.yen(
      [p.health, p.care, p.childSupport, p.pension].reduce((s, x) => s + (x ? senToDisplayYen(x.employerSen) : 0n), 0n),
    );
  }
  /** 二以上事業所勤務の按分の表示（自社 20万円／合計 30万円） */
  protected multiLabel(s: { ownRemuneration?: number | null; totalRemuneration?: number | null; selectedInsurerId?: string | null }): string {
    if (!s.ownRemuneration || !s.totalRemuneration) return '';
    const man = (v: number) => `${(v / 10_000).toLocaleString('ja-JP')}万円`;
    const insurer = this.masters()?.insurers.find((i) => i.id === s.selectedInsurerId)?.name ?? '';
    return `自社 ${man(s.ownRemuneration)}／合計 ${man(s.totalRemuneration)}${insurer ? `（${insurer}）` : ''}`;
  }
  protected historyNote(r: EmployeeMonthResult): string {
    if (r.status === 'notInsured') return '資格なし';
    if (r.status === 'missingRate') return '料率が未登録';
    if (r.status === 'noStandard') return '標準報酬月額が未登録';
    if (r.premium?.exempt) return '休業免除';
    const notes = [exemptionNote(this.detail()?.exemptions ?? [], r.yearMonth)];
    if (r.premium?.careLabel === 'special') notes.push('特定被保険者（40〜64歳の被扶養者あり）');
    return notes.filter((n) => n).join('、');
  }
  protected isLeaveEdit(id: string): boolean {
    const m = this.mode();
    return typeof m === 'object' && m !== null && m.leaveId === id;
  }

  // ---- 入力 ----
  protected open(mode: Exclude<Mode, null>): void {
    this.errors.set({});
    this.notice.set(null);
    this.date.set('');
    this.reason.set('');
    this.officeId.set('');
    this.remuneration.set(null);
    const d = this.detail();
    const latest = d ? findEffective(d.standardHistory, '9999-12') : null;
    if (mode === 'standard' || mode === 'transfer') {
      this.standardForm.set({
        validFrom: monthOf(today()),
        reason: 'revision',
        healthStandard: latest?.healthStandard ?? null,
        pensionStandard: latest?.pensionStandard ?? null,
        // 二以上事業所勤務の人は、前の値を初期値にする
        ownRemuneration: latest?.ownRemuneration ?? null,
        totalRemuneration: latest?.totalRemuneration ?? null,
        selectedInsurerId: latest?.selectedInsurerId ?? null,
      });
      this.multiOffice.set(!!(latest?.ownRemuneration && latest?.totalRemuneration));
    }
    if (mode === 'insuredType') this.insuredType.set(this.currentInsuredType());
    if (mode === 'dependent') this.dependentForm.set({ name: '', birthDate: '', certifiedDate: '' });
    if (mode === 'exemption') this.exemptionForm.set({ type: 'care', startDate: '', endDate: '' });
    if (mode === 'leave') this.leaveForm.set({ type: 'childcare', startDate: '', endDate: '', workedDays: null });
    if (typeof mode === 'object') {
      const l = d?.leaves.find((x) => x.id === mode.leaveId);
      if (l) this.leaveForm.set({ type: l.type, startDate: l.startDate, endDate: l.endDate ?? '', workedDays: l.workedDays ?? null });
    }
    this.mode.set(mode);
    // 入力欄は画面の上に開くので、下の表のボタンから開いたときも見えるところまで動かす
    setTimeout(() => {
      const form = document.querySelector('app-employee-detail form.form') as (HTMLElement & { scrollIntoView?: unknown }) | null;
      if (form && typeof form.scrollIntoView === 'function') form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  /** 資格を失う日に扶養から外れる被扶養者（まだ扶養中の人） */
  private openDependentIds(lostDate: string | null): string[] {
    if (!lostDate) return [];
    return (this.detail()?.dependents ?? []).filter((x) => x.removedDate === null || x.removedDate > lostDate).map((x) => x.id);
  }

  protected openDependentRemove(id: string): void {
    this.open('dependentRemove');
    this.editingDependentId.set(id);
  }

  protected setDependent(key: keyof DependentInput, value: string): void {
    this.dependentForm.update((f) => ({ ...f, [key]: value }));
  }

  protected dependentName(id: string | null): string {
    return this.detail()?.dependents.find((x) => x.id === id)?.name ?? '';
  }

  /** 適用除外の非該当年月日を入れる */
  protected openExemptionEnd(id: string): void {
    const x = this.detail()?.exemptions.find((e) => e.id === id);
    if (!x) return;
    this.open('exemptionEnd');
    this.editingExemptionId.set(id);
    this.exemptionForm.set({ type: x.type, startDate: x.startDate, endDate: x.endDate ?? '' });
  }

  protected setExemption(key: keyof ExemptionInput, value: string): void {
    this.exemptionForm.update((f) => ({ ...f, [key]: value }));
  }

  protected cancel(): void {
    this.mode.set(null);
  }
  protected setStandard(key: 'healthStandard' | 'pensionStandard', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: toAmount(value) }));
  }
  protected setMultiAmount(key: 'ownRemuneration' | 'totalRemuneration', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: toAmount(value) }));
  }
  protected setSelectedInsurer(value: string): void {
    this.standardForm.update((f) => ({ ...f, selectedInsurerId: value || null }));
  }
  protected setStandardText(key: 'validFrom' | 'reason', value: string): void {
    this.standardForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setRemuneration(value: string): void {
    this.remuneration.set(toAmount(value));
  }
  protected setLeave(key: 'type' | 'startDate' | 'endDate', value: string): void {
    this.leaveForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setWorkedDays(value: string): void {
    this.leaveForm.update((f) => ({ ...f, workedDays: value === '' ? null : Number(value) }));
  }

  /** 報酬月額から標準報酬月額を入れる */
  protected suggest(): void {
    const d = this.detail();
    const r = this.remuneration();
    const ym = this.standardForm().validFrom || monthOf(today());
    if (!d || r === null || !(r > 0)) {
      this.errors.set({ remuneration: '先に報酬月額を入力してください' });
      return;
    }
    const s = suggestStandards(r, this.grades(), ym, d.birthDate);
    if (!s) {
      this.errors.set({ remuneration: 'この月に使える等級表が登録されていません' });
      return;
    }
    this.errors.set({});
    this.standardForm.update((f) => ({ ...f, healthStandard: s.healthStandard, pensionStandard: s.pensionStandard }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const d = this.detail();
    const mode = this.mode();
    if (!d || mode === null) return;
    const open = d.qualifications.find((q) => q.lostDate === null);

    let errors: Errors = {};
    let action: (() => Promise<void>) | null = null;
    let message = '';

    if (mode === 'retire') {
      const r = checkRetirement(d.qualifications, this.date());
      errors = r.errors;
      const deps = this.openDependentIds(r.lostDate);
      action = () => this.repo.closeQualification(d.id, open!.id, r.lostDate!, 'retirement', deps);
      message = `退職を登録しました（資格喪失日 ${r.lostDate}）。${deps.length ? `被扶養者${deps.length}人も同じ日に扶養から外れます。` : ''}`;
    } else if (mode === 'loss') {
      errors = checkLoss(d.qualifications, this.date(), this.reason());
      const deps = this.openDependentIds(this.date());
      action = () => this.repo.closeQualification(d.id, open!.id, this.date(), this.reason(), deps);
      message = `資格の喪失を登録しました。${deps.length ? `被扶養者${deps.length}人も同じ日に扶養から外れます。` : ''}`;
    } else if (mode === 'reacquire') {
      errors = checkReacquire(d.qualifications, this.date());
      action = () => this.repo.addQualification(d.id, this.date());
      message = '再加入を登録しました。標準報酬月額の履歴も追加してください。';
    } else if (mode === 'transfer') {
      const f = this.standardForm();
      errors = {
        ...checkTransfer(d.assignments, this.date(), this.officeId()),
        ...checkStandard(
          d.standardHistory.map((s) => s.validFrom),
          { ...f, validFrom: this.date() ? monthOf(this.date()) : '' },
        ),
      };
      action = () =>
        this.repo.addTransfer(d.id, this.date(), this.officeId(), {
          healthStandard: f.healthStandard!,
          pensionStandard: f.pensionStandard!,
        });
      message = `${this.officeName(this.officeId())}への異動を登録しました。`;
    } else if (mode === 'standard') {
      const raw = this.standardForm();
      // 二以上事業所勤務でなければ、按分の項目は空にする（Firestore に undefined は書けない）
      const f = this.multiOffice()
        ? { ...raw, ownRemuneration: raw.ownRemuneration ?? null, totalRemuneration: raw.totalRemuneration ?? null, selectedInsurerId: raw.selectedInsurerId ?? null }
        : { ...raw, ownRemuneration: null, totalRemuneration: null, selectedInsurerId: null };
      errors = checkStandard(d.standardHistory.map((s) => s.validFrom), f);
      action = () => this.repo.addStandard(d.id, f, this.remuneration());
      message = `${f.validFrom}分からの標準報酬月額を登録しました。`;
    } else if (mode === 'dependent') {
      const f = this.dependentForm();
      errors = checkDependent(f);
      action = () => this.repo.addDependent(d.id, f);
      message = `被扶養者（${f.name.trim()}さん）を登録しました。被扶養者異動届：${dependentReportDeadline(f.certifiedDate)}まで（5日以内）`;
    } else if (mode === 'dependentRemove') {
      const id = this.editingDependentId()!;
      const dep = d.dependents.find((x) => x.id === id)!;
      errors = checkRemoval(dep, this.date());
      action = () => this.repo.removeDependent(d.id, id, this.date());
      message = `${dep.name}さんを${this.date()}に扶養から外しました。被扶養者異動届：${dependentReportDeadline(this.date())}まで（5日以内）`;
    } else if (mode === 'exemption') {
      const f = this.exemptionForm();
      errors = checkExemption(d.exemptions, f);
      action = () => this.repo.addExemption(d.id, f);
      const n = exemptionNotice(f.type, f.startDate);
      message = `適用除外（${EXEMPTION_LABEL[f.type]}）を登録しました。${n.name}：${n.deadline}`;
    } else if (mode === 'exemptionEnd') {
      const f = this.exemptionForm();
      const id = this.editingExemptionId()!;
      errors = checkExemption(d.exemptions, f, id);
      action = () => this.repo.updateExemptionEnd(d.id, id, f.endDate);
      message = f.endDate ? `適用除外の非該当年月日（${f.endDate}）を登録しました。` : '適用除外の非該当年月日を消しました。';
    } else if (mode === 'insuredType') {
      const t = this.insuredType();
      const date = this.date();
      if (!isValidDate(date)) errors = { insuredTypeDate: '変わった日を正しく入力してください' };
      else if (d.insuredTypes.some((x) => x.validFrom === date)) errors = { insuredTypeDate: 'この日からの区分はすでに登録されています' };
      else if (t === insuredTypeAt(d.insuredTypes, date)) errors = { insuredTypeDate: 'この日の区分と同じです' };
      action = () => this.repo.addInsuredType(d.id, { validFrom: date, type: t });
      message = `${date}から${INSURED_TYPE_LABEL[t]}に変えました。`;
    } else if (mode === 'leave') {
      const f = this.leaveForm();
      errors = checkLeave(f);
      action = () => this.repo.addLeave(d.id, f);
      message = '休業を登録しました。';
    } else {
      const f = this.leaveForm();
      errors = checkLeave(f);
      action = () => this.repo.updateLeave(d.id, mode.leaveId, f.endDate, f.workedDays);
      message = '休業の期間を変更しました。';
    }

    this.errors.set(errors);
    if (Object.keys(errors).length > 0 || !action) return;
    this.saving.set(true);
    try {
      await action();
      this.mode.set(null);
      this.notice.set(message);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.errors.set({ form: '保存できませんでした。権限と通信を確かめてください。' });
    } finally {
      this.saving.set(false);
    }
  }
}
