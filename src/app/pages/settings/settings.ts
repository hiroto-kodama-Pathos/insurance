// 設定（管理者だけ）：会社の設定、適用事業所、健康保険組合と料率（設計書 4章 マスタ・companySettings）
// 協会けんぽの料率は、運営者が入れるシステム共通マスタのため表示だけにする
import { UsablePipe } from '../../core/ui/usable.pipe';
import { focusFormSoon } from '../../core/ui/form-focus';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { afterDiscardCheck, FormSnapshot, HasUnsavedChanges } from '../../core/ui/unsaved-guard';
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
  checkKumiaiRates,
  EMPTY_KUMIAI_RATES,
  KUMIAI_RATE_TYPES,
  KumiaiInput,
  KumiaiRatesInput,
  OfficeInput,
  RatePair,
  PREFECTURES,
  RATE_TYPE_LABELS,
  RateInput,
  rateToPercent,
} from '../../core/calc/settings';
import { MasterRepository } from '../../core/repository/master-repository';
import { RateRecord, SettingsRepository } from '../../core/repository/settings-repository';
import { checkPayrollGroup, legacyGroup, checkTermsChange, PayrollGroup, PayrollGroupInput, PayrollTermsChange, sameTerms, termsAt, termsLabel, termsOf } from '../../core/calc/payroll-group';
import { addMonths } from '../../core/calc/salary';
import { BonusType, BonusTypeInput, checkBonusType } from '../../core/calc/bonus-type';
import { parseNumberInput } from '../../core/calc/half-width';
import { YearMonthPipe } from '../../core/ui/year-month.pipe';
import { yearMonthLabel } from '../../core/calc/year-month';
import { EmployeeRepository } from '../../core/repository/employee-repository';
import { Confirm } from '../../core/ui/confirm';
import { archiveBlockMessage, currentOfficeUsers, currentPayrollGroupUsers, insurerUsage, inUseMessage, officeChangeError, officeInUse, OfficeUse, officeUsage, officeUseLabel, rateDeleteImpact, rateDeleteMessage } from '../../core/calc/master-usage';
import { ClosingRepository } from '../../core/repository/closing-repository';

type Mode =
  | null
  | { kind: 'office'; id: string | null }
  | { kind: 'kumiai'; id: string | null }
  | { kind: 'rate'; id: string | null }
  | { kind: 'payrollGroup'; id: string | null }
  | { kind: 'termsChange'; id: string }
  | { kind: 'bonusType'; id: string | null };

const EMPTY_OFFICE: OfficeInput = { name: '', prefecture: '', insurerId: '', isDefault: false };
const EMPTY_KUMIAI: KumiaiInput = { name: '', specialInsuredEnabled: false };
const EMPTY_GROUP: PayrollGroupInput = { name: '', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: false };

