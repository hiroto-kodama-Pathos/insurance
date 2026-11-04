// 設定（管理者だけ）：会社の設定、適用事業所、健康保険組合と料率（設計書 4章 マスタ・companySettings）
// 協会けんぽの料率は、運営者が入れるシステム共通マスタのため表示だけにする
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { FormSnapshot, HasUnsavedChanges } from '../../core/ui/unsaved-guard';
import { RouterLink } from '@angular/router';
import type { Insurer, PensionRate } from '../../core/calc/rate';
import { Office } from '../../core/calc/office';
import {
  checkKumiai,
  checkOffice,
  checkRate,
  checkSettings,
  CompanySettings,
  DEFAULT_SETTINGS,
  Errors,
  KumiaiInput,
  OfficeInput,
  PREFECTURES,
  RATE_TYPE_LABELS,
  RateInput,
  rateToPercent,
} from '../../core/calc/settings';
import { MasterRepository } from '../../core/repository/master-repository';
import { RateRecord, SettingsRepository } from '../../core/repository/settings-repository';
import { checkPayrollGroup, PayrollGroup, PayrollGroupInput } from '../../core/calc/payroll-group';
import { BonusType, BonusTypeInput, checkBonusType } from '../../core/calc/bonus-type';
import { parseNumberInput } from '../../core/calc/half-width';
import { DateLabelPipe, YearMonthPipe } from '../../core/ui/year-month.pipe';
import { yearMonthLabel } from '../../core/calc/year-month';

type Mode =
  | null
  | { kind: 'office'; id: string | null }
  | { kind: 'kumiai'; id: string | null }
  | { kind: 'rate'; id: string | null }
  | { kind: 'payrollGroup'; id: string | null }
  | { kind: 'bonusType'; id: string | null };

