import { Service } from '@angular/core';

/**
 * 保険料率のデータモデル
 */
export interface InsurerRate {
  insurerId: string; // insurersのドキュメントID
  rateType: 'health' | 'care' | 'childSupport'; // 保険の種類
  prefecture: string | null; // 都道府県（協会けんぽの健康保険料率のみ。それ以外はnull）
  validFrom: string; // 適用開始年月 ('YYYY-MM')
  rate: number; // 10万分率の整数（9.85% → 9850）
  employeeShare: number; // 本人負担割合の千分率（折半 → 500）
}

export interface PensionRate {
  validFrom: string; // 適用開始年月
  rate: number; // 10万分率の整数（18.3% → 18300）
  employeeShare: number; // 本人負担割合の千分率（500）
}

export interface Insurer {
  id: string; // insurersのドキュメントID（InsurerRate.insurerId と照らし合わせる）
  type: 'kyokai' | 'kumiai'; // 協会けんぽ or 組合健保
  name: string;
  specialInsuredEnabled?: boolean; // 特定被保険者制度の採用有無（組合健保のみ）
}

/**
 * 料率取得サービス
 * 対象年月と保険者から有効な料率を選択
 */
@Service()
export class Rate {
  /**
   * 有効な料率を取得
   * @param rates 料率一覧
   * @param insurer 保険者情報
   * @param rateType 料率の種類 ('health', 'care', 'childSupport')
   * @param yearMonth 対象年月 ('YYYY-MM')
   * @param prefecture 都道府県（協会けんぽの健康保険料率のみ使用）
   * @returns 料率と本人負担割合、またはnull（該当する料率がない場合）
   */
  findRate(
    rates: InsurerRate[],
    insurer: Insurer,
    rateType: 'health' | 'care' | 'childSupport',
    yearMonth: string,
    prefecture?: string | null
  ): { rate: number; employeeShare: number } | null {
    if (!rates || rates.length === 0) {
      return null;
    }

    let filtered = rates.filter(
      (r) =>
        r.insurerId === insurer.id &&
        r.rateType === rateType &&
        r.validFrom <= yearMonth
    );

    // 協会けんぽの健康保険料率は都道府県別
    if (insurer.type === 'kyokai' && rateType === 'health' && prefecture) {
      filtered = filtered.filter((r) => r.prefecture === prefecture);
    } else if (rateType !== 'health' || insurer.type === 'kumiai') {
      // 介護保険・支援金・組合健保は都道府県なし（prefecture = null）
      filtered = filtered.filter((r) => r.prefecture === null);
    }

    // 有効な料率の中で最も新しいものを取得
    const valid = filtered.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

    if (!valid) {
      return null;
    }

    return {
      rate: valid.rate,
      employeeShare: valid.employeeShare,
    };
  }

  /**
   * 厚生年金保険料率を取得
   * @param pensionRates 厚生年金料率一覧
   * @param yearMonth 対象年月 ('YYYY-MM')
   * @returns 料率と本人負担割合、またはnull（該当する料率がない場合）
   */
  findPensionRate(
    pensionRates: PensionRate[],
    yearMonth: string
  ): { rate: number; employeeShare: number } | null {
    if (!pensionRates || pensionRates.length === 0) {
      return null;
    }

    // 対象年月以前の料率の中で、最も新しいものを取得
    const valid = pensionRates
      .filter((r) => r.validFrom <= yearMonth)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

    if (!valid) {
      return null;
    }

    return {
      rate: valid.rate,
      employeeShare: valid.employeeShare,
    };
  }

  /**
   * 料率の改定がある月かを判定
   * （管理画面で「◯月分から料率が変わります」と表示するため）
   * @param rates 料率一覧
   * @param insurer 保険者情報
   * @param rateType 料率の種類
   * @param currentYearMonth 現在の年月
   * @param prefecture 都道府県
   * @returns 改定がある場合は改定される年月、ない場合はnull
   */
  getNextRateChange(
    rates: InsurerRate[],
    insurer: Insurer,
    rateType: 'health' | 'care' | 'childSupport',
    currentYearMonth: string,
    prefecture?: string | null
  ): string | null {
    if (!rates || rates.length === 0) {
      return null;
    }

    let filtered = rates.filter(
      (r) =>
        r.insurerId === insurer.id &&
        r.rateType === rateType &&
        r.validFrom > currentYearMonth
    );

    if (insurer.type === 'kyokai' && rateType === 'health' && prefecture) {
      filtered = filtered.filter((r) => r.prefecture === prefecture);
    } else if (rateType !== 'health' || insurer.type === 'kumiai') {
      filtered = filtered.filter((r) => r.prefecture === null);
    }

    // 最も近い改定月を取得
    const nextChange = filtered.sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];

    return nextChange ? nextChange.validFrom : null;
  }

  /**
   * 次の改定月の前月を取得（3.4の管理画面で表示用）
   * @param changeMonth 改定月 ('YYYY-MM')
   * @returns 改定の前月 ('YYYY-MM')
   */
  getPreviousMonth(changeMonth: string): string {
    const [year, month] = changeMonth.split('-').map(Number);
    if (month === 1) {
      return `${year - 1}-12`;
    }
    return `${year}-${String(month - 1).padStart(2, '0')}`;
  }
}
