// 設定画面で使う、会社ごとのマスタ（適用事業所・組合健保・料率）と会社の設定の読み書き（設計書 4章）
// 協会けんぽの保険者・料率、厚生年金の料率、等級表はシステム共通マスタのため、ここからは書き込まない（ルールでも拒否する）
import { ColumnMapping, IMPORT_FIELDS, ImportKind } from '../calc/master-import';
import { Service } from '@angular/core';
import { addDoc, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { siCol, siDoc } from '../firestore-paths';
import { Office } from '../calc/office';
import type { Insurer, InsurerRate } from '../calc/rate';
import { CompanySettings, DEFAULT_SETTINGS, KumiaiInput, OfficeInput } from '../calc/settings';
import { SalaryMapping } from '../calc/salary-import';
import { DecisionMapping } from '../calc/decision-import';
import { BonusType, BonusTypeInput } from '../calc/bonus-type';
import { legacyGroup, PayrollGroup, PayrollGroupInput } from '../calc/payroll-group';

export type RateRecord = InsurerRate & { id: string };

/** 会社の設定は1件だけ持つ */
const SETTINGS_ID = 'main';

@Service()
export class SettingsRepository {
  /** 会社の設定。まだ保存されていなければ初期値 */
  async loadSettings(): Promise<CompanySettings> {
    const snap = await getDoc(siDoc('companySettings', SETTINGS_ID));
    const d = snap.data() ?? {};
    return {
      childSupportRounding: d['childSupportRounding'] ?? DEFAULT_SETTINGS.childSupportRounding,
      deductionTiming: d['deductionTiming'] ?? DEFAULT_SETTINGS.deductionTiming,
      payrollCutoff: d['payrollCutoff'] ?? DEFAULT_SETTINGS.payrollCutoff,
      retentionYears: d['retentionYears'] ?? DEFAULT_SETTINGS.retentionYears,
      fullTimeWeeklyHours: d['fullTimeWeeklyHours'] ?? DEFAULT_SETTINGS.fullTimeWeeklyHours,
      fullTimeMonthlyDays: d['fullTimeMonthlyDays'] ?? DEFAULT_SETTINGS.fullTimeMonthlyDays,
      startDate: d['startDate'] ?? null,
    };
  }

  /** 管理者が変えられる項目だけを書く（retentionYears は運営者だけが変える） */
  async saveSettings(s: CompanySettings): Promise<void> {
    await setDoc(
      siDoc('companySettings', SETTINGS_ID),
      {
        childSupportRounding: s.childSupportRounding,
        deductionTiming: s.deductionTiming,
        payrollCutoff: s.payrollCutoff,
        fullTimeWeeklyHours: s.fullTimeWeeklyHours,
        fullTimeMonthlyDays: s.fullTimeMonthlyDays,
        startDate: s.startDate ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  /** 登録した支払区分（設計書 2.10）。まだ登録していなければ空 */
  async loadPayrollGroupRecords(): Promise<PayrollGroup[]> {
    const snap = await getDocs(siCol('payrollGroups'));
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: x['name'] ?? '',
        cutoffDay: x['cutoffDay'] ?? 'end',
        paidIn: x['paidIn'] ?? 'nextMonth',
        deductionTiming: x['deductionTiming'] ?? 'nextMonth',
        payDay: x['payDay'] ?? 25,
        isDefault: x['isDefault'] === true,
      };
    });
  }

  /** 計算に使う支払区分。まだ登録していなければ、会社の設定（以前の、会社で1つの設定）を既定の区分にする */
  async loadPayrollGroups(): Promise<PayrollGroup[]> {
    const [groups, settings] = await Promise.all([this.loadPayrollGroupRecords(), this.loadSettings()]);
    return groups.length > 0 ? groups : [legacyGroup(settings)];
  }

  /** 支払区分の追加・変更。既定にした場合は、ほかの区分の既定を外す（既定は1つだけ） */
  async savePayrollGroup(id: string | null, input: PayrollGroupInput, groups: PayrollGroup[]): Promise<void> {
    const batch = writeBatch(db);
    const ref = id ? siDoc('payrollGroups', id) : siDocNew('payrollGroups');
    batch.set(ref, { ...input, name: input.name.trim(), isDefault: input.isDefault === true });
    if (input.isDefault) {
      for (const g of groups) if (g.id !== ref.id && g.isDefault) batch.update(siDoc('payrollGroups', g.id), { isDefault: false });
    }
    await batch.commit();
  }

  /** 給与のCSVの列の対応づけ（設計書 3.8）。保存されていなければ null */
  async loadSalaryMapping(): Promise<SalaryMapping | null> {
    const snap = await getDoc(siDoc('companySettings', SETTINGS_ID));
    const m = snap.data()?.['csvMappings']?.['salary'];
    if (!m) return null;
    return {
      employeeNumber: m['employeeNumber'] ?? '',
      paidDate: m['paidDate'] ?? '',
      paymentBaseDays: m['paymentBaseDays'] ?? '',
      fixedWages: m['fixedWages'] ?? [],
      nonFixedWages: m['nonFixedWages'] ?? [],
      retroactiveDiff: m['retroactiveDiff'] ?? '',
      inKindWages: m['inKindWages'] ?? '',
      workingHours: m['workingHours'] ?? '',
      hourlyRate: m['hourlyRate'] ?? '',
    };
  }

  /** 賞与の種類（設計書 2.4） */
  async loadBonusTypes(): Promise<BonusType[]> {
    const snap = await getDocs(siCol('bonusTypes'));
    return snap.docs
      .map((d) => ({
        id: d.id,
        name: d.data()['name'] ?? '',
        isRemuneration: d.data()['isRemuneration'] === true,
        validFrom: d.data()['validFrom'] ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** その種類の賞与が1件でも登録されているか（削除の前に確かめる。設計書 3.10） */
  async isBonusTypeUsed(id: string): Promise<boolean> {
    const snap = await getDocs(query(siCol('bonuses'), where('bonusTypeId', '==', id), limit(1)));
    return !snap.empty;
  }

  /** 賞与の種類の削除（管理者だけ。使用中でないことを画面で確かめてから呼ぶ） */
  async deleteBonusType(id: string): Promise<void> {
    await deleteDoc(siDoc('bonusTypes', id));
  }

  /** 給与の支払区分の削除（管理者だけ。使用中・初期値でないことを画面で確かめてから呼ぶ） */
  async deletePayrollGroup(id: string): Promise<void> {
    await deleteDoc(siDoc('payrollGroups', id));
  }

  /** 組合健保の料率の削除（管理者だけ。誤って追加した行。消した月は、ほかに有効な料率がなければ「未登録」になる） */
  async deleteRate(id: string): Promise<void> {
    await deleteDoc(siDoc('insurerRates', id));
  }

  /** 健康保険組合の削除（管理者だけ。使用中でないことを画面で確かめてから呼ぶ）。その組合の料率もまとめて消す */
  async deleteKumiai(id: string, rateIds: string[]): Promise<void> {
    const batch = writeBatch(db);
    for (const r of rateIds) batch.delete(siDoc('insurerRates', r));
    batch.delete(siDoc('insurers', id));
    await batch.commit();
  }

  /** 適用事業所の削除（管理者だけ。使用中・初期値でないことを画面で確かめてから呼ぶ） */
  async deleteOffice(id: string): Promise<void> {
    await deleteDoc(siDoc('offices', id));
  }

  /** 賞与の種類の追加・変更（管理者だけ） */
  async saveBonusType(id: string | null, input: BonusTypeInput): Promise<void> {
    const data = { name: input.name.trim(), isRemuneration: input.isRemuneration, validFrom: input.validFrom };
    if (id) await setDoc(siDoc('bonusTypes', id), data);
    else await addDoc(siCol('bonusTypes'), data);
  }

  /** 決定通知書のCSVの列の対応づけ（設計書 2.13.2）。保存されていなければ null */
  async loadDecisionMapping(): Promise<DecisionMapping | null> {
    const snap = await getDoc(siDoc('companySettings', SETTINGS_ID));
    const m = snap.data()?.['csvMappings']?.['decision'];
    if (!m) return null;
    return {
      employeeNumber: m['employeeNumber'] ?? '',
      name: m['name'] ?? '',
      birthDate: m['birthDate'] ?? '',
      validFrom: m['validFrom'] ?? '',
      healthStandard: m['healthStandard'] ?? '',
      pensionStandard: m['pensionStandard'] ?? '',
    };
  }

  /** 決定通知書のCSVの列の対応づけを保存する（管理者だけ） */
  async saveDecisionMapping(m: DecisionMapping): Promise<void> {
    await setDoc(siDoc('companySettings', SETTINGS_ID), { csvMappings: { decision: m }, updatedAt: serverTimestamp() }, { merge: true });
  }

  /** 従業員・標準報酬月額・賞与のCSVの列の対応づけ（設計書 3.8）。保存していなければ null */
  async loadCsvMapping(kind: ImportKind): Promise<ColumnMapping | null> {
    const snap = await getDoc(siDoc('companySettings', SETTINGS_ID));
    const m = snap.data()?.['csvMappings']?.[kind];
    if (!m) return null;
    return Object.fromEntries(IMPORT_FIELDS[kind].map((f) => [f.key, typeof m[f.key] === 'string' ? m[f.key] : '']));
  }

  /** 列の対応づけを保存する（管理者だけ。ルールで制限） */
  async saveCsvMapping(kind: ImportKind, m: ColumnMapping): Promise<void> {
    await setDoc(siDoc('companySettings', SETTINGS_ID), { csvMappings: { [kind]: m }, updatedAt: serverTimestamp() }, { merge: true });
  }

  /** 列の対応づけを保存する（管理者だけ。ルールで制限） */
  async saveSalaryMapping(m: SalaryMapping): Promise<void> {
    await setDoc(
      siDoc('companySettings', SETTINGS_ID),
      { csvMappings: { salary: m }, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  /** 料率をIDつきで読む（変更のため） */
  async loadRates(): Promise<RateRecord[]> {
    const snap = await getDocs(siCol('insurerRates'));
    return snap.docs.map((x) => {
      const d = x.data();
      return {
        id: x.id,
        insurerId: d['insurerId'],
        rateType: d['rateType'],
        prefecture: d['prefecture'] ?? null,
        validFrom: d['validFrom'],
        rate: d['rate'],
        employeeShare: d['employeeShare'],
      };
    });
  }

  /**
   * 適用事業所の追加・変更（id が null なら追加）
   * デフォルトにした場合は、ほかの事業所のデフォルトを外す（デフォルトは1つだけ）
   */
  async saveOffice(id: string | null, input: OfficeInput, offices: Office[]): Promise<void> {
    const batch = writeBatch(db);
    const ref = id ? siDoc('offices', id) : siDocNew('offices');
    batch.set(ref, {
      name: input.name.trim(),
      prefecture: input.prefecture,
      insurerId: input.insurerId,
      isDefault: input.isDefault,
    });
    if (input.isDefault) {
      for (const o of offices) {
        if (o.id !== ref.id && o.isDefault) batch.update(siDoc('offices', o.id), { isDefault: false });
      }
    }
    await batch.commit();
  }

  /** 組合健保の追加・変更 */
  async saveKumiai(id: string | null, input: KumiaiInput): Promise<void> {
    const data = { type: 'kumiai', name: input.name.trim(), specialInsuredEnabled: input.specialInsuredEnabled };
    if (id) await setDoc(siDoc('insurers', id), data);
    else await addDoc(siCol('insurers'), data);
  }

  /**
   * 健康保険組合を、料率と一緒に追加する（1つの書き込みにまとめ、組合だけができて料率がない状態を作らない）
   * @param rates 登録する料率（insurerId は、ここで作る組合のID を入れる）
   */
  async addKumiaiWithRates(input: KumiaiInput, rates: Omit<InsurerRate, 'insurerId'>[]): Promise<void> {
    const batch = writeBatch(db);
    const insurer = siDocNew('insurers');
    batch.set(insurer, { type: 'kumiai', name: input.name.trim(), specialInsuredEnabled: input.specialInsuredEnabled });
    for (const r of rates) batch.set(siDocNew('insurerRates'), { ...r, insurerId: insurer.id });
    await batch.commit();
  }

  /** 組合健保の料率の追加・変更 */
  async saveRate(id: string | null, rate: InsurerRate): Promise<void> {
    if (id) await updateDoc(siDoc('insurerRates', id), { validFrom: rate.validFrom, rate: rate.rate, employeeShare: rate.employeeShare });
    else await addDoc(siCol('insurerRates'), rate);
  }
}

/** IDを自動で振る新しいドキュメントの参照（バッチで使う） */
function siDocNew(name: string) {
  return doc(siCol(name));
}
