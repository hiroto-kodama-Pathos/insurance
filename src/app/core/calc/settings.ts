// 設定画面（適用事業所・組合健保・会社の設定）の入力チェックと変換（設計書 4章 マスタ・companySettings）
import { ChildSupportRounding } from './monthly-premium';
import type { Insurer, InsurerRate } from './rate';
import { Office } from './office';

export type Errors = Record<string, string>;

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const;

/**
 * '9.85'（%）を10万分率の整数 9850 にする。小数第3位まで。正しくなければ null
 * 浮動小数点の誤差を避けるため、文字列のまま桁をずらす
 */
export function percentToRate(text: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

/** 10万分率の整数を '9.85' の表示にする */
export function rateToPercent(rate: number): string {
  const s = (rate / 1000).toFixed(3);
  return s.replace(/\.?0+$/, '');
}

/**
 * 本人負担割合（千分率）を、全体の料率と本人の料率から求める
 * 千分率の整数で表せない場合は null（計算の精度が落ちるため登録させない）
 */
export function shareFromRates(rate: number, employeeRate: number): number | null {
  if (rate <= 0) return null;
  const n = employeeRate * 1000;
  return n % rate === 0 ? n / rate : null;
}

// ---- 適用事業所 ----
export type OfficeInput = { name: string; prefecture: string; insurerId: string; isDefault: boolean };

export function checkOffice(input: OfficeInput, insurers: Insurer[], others: Office[]): Errors {
  const errors: Errors = {};
  const name = input.name.trim();
  if (!name) errors['name'] = '事業所名を入力してください';
  else if (name.length > 50) errors['name'] = '事業所名は50文字以内にしてください';
  else if (others.some((o) => o.name === name)) errors['name'] = '同じ名前の事業所があります';
  const insurer = insurers.find((i) => i.id === input.insurerId);
  if (!insurer) errors['insurerId'] = '加入する保険者を選んでください';
  // 協会けんぽは都道府県で健康保険料率が決まるので必須
  if (insurer?.type === 'kyokai' && !(PREFECTURES as readonly string[]).includes(input.prefecture))
    errors['prefecture'] = '協会けんぽの事業所は都道府県を選んでください';
  return errors;
}

// ---- 組合健保（保険者） ----
export type KumiaiInput = { name: string; specialInsuredEnabled: boolean };

export function checkKumiai(input: KumiaiInput, others: Insurer[]): Errors {
  const errors: Errors = {};
  const name = input.name.trim();
  if (!name) errors['name'] = '健康保険組合の名前を入力してください';
  else if (name.length > 50) errors['name'] = '名前は50文字以内にしてください';
  else if (others.some((i) => i.name === name)) errors['name'] = '同じ名前の保険者があります';
  return errors;
}

// ---- 組合健保の料率 ----
export type RateInput = {
  insurerId: string;
  rateType: InsurerRate['rateType'];
  validFrom: string;
  /** 全体の料率（%）の入力 */
  rate: string;
  /** 本人の料率（%）の入力。空なら折半 */
  employeeRate: string;
};

export const RATE_TYPE_LABELS: Record<InsurerRate['rateType'], string> = {
  health: '健康保険',
  care: '介護保険',
  childSupport: '子ども・子育て支援金',
};

/**
 * 組合健保の料率の入力チェック
 * @param others 同じ保険者の登録済みの料率（変更のときは、変更する1件を除いたもの）
 * @returns エラーと、保存する値（エラーがなければ）
 */
export function checkRate(
  input: RateInput,
  others: InsurerRate[],
): { errors: Errors; value: InsurerRate | null } {
  const errors: Errors = {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.validFrom)) errors['validFrom'] = '適用開始月を正しく入力してください';
  else if (others.some((r) => r.rateType === input.rateType && r.validFrom === input.validFrom))
    errors['validFrom'] = 'この月からの料率はすでに登録されています';
  if (input.rateType === 'childSupport' && input.validFrom && input.validFrom < '2026-04')
    errors['validFrom'] = '子ども・子育て支援金は2026年4月分からです';

  const rate = percentToRate(input.rate);
  if (rate === null || rate === 0) errors['rate'] = '料率を%で入力してください（小数第3位まで。例：9.5）';

  let share: number | null = 500;
  if (input.employeeRate.trim() !== '' && rate) {
    const employeeRate = percentToRate(input.employeeRate);
    if (employeeRate === null) errors['employeeRate'] = '本人の料率を%で入力してください';
    else if (employeeRate > rate) errors['employeeRate'] = '本人の料率は全体の料率以下にしてください';
    else {
      share = shareFromRates(rate, employeeRate);
      if (share === null) errors['employeeRate'] = '本人の負担割合が0.1%単位で割り切れません。規約の料率を確かめてください';
    }
  }
  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    value: ok
      ? { insurerId: input.insurerId, rateType: input.rateType, prefecture: null, validFrom: input.validFrom, rate: rate!, employeeShare: share! }
      : null,
  };
}

// ---- 会社の設定 ----
export type CompanySettings = {
  /** 子ども・子育て支援金の本人負担の端数処理 */
  childSupportRounding: ChildSupportRounding;
  /** 保険料を控除する給与 */
  deductionTiming: 'nextMonth' | 'sameMonth';
  /** 給与の締め日と支払月 */
  payrollCutoff: { day: number | 'end'; paidIn: 'sameMonth' | 'nextMonth' };
  /** 退職者の個人データの保管期間（年）。運営者だけが変更する */
  retentionYears: number;
};

export const DEFAULT_SETTINGS: CompanySettings = {
  childSupportRounding: 'combined',
  deductionTiming: 'nextMonth',
  payrollCutoff: { day: 'end', paidIn: 'nextMonth' },
  retentionYears: 2,
};

export function checkSettings(s: CompanySettings): Errors {
  const errors: Errors = {};
  const d = s.payrollCutoff.day;
  if (d !== 'end' && !(Number.isInteger(d) && d >= 1 && d <= 30))
    errors['cutoffDay'] = '締め日は1〜30日か「末日」にしてください';
  return errors;
}
