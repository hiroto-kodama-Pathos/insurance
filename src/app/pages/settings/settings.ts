// 設定（管理者だけ）：会社の設定、適用事業所、健康保険組合と料率（設計書 4章 マスタ・companySettings）
// 協会けんぽの料率は、運営者が入れるシステム共通マスタのため表示だけにする
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import type { Insurer } from '../../core/calc/rate';
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

type Mode =
  | null
  | { kind: 'office'; id: string | null }
  | { kind: 'kumiai'; id: string | null }
  | { kind: 'rate'; id: string | null };

const EMPTY_OFFICE: OfficeInput = { name: '', prefecture: '', insurerId: '', isDefault: false };
const EMPTY_KUMIAI: KumiaiInput = { name: '', specialInsuredEnabled: false };

@Component({
  imports: [],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
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

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [masters, rates, settings] = await Promise.all([
        this.masterRepo.loadMasters(),
        this.repo.loadRates(),
        this.repo.loadSettings(),
      ]);
      this.offices.set(masters.offices);
      this.insurers.set(masters.insurers);
      this.rates.set(rates);
      this.settings.set(settings);
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
  protected isEditing(kind: 'office' | 'kumiai' | 'rate', id: string | null): boolean {
    const m = this.mode();
    return m !== null && m.kind === kind && m.id === id;
  }

  // ---- 会社の設定 ----
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
  }
  protected cancel(): void {
    this.mode.set(null);
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
      `${this.insurerName(f.insurerId)}の${RATE_TYPE_LABELS[f.rateType]}（${f.validFrom}分から）を保存しました。`,
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