const EMPTY_OFFICE: OfficeInput = { name: '', prefecture: '', insurerId: '', isDefault: false };
const EMPTY_KUMIAI: KumiaiInput = { name: '', specialInsuredEnabled: false };
const EMPTY_GROUP: PayrollGroupInput = { name: '', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: false };

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe, DateLabelPipe],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
})
export class Settings implements OnInit, HasUnsavedChanges {
  /** 画面の上の、欄へのジャンプのリンク（設定の画面は長いので、変えたい欄へすぐ移れるようにする） */
  protected readonly sections: { id: string; label: string }[] = [
    { id: 'company', label: '会社の設定' },
    { id: 'groups', label: '給与の支払区分' },
    { id: 'bonus', label: '賞与の種類' },
    { id: 'offices', label: '適用事業所' },
    { id: 'kumiai', label: '健康保険組合と料率' },
    { id: 'rates', label: '協会けんぽ・厚生年金の料率' },
  ];
  protected goTo(id: string): void {
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  private readonly repo = inject(SettingsRepository);
  private readonly masterRepo = inject(MasterRepository);

  protected readonly prefectures = PREFECTURES;
  protected readonly rateTypeLabels = RATE_TYPE_LABELS;
  protected readonly rateTypes = Object.keys(RATE_TYPE_LABELS) as RateInput['rateType'][];
  protected readonly toPercent = rateToPercent;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly errors = signal<Errors>({});

  protected readonly offices = signal<Office[]>([]);
  protected readonly insurers = signal<Insurer[]>([]);
  protected readonly rates = signal<RateRecord[]>([]);
  protected readonly payrollGroups = signal<PayrollGroup[]>([]);
  protected readonly groupForm = signal<PayrollGroupInput>(EMPTY_GROUP);
  protected readonly bonusTypes = signal<BonusType[]>([]);
  protected readonly bonusTypeForm = signal<BonusTypeInput>({ name: '', isRemuneration: false, validFrom: '' });
  protected readonly days = Array.from({ length: 30 }, (_, i) => i + 1);

  // 会社の設定
  protected readonly settings = signal<CompanySettings>(DEFAULT_SETTINGS);
  protected readonly settingsErrors = signal<Errors>({});

  // 追加・変更のフォーム
  protected readonly mode = signal<Mode>(null);
  protected readonly officeForm = signal<OfficeInput>(EMPTY_OFFICE);
  protected readonly kumiaiForm = signal<KumiaiInput>(EMPTY_KUMIAI);
  protected readonly rateForm = signal<RateInput>({ insurerId: '', rateType: 'health', validFrom: '', rate: '', employeeRate: '' });

  protected readonly kumiais = computed(() => this.insurers().filter((i) => i.type === 'kumiai'));
  protected readonly kyokaiId = computed(() => this.insurers().find((i) => i.type === 'kyokai')?.id ?? null);

  /** 組合健保ごとの料率（新しい順） */
  protected readonly kumiaiRates = computed(() =>
    this.kumiais().map((k) => ({
      insurer: k,
      rates: this.rates()
        .filter((r) => r.insurerId === k.id)
        .sort((a, b) => a.rateType.localeCompare(b.rateType) || b.validFrom.localeCompare(a.validFrom)),
    })),
  );

  /** 協会けんぽの料率のうち、登録した事業所の都道府県と全国一律のもの（表示だけ） */
  protected readonly kyokaiRates = computed(() => {
    const id = this.kyokaiId();
    const prefs = new Set(this.offices().filter((o) => o.insurerId === id).map((o) => o.prefecture));
    return this.rates()
      .filter((r) => r.insurerId === id && (r.prefecture === null || prefs.has(r.prefecture)))
      .sort(
        (a, b) =>
          a.rateType.localeCompare(b.rateType) ||
          (a.prefecture ?? '').localeCompare(b.prefecture ?? '') ||
          b.validFrom.localeCompare(a.validFrom),
      );
  });

  /** 厚生年金の料率（全国一律。システム共通マスタ pensionRates。表示だけ） */
  protected readonly pensionRates = signal<PensionRate[]>([]);

  /** 参照用の料率の表：協会けんぽの料率に、厚生年金の料率を加える（新しい適用開始月が上） */
  protected readonly referenceRates = computed(() => [
    ...this.kyokaiRates().map((r) => ({ id: r.id, label: RATE_TYPE_LABELS[r.rateType], prefecture: r.prefecture, validFrom: r.validFrom, rate: r.rate, employeeShare: r.employeeShare })),
    ...[...this.pensionRates()]
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
      .map((r) => ({ id: `pension-${r.validFrom}`, label: '厚生年金', prefecture: null, validFrom: r.validFrom, rate: r.rate, employeeShare: r.employeeShare })),
  ]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [masters, rates, settings, groups] = await Promise.all([
        this.masterRepo.loadMasters(),
        this.repo.loadRates(),
        this.repo.loadSettings(),
        this.repo.loadPayrollGroupRecords(),
      ]);
      this.bonusTypes.set(await this.repo.loadBonusTypes());
      this.payrollGroups.set(groups);
      this.offices.set(masters.offices);
      this.insurers.set(masters.insurers);
      this.pensionRates.set(masters.pensionRates);
      this.rates.set(rates);
      this.settings.set(settings);
      this.settingsSnapshot.takeNow();
    } catch (e) {
      console.error(e);
      this.error.set('データを読み込めませんでした。ログインと権限を確かめてください。');
    } finally {
      this.loading.set(false);
    }
  }

  protected insurerName(id: string): string {
    return this.insurers().find((i) => i.id === id)?.name ?? id;
  }
  protected isKyokai(insurerId: string): boolean {
    return insurerId !== '' && insurerId === this.kyokaiId();
  }
  protected shareLabel(share: number): string {
    return share === 500 ? '折半' : `本人 ${share / 10}%`;
  }
  protected dayLabel(v: number | 'end'): string {
    return v === 'end' ? '末日' : `${v}日`;
  }

