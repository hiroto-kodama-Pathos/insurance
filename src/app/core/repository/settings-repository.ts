// 設定画面で使う、会社ごとのマスタ（適用事業所・組合健保・料率）と会社の設定の読み書き（設計書 4章）
// 協会けんぽの保険者・料率、厚生年金の料率、等級表はシステム共通マスタのため、ここからは書き込まない（ルールでも拒否する）
import { Service } from '@angular/core';
import { addDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { siCol, siDoc } from '../firestore-paths';
import { Office } from '../calc/office';
import type { Insurer, InsurerRate } from '../calc/rate';
import { CompanySettings, DEFAULT_SETTINGS, KumiaiInput, OfficeInput } from '../calc/settings';
import { SalaryMapping } from '../calc/salary-import';

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
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
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
    };
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
