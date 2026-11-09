import { Service } from '@angular/core';

/**
 * 標準報酬月額のサービス
 * 履歴管理と等級提案を行う
 */
export interface StandardRemunerationHistory {
  validFrom: string; // 適用開始年月 ('YYYY-MM')
  reason: 'acquisition' | 'regular' | 'revision' | 'leaveEnd';
  healthStandard: number; // 健康保険の標準報酬月額（円）
  pensionStandard: number; // 厚生年金の標準報酬月額（円）
  remuneration?: number | null; // 報酬月額（参考）
  ownRemuneration?: number | null; // 二以上事業所勤務の場合の自社報酬
  totalRemuneration?: number | null; // 二以上事業所勤務の場合の合計報酬
  selectedInsurerId?: string | null; // 二以上事業所勤務の場合に本人が選択した保険者
}

export interface Grade {
  validFrom: string; // 適用開始年月
  healthGrade: number; // 健康保険の等級（1〜50）
  pensionGrade: number | null; // 厚生年金の等級（1〜32、該当なしはnull）
  lowerLimit: number; // 報酬月額の下限（円、以上）
  upperLimit: number | null; // 報酬月額の上限（円、未満。最上位はnull）
  standardAmount: number; // 標準報酬月額（円）
}

@Service()
export class StandardRemuneration {
  /**
   * 対象年月に有効な標準報酬月額を履歴から取得
   * @param history 標準報酬月額の履歴（適用開始年月でソート済み）
   * @param yearMonth 対象年月 ('YYYY-MM')
   * @returns 健康保険と厚生年金の標準報酬月額、またはnull（履歴がない場合）
   */
  findStandardRemuneration(
    history: StandardRemunerationHistory[],
    yearMonth: string
  ): { healthStandard: number; pensionStandard: number } | null {
    if (!history || history.length === 0) {
      return null;
    }

    // 対象年月以前の履歴の中で、最も新しいものを取得
    const valid = history
      .filter((h) => h.validFrom <= yearMonth)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

    if (!valid) {
      return null;
    }

    return {
      healthStandard: valid.healthStandard,
      pensionStandard: valid.pensionStandard,
    };
  }

  /**
   * 報酬月額から等級を提案する
   * @param remuneration 報酬月額（円）
   * @param grades 等級表（適用開始年月でソート済み）
   * @param yearMonth 対象年月 ('YYYY-MM')
   * @returns 提案する等級と標準報酬月額、またはnull（等級表がない場合）
   */
  suggestGrade(
    remuneration: number,
    grades: Grade[],
    yearMonth: string
  ): {
    healthGrade: number;
    pensionGrade: number | null;
    healthStandard: number;
    pensionStandard: number | null;
  } | null {
    if (!grades || grades.length === 0) {
      return null;
    }

    // 対象年月以前の等級表の中で、最も新しいものを取得
    const validGrades = grades
      .filter((g) => g.validFrom <= yearMonth)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

    if (!validGrades || !validGrades.healthGrade) {
      return null;
    }

    // 報酬月額が含まれる範囲の等級を探す
    // 下限 <= 報酬月額 < 上限 の条件でマッチする等級を取得
    const gradeTable = grades.filter((g) => g.validFrom === validGrades.validFrom);
    const matchedGrade = gradeTable.find((g) => {
      const lowerOk = g.lowerLimit <= remuneration;
      const upperOk = g.upperLimit === null || remuneration < g.upperLimit;
      return lowerOk && upperOk;
    });

    if (!matchedGrade) {
      return null;
    }

    // 厚生年金：同じ報酬月額の行に厚生年金の等級があればその額。厚生年金の範囲より下・上の報酬月額は、
    // 厚生年金のいちばん下・上の等級（健康保険と厚生年金は等級の範囲が違うため）
    const pensionRows = gradeTable.filter((g) => g.pensionGrade !== null).sort((a, b) => a.standardAmount - b.standardAmount);
    const pensionRow =
      matchedGrade.pensionGrade !== null
        ? matchedGrade
        : pensionRows.length === 0
          ? null
          : matchedGrade.standardAmount < pensionRows[0].standardAmount
            ? pensionRows[0]
            : pensionRows[pensionRows.length - 1];
    return {
      healthGrade: matchedGrade.healthGrade,
      pensionGrade: pensionRow?.pensionGrade ?? null,
      healthStandard: matchedGrade.standardAmount,
      pensionStandard: pensionRow?.standardAmount ?? null,
    };
  }

  /**
   * 最高等級・最低等級付近の特例判定用に、
   * 等級表から最高等級と最低等級の情報を取得
   * @param grades 等級表
   * @param yearMonth 対象年月
   * @returns 最高等級の番号と最低等級の情報、またはnull
   */
  getGradeExtremities(
    grades: Grade[],
    yearMonth: string
  ): { maxHealthGrade: number; minHealthGrade: number; maxPensionGrade: number | null } | null {
    if (!grades || grades.length === 0) {
      return null;
    }

    const validGrades = grades
      .filter((g) => g.validFrom <= yearMonth)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

    if (!validGrades) {
      return null;
    }

    const gradeTable = grades.filter((g) => g.validFrom === validGrades.validFrom);
    const healthGrades = gradeTable.map((g) => g.healthGrade).filter((g) => g !== null);
    const pensionGrades = gradeTable.map((g) => g.pensionGrade).filter((g) => g !== null);

    return {
      maxHealthGrade: Math.max(...healthGrades),
      minHealthGrade: Math.min(...healthGrades),
      maxPensionGrade: pensionGrades.length > 0 ? Math.max(...pensionGrades) : null,
    };
  }
}