  // ---- 給与の支払区分 ----
  protected openPayrollGroup(g: PayrollGroup | null): void {
    this.groupForm.set(g ? { name: g.name, cutoffDay: g.cutoffDay, paidIn: g.paidIn, deductionTiming: g.deductionTiming, payDay: g.payDay, isDefault: g.isDefault ?? false } : { ...EMPTY_GROUP, isDefault: this.payrollGroups().length === 0 });
    this.openMode({ kind: 'payrollGroup', id: g?.id ?? null });
  }
  protected setGroup<K extends keyof PayrollGroupInput>(key: K, value: PayrollGroupInput[K]): void {
    this.groupForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setGroupDay(key: 'cutoffDay' | 'payDay', value: string): void {
    this.groupForm.update((f) => ({ ...f, [key]: value === 'end' ? 'end' : Number(value) }));
  }
  protected async savePayrollGroup(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    const id = m?.kind === 'payrollGroup' ? m.id : null;
    const f = this.groupForm();
    const errors = checkPayrollGroup(f, this.payrollGroups().filter((g) => g.id !== id).map((g) => g.name));
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    // 最初の区分は既定にする（既定の区分がないと、区分を割り当てていない人の区分が決まらないため）
    const input = { ...f, isDefault: f.isDefault || !this.payrollGroups().some((g) => g.isDefault && g.id !== id) };
    await this.run(() => this.repo.savePayrollGroup(id, input, this.payrollGroups()), `支払区分「${f.name.trim()}」を保存しました。`);
  }

  protected openBonusType(t: BonusType | null): void {
    const thisYm = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
    this.bonusTypeForm.set(t ? { name: t.name, isRemuneration: t.isRemuneration, validFrom: t.validFrom } : { name: '', isRemuneration: false, validFrom: thisYm });
    this.openMode({ kind: 'bonusType', id: t?.id ?? null });
  }
  protected setBonusType<K extends keyof BonusTypeInput>(key: K, value: BonusTypeInput[K]): void {
    this.bonusTypeForm.update((f) => ({ ...f, [key]: value }));
  }
  protected async saveBonusType(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    const id = m?.kind === 'bonusType' ? m.id : null;
    const f = this.bonusTypeForm();
    const errors = checkBonusType(f, this.bonusTypes().filter((t) => t.id !== id).map((t) => t.name));
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(() => this.repo.saveBonusType(id, f), `賞与の種類「${f.name.trim()}」を保存しました。`);
  }

  protected isEditing(kind: 'office' | 'kumiai' | 'rate', id: string | null): boolean {
    const m = this.mode();
    return m !== null && m.kind === kind && m.id === id;
  }

  // ---- 会社の設定 ----
  protected setFullTime(key: 'fullTimeWeeklyHours' | 'fullTimeMonthlyDays', v: string): void {
    this.settings.update((s) => ({ ...s, [key]: parseNumberInput(v) ?? NaN }));
  }

  protected setRounding(v: string): void {
    this.settings.update((s) => ({ ...s, childSupportRounding: v as CompanySettings['childSupportRounding'] }));
  }
  protected setTiming(v: string): void {
    this.settings.update((s) => ({ ...s, deductionTiming: v as CompanySettings['deductionTiming'] }));
  }
  protected setCutoffDay(v: string): void {
    this.settings.update((s) => ({ ...s, payrollCutoff: { ...s.payrollCutoff, day: v === 'end' ? 'end' : Number(v) } }));
  }
  protected setPaidIn(v: string): void {
    this.settings.update((s) => ({
      ...s,
      payrollCutoff: { ...s.payrollCutoff, paidIn: v as CompanySettings['payrollCutoff']['paidIn'] },
    }));
  }
  protected async saveSettings(event: Event): Promise<void> {
    event.preventDefault();
    const errors = checkSettings(this.settings());
    this.settingsErrors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(() => this.repo.saveSettings(this.settings()), '会社の設定を保存しました。');
  }

  // ---- フォームを開く ----
  protected openOffice(o: Office | null): void {
    this.officeForm.set(
      o ? { name: o.name, prefecture: o.prefecture, insurerId: o.insurerId, isDefault: o.isDefault ?? false } : EMPTY_OFFICE,
    );
    this.openMode({ kind: 'office', id: o?.id ?? null });
  }
  protected openKumiai(k: Insurer | null): void {
    this.kumiaiForm.set(k ? { name: k.name, specialInsuredEnabled: k.specialInsuredEnabled ?? false } : EMPTY_KUMIAI);
    this.openMode({ kind: 'kumiai', id: k?.id ?? null });
  }
  /** 料率の追加（insurerId を指定）または変更（rate を指定） */
  protected openRate(insurerId: string, r: RateRecord | null): void {
    this.rateForm.set(
      r
        ? {
            insurerId: r.insurerId,
            rateType: r.rateType,
            validFrom: r.validFrom,
            rate: rateToPercent(r.rate),
            employeeRate: r.employeeShare === 500 ? '' : rateToPercent((r.rate * r.employeeShare) / 1000),
          }
        : { insurerId, rateType: 'health', validFrom: '', rate: '', employeeRate: '' },
    );
    this.openMode({ kind: 'rate', id: r?.id ?? null });
  }
  private openMode(m: Mode): void {
    this.errors.set({});
    this.notice.set(null);
    this.mode.set(m);
    this.formSnapshot.take();
  }
  protected cancel(): void {
    this.mode.set(null);
  }

  /** 会社の設定（読み込んだとき・保存したときの値と比べる） */
  private readonly settingsSnapshot = new FormSnapshot(() => this.settings());
  /** 追加・変更のフォーム（開いたときの値と比べる） */
  private readonly formSnapshot = new FormSnapshot(() => [this.groupForm(), this.bonusTypeForm(), this.officeForm(), this.kumiaiForm(), this.rateForm()]);
  /** 画面を移る前の確認に使う（unsavedChangesGuard）。会社の設定・開いているフォームのうち、変えたものの数 */
  unsavedCount(): number {
    return (this.settingsSnapshot.changed() ? 1 : 0) + (this.mode() !== null && this.formSnapshot.changed() ? 1 : 0);
  }
  /** ブラウザのタブを閉じる・再読み込みするときも確かめる */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.unsavedCount() > 0) e.preventDefault();
  }


  protected setOffice<K extends keyof OfficeInput>(key: K, value: OfficeInput[K]): void {
    this.officeForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setKumiai<K extends keyof KumiaiInput>(key: K, value: KumiaiInput[K]): void {
    this.kumiaiForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setRate<K extends keyof RateInput>(key: K, value: RateInput[K]): void {
    this.rateForm.update((f) => ({ ...f, [key]: value }));
  }

  // ---- 保存 ----
  protected async saveOffice(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    if (m?.kind !== 'office') return;
    const f = this.officeForm();
    const others = this.offices().filter((o) => o.id !== m.id);
    const errors = checkOffice(f, this.insurers(), others);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(() => this.repo.saveOffice(m.id, f, this.offices()), `${f.name.trim()}を保存しました。`);
  }

  protected async saveKumiai(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    if (m?.kind !== 'kumiai') return;
    const f = this.kumiaiForm();
    const errors = checkKumiai(f, this.insurers().filter((i) => i.id !== m.id));
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(() => this.repo.saveKumiai(m.id, f), `${f.name.trim()}を保存しました。`);
  }

  protected async saveRate(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    if (m?.kind !== 'rate') return;
    const f = this.rateForm();
    const others = this.rates().filter((r) => r.insurerId === f.insurerId && r.id !== m.id);
    const { errors, value } = checkRate(f, others);
    this.errors.set(errors);
    if (!value) return;
    await this.run(
      () => this.repo.saveRate(m.id, value),
      `${this.insurerName(f.insurerId)}の${RATE_TYPE_LABELS[f.rateType]}（${yearMonthLabel(f.validFrom)}分から）を保存しました。`,
    );
  }

  private async run(action: () => Promise<void>, message: string): Promise<void> {
    this.saving.set(true);
    try {
      await action();
      this.mode.set(null);
      this.notice.set(message);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.errors.set({ form: '保存できませんでした。権限と通信を確かめてください。' });
      this.notice.set(null);
    } finally {
      this.saving.set(false);
    }
  }
}