@Component({
  imports: [RouterLink, NoticeMessage, YearMonthPipe, UsablePipe],
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
  private readonly employeeRepo = inject(EmployeeRepository);
  private readonly confirm = inject(Confirm);
  private readonly closingRepo = inject(ClosingRepository);

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
  /** 「○年○月から変える」の入力（支払区分の制度の変更。設計書 2.10） */
  protected readonly termsForm = signal<PayrollTermsChange>({ validFrom: '', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25 });
  /** 今月（'YYYY-MM'。日本時間） */
  protected readonly thisMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
  /** 区分ごとの、今月の制度と変更の履歴（表に出す） */
  protected readonly groupRows = computed(() =>
    this.payrollGroups().map((g) => {
      const changes = g.changes ?? [];
      const steps = [{ from: null as string | null, terms: termsOf(g) }, ...changes.map((c) => ({ from: c.validFrom as string | null, terms: termsOf(c) }))];
      return {
        group: g,
        now: termsAt(g, this.thisMonth),
        history: changes.length === 0 ? [] : steps.map((s, i) => ({ from: s.from, to: i + 1 < steps.length ? addMonths(steps[i + 1].from!, -1) : null, label: termsLabel(s.terms) })),
      };
    }),
  );
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
  /** 健康保険組合を追加するときに、一緒に登録する料率 */
  protected readonly kumiaiRatesForm = signal<KumiaiRatesInput>(EMPTY_KUMIAI_RATES);
  protected readonly kumiaiRateTypes = KUMIAI_RATE_TYPES;
  protected readonly ratePlaceholder: Record<(typeof KUMIAI_RATE_TYPES)[number], string> = { health: '例：9.5', care: '例：1.6', childSupport: '例：0.23' };

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
  protected openPayrollGroup(g: PayrollGroup | null): void | Promise<void> {
    return this.guard(() => this.openPayrollGroupNow(g));
  }
  private openPayrollGroupNow(g: PayrollGroup | null): void {
    // 最初の区分は、これまでの会社の設定（締め日・支払月・控除する給与）を初期値にする。区分を割り当てていない人は
    // 既定の区分で計算するので、違う値で作ると、その人たちの過去の月の計算まで黙って変わるため
    const first = this.payrollGroups().length === 0;
    const legacy = legacyGroup(this.settings());
    this.groupForm.set(
      g
        ? { name: g.name, cutoffDay: g.cutoffDay, paidIn: g.paidIn, deductionTiming: g.deductionTiming, payDay: g.payDay, isDefault: g.isDefault ?? false }
        : first
          ? { ...EMPTY_GROUP, ...termsOf(legacy), isDefault: true }
          : EMPTY_GROUP,
    );
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
    const before = id ? this.payrollGroups().find((g) => g.id === id) : undefined;
    // 使わないにした区分は初期値にできない（ルールでも拒否する）
    if (before?.archived && f.isDefault) {
      this.notice.set(`給与の支払区分「${before.name}」は使わないにしているため、初期値にできません。先に「使うに戻す」をしてください。`);
      return;
    }
    // 最初の区分を、これまでの会社の設定と違う締め日などで作ると、区分を割り当てていない人の過去の月の計算が変わる
    if (!id && this.payrollGroups().length === 0 && !sameTerms(legacyGroup(this.settings()), f)) {
      const ok = await this.confirm.ask({
        title: '最初の支払区分',
        message:
          `最初の支払区分は、区分を割り当てていない人すべての区分になります。これまでの会社の設定（${termsLabel(termsOf(legacyGroup(this.settings())))}）と違う締め日・支払月・控除する給与にすると、` +
          'その人たちの過去の月の給与の計算期間・控除する月・定時決定と随時改定の判定が変わります（確定済みの月は差額の画面に出ます）。',
        ok: 'この内容で作る',
        cancel: '入力に戻る',
        danger: true,
      });
      if (!ok) return;
    }
    // 「直す」で締め日などを変えると、過去の月の計算も変わる。制度の変更なら「○年○月から変える」を使うよう確かめる
    if (before && !sameTerms(before, f)) {
      const ok = await this.confirm.ask({
        title: '登録の誤りを直す',
        message:
          `「直す」は登録の誤りの訂正で、${before.changes?.length ? `最初の制度（${yearMonthLabel(before.changes[0].validFrom)}分より前）` : 'この区分'}の締め日・支払月・控除する給与を、過去の月までさかのぼって変えます。` +
          'この区分の人の、過去の月の給与の計算期間・控除する月・定時決定と随時改定の判定が変わります（確定済みの月は差額の画面に出ます）。' +
          '会社の制度を変えた（例：来月から15日締めにした）ときは、やめて「○年○月から変える」を使ってください。',
        ok: '直す',
        cancel: '入力に戻る',
        danger: true,
      });
      if (!ok) return;
    }
    // 最初の区分は既定にする（既定の区分がないと、区分を割り当てていない人の区分が決まらないため）
    const input = { ...f, changes: before?.changes ?? [], isDefault: f.isDefault || !this.payrollGroups().some((g) => g.isDefault && g.id !== id) };
    await this.run(() => this.repo.savePayrollGroup(id, input, this.payrollGroups()), `支払区分「${f.name.trim()}」を保存しました。`);
  }

  /** 「○年○月から変える」：変える月は来月を初めにし、制度は今の制度から変えてもらう */
  protected openTermsChange(g: PayrollGroup): void | Promise<void> {
    return this.guard(() => {
      const validFrom = addMonths(this.thisMonth, 1);
      this.termsForm.set({ validFrom, ...termsAt(g, validFrom) });
      this.openMode({ kind: 'termsChange', id: g.id });
    });
  }
  protected setTerms<K extends keyof PayrollTermsChange>(key: K, value: PayrollTermsChange[K]): void {
    this.termsForm.update((f) => ({ ...f, [key]: value }));
  }
  protected setTermsDay(key: 'cutoffDay' | 'payDay', value: string): void {
    this.termsForm.update((f) => ({ ...f, [key]: value === 'end' ? 'end' : Number(value) }));
  }
  /** 変える区分（「○年○月から変える」のフォームを開いているとき） */
  protected readonly termsGroup = computed(() => {
    const m = this.mode();
    return m?.kind === 'termsChange' ? (this.payrollGroups().find((g) => g.id === m.id) ?? null) : null;
  });
  protected async saveTermsChange(event: Event): Promise<void> {
    event.preventDefault();
    const g = this.termsGroup();
    if (!g) return;
    const f = this.termsForm();
    const errors = checkTermsChange(g, f, this.thisMonth);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(
      () => this.repo.savePayrollTermsChanges(g.id, [...(g.changes ?? []), { ...f }]),
      `支払区分「${g.name}」を${yearMonthLabel(f.validFrom)}分から「${termsLabel(f)}」にしました。それより前の月は、これまでの制度のままです。`,
    );
  }

  /** 最後の「○年○月から変える」を取り消す（その月以降も前の制度に戻る） */
  protected async undoTermsChange(g: PayrollGroup): Promise<void> {
    const last = g.changes?.at(-1);
    if (!last) return;
    const prev = termsAt(g, addMonths(last.validFrom, -1));
    const started = last.validFrom <= this.thisMonth;
    const ok = await this.confirm.ask({
      title: '制度の変更を取り消す',
      message:
        `支払区分「${g.name}」の、${yearMonthLabel(last.validFrom)}分からの変更（${termsLabel(last)}）を取り消し、その月以降も「${termsLabel(prev)}」に戻します。` +
        (started
          ? `${yearMonthLabel(last.validFrom)}分〜今月分は、すでにこの制度で計算しています。取り消すと、この区分の人のその月の給与の計算期間・控除する月が変わります（確定済みの月は差額の画面に出ます）。`
          : 'まだ始まっていない変更なので、過去の月の計算は変わりません。'),
      ok: '取り消す',
      danger: started,
    });
    if (!ok) return;
    await this.run(() => this.repo.savePayrollTermsChanges(g.id, (g.changes ?? []).slice(0, -1)), `支払区分「${g.name}」の${yearMonthLabel(last.validFrom)}分からの変更を取り消しました。`);
  }
  /** 「直す」で開いた区分に制度の変更があるか */
  protected readonly groupHasChanges = computed(() => {
    const m = this.mode();
    return m?.kind === 'payrollGroup' && !!m.id && (this.payrollGroups().find((g) => g.id === m.id)?.changes?.length ?? 0) > 0;
  });

  protected openBonusType(t: BonusType | null): void | Promise<void> {
    return this.guard(() => this.openBonusTypeNow(t));
  }
  private openBonusTypeNow(t: BonusType | null): void {
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
    // 使用中の種類（この種類の賞与がある）は、年4回以上支給（報酬扱い）と適用開始月を変えない（設計書 2.4）。
    // 登録済みの賞与は登録したときの設定で計算・届出しているので、変えると種類の設定と過去の賞与が食い違うため。
    // 支給の回数が変わったときは、新しい種類（適用開始月つき）を作ってもらう。名前は変えられる
    const before = id ? this.bonusTypes().find((t) => t.id === id) : undefined;
    if (!errors['isRemuneration'] && before && (before.isRemuneration !== f.isRemuneration || before.validFrom !== f.validFrom)) {
      this.saving.set(true);
      try {
        if (await this.repo.isBonusTypeUsed(before.id))
          errors['isRemuneration'] =
            'この種類の賞与が登録されているため、年4回以上支給の設定と適用開始月は変えられません（登録済みの賞与は登録したときの設定で計算・届出しています）。支給の回数が変わったときは、新しい種類を作り、適用開始月からその種類を選んでください';
      } catch (e) {
        console.error(e);
        errors['isRemuneration'] = 'この種類の賞与が登録されているかを確かめられませんでした。権限と通信を確かめてください';
      } finally {
        this.saving.set(false);
      }
    }
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

  protected setStartDate(v: string): void {
    this.settings.update((s) => ({ ...s, startDate: v === '' ? null : v }));
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
  protected openOffice(o: Office | null): void | Promise<void> {
    return this.guard(() => this.openOfficeNow(o));
  }
  private openOfficeNow(o: Office | null): void {
    this.officeForm.set(
      o ? { name: o.name, prefecture: o.prefecture, insurerId: o.insurerId, isDefault: o.isDefault ?? false } : EMPTY_OFFICE,
    );
    this.openMode({ kind: 'office', id: o?.id ?? null });
    // 変更のときは、使われているかを確かめ終わるまで、保険者・都道府県を変えられないようにしておく
    this.officeUse.set(null);
    this.officeUseState.set(o ? 'loading' : 'ready');
    if (o) {
      this.loadOfficeUse(o.id)
        .then((u) => {
          if (this.mode()?.kind === 'office' && this.mode()?.id === o.id) {
            this.officeUse.set(u);
            this.officeUseState.set('ready');
          }
        })
        .catch((e) => {
          console.error(e);
          this.officeUseState.set('failed');
        });
    }
  }

  // ---- 使用中の適用事業所（設計書 3.10） ----
  /** 変更している事業所の使われ方（追加のときと、確かめている途中は null） */
  protected readonly officeUse = signal<OfficeUse | null>(null);
  /** 使われているかの確かめ：loading（確かめている）・ready・failed（確かめられなかった。変えられないようにする） */
  protected readonly officeUseState = signal<'loading' | 'ready' | 'failed'>('ready');
  /** 保険者・都道府県を変えられない（使用中・確かめている途中・確かめられなかった） */
  protected readonly officeLocked = computed(() => {
    const m = this.mode();
    if (m?.kind !== 'office' || !m.id) return false;
    const state = this.officeUseState();
    if (state !== 'ready') return true;
    const u = this.officeUse();
    return !!u && officeInUse(u);
  });
  /** 変えられない理由（入力欄の下に出す） */
  protected readonly officeLockNote = computed(() => {
    if (!this.officeLocked()) return '';
    const state = this.officeUseState();
    if (state === 'loading') return '使われているかを確かめています…';
    if (state === 'failed') return '使われているかを確かめられなかったため、保険者・都道府県は変えられません（事業所名・初期値は変えられます）。通信を確かめて、開き直してください。';
    return `使用中（${officeUseLabel(this.officeUse()!)}）なので、保険者・都道府県は変えられません。保険者や所在地が変わったときは、新しい適用事業所を追加し、従業員の詳細で異動を登録してください（過去の月は、この事業所の保険者・料率のまま計算します）。事業所名・新規登録の初期値は変えられます。`;
  });

  /** その事業所の使われ方を、最新の従業員の一覧と確定の記録で数える（使い回している一覧は使わない） */
  private async loadOfficeUse(officeId: string): Promise<OfficeUse> {
    this.employeeRepo.clearCache();
    const [employees, closed] = await Promise.all([this.employeeRepo.loadAll(), this.closingRepo.closedMonthsOf(officeId)]);
    return { employees: officeUsage(employees, officeId), closedMonths: closed.length };
  }
  protected openKumiai(k: Insurer | null): void | Promise<void> {
    return this.guard(() => this.openKumiaiNow(k));
  }
  private openKumiaiNow(k: Insurer | null): void {
    this.kumiaiForm.set(k ? { name: k.name, specialInsuredEnabled: k.specialInsuredEnabled ?? false } : EMPTY_KUMIAI);
    // 追加のときは、料率の適用開始月に今月を入れておく
    const thisYm = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7);
    this.kumiaiRatesForm.set({ ...EMPTY_KUMIAI_RATES, validFrom: k ? '' : thisYm });
    this.openMode({ kind: 'kumiai', id: k?.id ?? null });
  }
  /** 料率の追加（insurerId を指定）または変更（rate を指定） */
  protected openRate(insurerId: string, r: RateRecord | null): void | Promise<void> {
    return this.guard(() => this.openRateNow(insurerId, r));
  }
  private openRateNow(insurerId: string, r: RateRecord | null): void {
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
    // 開いた入力欄まで動かし、最初の欄にカーソルを置く（会社の設定のフォームは前からあるので移らない）
    focusFormSoon('app-settings', true);
    this.errors.set({});
    this.notice.set(null);
    this.mode.set(m);
    this.formSnapshot.take();
  }
  /**
   * 開いている追加・変更のフォームを閉じてよいか（入力を変えていれば、破棄してよいかを確かめる。設計書 3.0）。
   * 「やめる」と、別のフォームを開くとき（開くと今の入力が置き換わる）に使う。会社の設定のフォームは閉じないので含めない
   */
  private guard(action: () => void): void | Promise<void> {
    return afterDiscardCheck(this.confirm, this.mode() !== null && this.formSnapshot.changed(), action);
  }

  /** 「やめる」：入力を変えていれば、破棄してよいかを確かめてから閉じる */
  protected cancel(): void | Promise<void> {
    return this.guard(() => this.mode.set(null));
  }

  /** 会社の設定（読み込んだとき・保存したときの値と比べる） */
  private readonly settingsSnapshot = new FormSnapshot(() => this.settings());
  /** 追加・変更のフォーム（開いたときの値と比べる） */
  private readonly formSnapshot = new FormSnapshot(() => [this.groupForm(), this.termsForm(), this.bonusTypeForm(), this.officeForm(), this.kumiaiForm(), this.kumiaiRatesForm(), this.rateForm()]);
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
  protected setKumiaiFrom(v: string): void {
    this.kumiaiRatesForm.update((f) => ({ ...f, validFrom: v }));
  }
  protected setKumiaiRate(type: (typeof KUMIAI_RATE_TYPES)[number], key: keyof RatePair, v: string): void {
    this.kumiaiRatesForm.update((f) => ({ ...f, [type]: { ...f[type], [key]: v } }));
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
    // 使われている事業所の保険者・都道府県は変えない。保存の直前に、最新の所属・確定の記録で確かめ直す
    const before = m.id ? this.offices().find((o) => o.id === m.id) : null;
    // 使わないにした事業所は初期値にできない（ルールでも拒否する）
    if (before?.archived && f.isDefault) {
      this.notice.set(`適用事業所「${before.name}」は使わないにしているため、初期値にできません。先に「使うに戻す」をしてください。`);
      return;
    }
    if (before && (before.insurerId !== f.insurerId || before.prefecture !== f.prefecture)) {
      this.saving.set(true);
      try {
        const use = await this.loadOfficeUse(before.id);
        this.officeUse.set(use);
        this.officeUseState.set('ready');
        const msg = officeChangeError(before, f, use);
        if (msg) {
          this.errors.set({ form: msg });
          return;
        }
      } catch (e) {
        console.error(e);
        this.errors.set({ form: '使われているかを確かめられなかったため、保存していません。通信を確かめてください。' });
        return;
      } finally {
        this.saving.set(false);
      }
    }
    await this.run(() => this.repo.saveOffice(m.id, f, this.offices()), `${f.name.trim()}を保存しました。`);
  }

  protected async saveKumiai(event: Event): Promise<void> {
    event.preventDefault();
    const m = this.mode();
    if (m?.kind !== 'kumiai') return;
    const f = this.kumiaiForm();
    const errors = checkKumiai(f, this.insurers().filter((i) => i.id !== m.id));
    if (m.id) {
      this.errors.set(errors);
      if (Object.keys(errors).length > 0) return;
      await this.run(() => this.repo.saveKumiai(m.id, f), `${f.name.trim()}を保存しました。`);
      return;
    }
    // 追加：組合と料率を一緒に登録する。名前と料率の誤りは一度に出す
    const r = checkKumiaiRates(this.kumiaiRatesForm());
    this.errors.set({ ...errors, ...r.errors });
    if (Object.keys(errors).length > 0 || Object.keys(r.errors).length > 0) return;
    const later = r.skipped.map((t) => RATE_TYPE_LABELS[t]).join('・');
    await this.run(
      () => this.repo.addKumiaiWithRates(f, r.rates),
      `${f.name.trim()}を、料率${r.rates.length}件（${yearMonthLabel(this.kumiaiRatesForm().validFrom)}分から）と一緒に登録しました。` +
        (later ? `${later}の料率は未登録です。その保険がかかる人がいるなら、下の「料率を追加」で登録してください。` : ''),
    );
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

  // ---- 使わないにする（給与の支払区分・賞与の種類・適用事業所・健康保険組合。設計書 3.10） ----
  // マスタは消さない。過去の給与・賞与・履歴・確定した結果がIDで参照しているので、消すと参照先がなくなるため（ルールでも削除を止める）。
  // 使わなくなったものは「使わない」にし、新しく選べなくする（ルールでも止める）。過去の計算・表示は変わらない

  protected archivePayrollGroup(g: PayrollGroup): Promise<void> {
    return this.archiveMaster('給与の支払区分', g.name, 'payrollGroups', g.id, async () => ({
      isDefault: g.isDefault === true,
      currentEmployees: currentPayrollGroupUsers(await this.freshEmployees(), g.id, this.today()),
    }), '使わないにした区分は、新しく割り当てられなくなります。これまでの月の計算はこの区分のままです。');
  }

  protected archiveBonusType(t: BonusType): Promise<void> {
    return this.archiveMaster('賞与の種類', t.name, 'bonusTypes', t.id, async () => ({ isDefault: false }),
      '使わないにした種類は、新しい賞与では選べなくなります。登録済みの賞与はこの種類のままです。');
  }

  protected archiveOffice(o: Office): Promise<void> {
    return this.archiveMaster('適用事業所', o.name, 'offices', o.id, async () => ({
      isDefault: o.isDefault === true,
      currentEmployees: currentOfficeUsers(await this.freshEmployees(), o.id, this.today()),
    }), '使わないにした事業所は、新規登録・異動で選べなくなります。これまでに所属した人の履歴・過去の月の計算・確定した結果はそのままです。');
  }

  /** 健康保険組合を使わないにする（使っている適用事業所があればできない。料率は残す） */
  protected archiveKumiai(k: Insurer): Promise<void> {
    return this.archiveMaster('健康保険組合', k.name, 'insurers', k.id, async () => ({
      isDefault: false,
      activeOffices: this.offices().filter((o) => !o.archived && o.insurerId === k.id).length,
    }), '使わないにした組合は、適用事業所・二以上事業所勤務の保険者として選べなくなります。料率と、これまでの月の計算はそのままです。');
  }

  /** 使わないにしたマスタを、また使えるようにする */
  protected async unarchive(label: string, name: string, kind: 'offices' | 'payrollGroups' | 'insurers' | 'bonusTypes', id: string): Promise<void> {
    await this.run(() => this.repo.setArchived(kind, id, false), `${label}「${name}」を、また使えるようにしました。`);
  }

  private today(): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  }

  /** 使われているかを確かめるための、読み直した従業員の一覧（使い回している一覧は古いことがあるため） */
  private async freshEmployees() {
    this.employeeRepo.clearCache();
    return this.employeeRepo.loadAll();
  }

  /**
   * 使わないにできるかを確かめ、確認してから使わないにする。確認を出しているあいだに使われ始めることがあるので、
   * 書き込む直前にもう一度確かめる
   */
  private async archiveMaster(
    label: string,
    name: string,
    kind: 'offices' | 'payrollGroups' | 'insurers' | 'bonusTypes',
    id: string,
    check: () => Promise<{ isDefault: boolean; currentEmployees?: number; activeOffices?: number }>,
    note: string,
  ): Promise<void> {
    this.notice.set(null);
    this.saving.set(true);
    try {
      const blocked = archiveBlockMessage(label, name, await check());
      if (blocked) {
        this.notice.set(blocked);
        return;
      }
    } catch (e) {
      console.error(e);
      this.notice.set(`${label}「${name}」が使われているかを確かめられませんでした。権限と通信を確かめてください。`);
      return;
    } finally {
      this.saving.set(false);
    }
    const ok = await this.confirm.ask({
      title: `${label}を使わないにする`,
      message: `${label}「${name}」を使わないにします。${note}あとから「使うに戻す」で戻せます。`,
      ok: '使わないにする',
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      const now = archiveBlockMessage(label, name, await check());
      if (now) {
        this.notice.set(now);
        await this.reload();
        return;
      }
      await this.repo.setArchived(kind, id, true);
      this.mode.set(null);
      this.notice.set(`${label}「${name}」を使わないにしました。`);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.notice.set(`${label}「${name}」を使わないにできませんでした。権限と通信を確かめてください。`);
    } finally {
      this.saving.set(false);
    }
  }

  /** 誤って追加した組合健保の料率の行を削除する（その月にほかの料率がなければ、計算は「未登録」になる） */
  protected deleteRate(r: RateRecord): Promise<void> {
    const name = `${this.rateTypeLabels[r.rateType]}・${yearMonthLabel(r.validFrom)}から ${this.toPercent(r.rate)}%`;
    // 削除の確認に、影響する期間・事業所・削除したあとの計算・確定済みの月を出す（どの月の計算に効くかが分かるように）
    const note = async () => {
      const users = this.offices().filter((o) => o.insurerId === r.insurerId);
      this.employeeRepo.clearCache();
      const [employees, closedLists] = await Promise.all([
        this.employeeRepo.loadAll(),
        Promise.all(users.map((o) => this.closingRepo.closedMonthsOf(o.id))),
      ]);
      const closedByOffice = Object.fromEntries(users.map((o, k) => [o.id, closedLists[k]]));
      const selecting = insurerUsage([], employees, r.insurerId).employees;
      return rateDeleteMessage(rateDeleteImpact(r, this.rates(), this.offices(), selecting, closedByOffice), (v) => this.toPercent(v));
    };
    return this.deleteMaster('料率', name, async () => ({ isDefault: false }), () => this.repo.deleteRate(r.id), note);
  }

  /** 使用中かを確かめ、使われていなければ確認してから削除する */
  private async deleteMaster(
    label: string,
    name: string,
    usage: () => Promise<{ isDefault: boolean; employees?: number; bonuses?: boolean; offices?: number; closedMonths?: number }>,
    remove: () => Promise<void>,
    note: string | (() => Promise<string>) = '',
  ): Promise<void> {
    let noteText = typeof note === 'string' ? note : '';
    this.notice.set(null);
    this.saving.set(true);
    try {
      this.employeeRepo.clearCache();
      const inUse = inUseMessage(label, name, await usage());
      if (typeof note !== 'string') noteText = await note();
      if (inUse) {
        this.notice.set(inUse);
        return;
      }
    } catch (e) {
      console.error(e);
      this.notice.set(`${label}「${name}」が使われているかを確かめられませんでした。権限と通信を確かめてください。`);
      return;
    } finally {
      this.saving.set(false);
    }
    const ok = await this.confirm.ask({
      title: `${label}を削除`,
      message: `${label}「${name}」を削除します。元に戻せません。${noteText}`,
      ok: '削除する',
      danger: true,
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      // 確認を出しているあいだに、ほかの担当者が使い始めたかもしれないので、消す直前に読み直して確かめる
      // （マスタの参照はルールでは確かめられないため。使われたまま消すと、参照先のない事業所・区分が残る）
      this.employeeRepo.clearCache();
      const now = inUseMessage(label, name, await usage());
      if (now) {
        this.notice.set(now);
        await this.reload();
        return;
      }
      await remove();
      this.mode.set(null);
      this.notice.set(`${label}「${name}」を削除しました。`);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.notice.set(`${label}「${name}」を削除できませんでした。権限と通信を確かめてください。`);
    } finally {
      this.saving.set(false);
    }
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
