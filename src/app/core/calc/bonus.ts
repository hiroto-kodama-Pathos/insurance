import { Service } from '@angular/core';

/**
 * 賞与のデータモデル
 */
export interface BonusData {
  employeeId: string; // 従業員ID
  insurerId: string; // 支給時点の保険者ID
  paidDate: string; // 支給日 ('YYYY-MM-DD')
  amount: number; // 賞与額（円）
  inKindAmount?: number | null; // うち現物で支給した分の価額（amountに含まれる）
  officeId: string; // 支給日時点の所属事業所ID
  bonusTypeId: string; // 賞与の種類ID
}

export interface Employee {
  acquisitionDate: string; // 資格取得日 ('YYYY-MM-DD')
  retirementDate?: string | null; // 退職日
  lostDate?: string | null; // 資格喪失日（退職日の翌日）
}

export interface BonusType {
  name: string;
  isRemuneration: boolean; // 年4回以上支給かどうか
}

/**
 * 賞与計算サービス
 */
@Service()
export class Bonus {
  /**
   * 標準賞与額を計算
   * 賞与額の1,000円未満を切り捨てた額（2.4）
   * @param bonusAmount 賞与額（現物を含む合計）
   * @returns 標準賞与額
   */
  calcStandardBonus(bonusAmount: number): number {
    return Math.floor(bonusAmount / 1000) * 1000;
  }

  /**
   * 賞与の対象判定
   * 支給日に被保険者かどうかで判定（2.4）
   * @param employee 従業員
   * @param paidDate 支給日 ('YYYY-MM-DD')
   * @returns 'outside'（被保険者期間外）、'lostMonth'（喪失月：保険料なし・累計に算入）、'charged'（保険料あり）
   */
  bonusTarget(employee: Employee, paidDate: string): 'outside' | 'lostMonth' | 'charged' {
    const paidDateStr = paidDate.substring(0, 7); // 'YYYY-MM-DD' → 'YYYY-MM'
    const acquisitionMonth = employee.acquisitionDate.substring(0, 7);
    const lostDateStr = employee.lostDate ? employee.lostDate.substring(0, 7) : null;

    // ①資格取得日より前の支給
    if (paidDate < employee.acquisitionDate) {
      return 'outside';
    }

    // ①資格喪失日以降の支給
    if (employee.lostDate && paidDate >= employee.lostDate) {
      return 'outside';
    }

    // ②資格喪失月に喪失日の前日までに支給し、取得月と同じ月でない
    if (employee.lostDate && paidDateStr === lostDateStr && paidDate < employee.lostDate) {
      if (paidDateStr !== acquisitionMonth) {
        return 'lostMonth'; // 保険料なし、累計に算入
      }
    }

    // ③それ以外：保険料がかかる
    return 'charged';
  }

  /**
   * 賞与が対象かを判定（対象外かどうか）
   * @param employee 従業員
   * @param paidDate 支給日
   * @returns true: 対象（保険料あり）、false: 対象外（保険料なし）
   */
  isBonusCharged(employee: Employee, paidDate: string): boolean {
    return this.bonusTarget(employee, paidDate) === 'charged';
  }

  /**
   * 賞与が年度累計に含まれるか
   * @param employee 従業員
   * @param paidDate 支給日
   * @returns true: 年度累計に含める、false: 含めない
   */
  includedInFiscalYearTotal(employee: Employee, paidDate: string): boolean {
    const target = this.bonusTarget(employee, paidDate);
    return target === 'lostMonth' || target === 'charged';
  }

  /**
   * 年度を取得
   * 4月1日〜翌3月31日を1年度とする
   * @param dateStr 日付 ('YYYY-MM-DD')
   * @returns 年度（'YYYY'）
   */
  getFiscalYear(dateStr: string): string {
    const [year, month] = dateStr.substring(0, 7).split('-').map(Number);
    if (month >= 4) {
      return String(year); // 4月以降は同じ年
    }
    return String(year - 1); // 1〜3月は前の年度
  }

  /**
   * 該当年度の支給回数を数える（4回目の警告用：2.4）
   * @param bonuses 賞与一覧
   * @param employeeId 従業員ID
   * @param fiscalYear 年度（'YYYY'）
   * @param bonusTypeId 賞与の種類ID（同じ種類だけ数える）
   * @returns その年度の支給回数
   */
  countBonusesInFiscalYear(
    bonuses: BonusData[],
    employeeId: string,
    fiscalYear: string,
    bonusTypeId: string
  ): number {
    return bonuses.filter((b) => {
      if (b.employeeId !== employeeId || b.bonusTypeId !== bonusTypeId) {
        return false;
      }
      return this.getFiscalYear(b.paidDate) === fiscalYear;
    }).length;
  }

  /**
   * 健康保険・介護保険の年度累計上限を考慮して、
   * 控除対象となる標準賞与額を計算（2.4）
   * @param standardBonus 標準賞与額
   * @param yearlyTotal 同一保険者での当年度の既支給分累計
   * @returns 控除対象の標準賞与額（573万円上限で調整）
   */
  adjustHealthInsuranceCap(standardBonus: number, yearlyTotal: number): number {
    const cap = 5_730_000; // 573万円
    if (yearlyTotal >= cap) {
      return 0; // 上限超過
    }
    const remaining = cap - yearlyTotal;
    return Math.min(standardBonus, remaining);
  }

  /**
   * 厚生年金の同月合計上限を考慮して、
   * 控除対象となる標準賞与額を計算（2.4）
   * @param standardBonus 標準賞与額
   * @param monthlyTotal 同じ月の既支給分累計
   * @returns 控除対象の標準賞与額（150万円上限で調整）
   */
  adjustPensionMonthCap(standardBonus: number, monthlyTotal: number): number {
    const cap = 1_500_000; // 150万円
    if (monthlyTotal >= cap) {
      return 0; // 上限超過
    }
    const remaining = cap - monthlyTotal;
    return Math.min(standardBonus, remaining);
  }

  /**
   * 標準賞与額が上限に達した月かを判定
   * @param adjustedAmount 調整後の標準賞与額
   * @param cap 上限額
   * @return true: 上限に達した、false: まだ余りあり
   */
  isCapReached(adjustedAmount: number, cap: number): boolean {
    return adjustedAmount === 0;
  }

  /**
   * 保険料が免除される賞与か判定
   * 産前産後休業・育児休業の免除対象（2.16）
   * @param leaves 休業期間の配列
   * @param paidDate 支給日
   * @returns 'none'（免除なし）、'maternity'（産休免除）、'childcare'（育休免除）
   */
  bonusExemption(
    leaves: Array<{ type: 'maternity' | 'childcare'; startDate: string; endDate: string }>,
    paidDate: string
  ): 'none' | 'maternity' | 'childcare' {
    const paidMonth = paidDate.substring(0, 7); // 'YYYY-MM'
    const paidMonthEnd = this.getMonthEnd(paidDate); // 月末日

    for (const leave of leaves) {
      const startMonth = leave.startDate.substring(0, 7);
      const endMonth = leave.endDate.substring(0, 7);

      // 産前産後休業：支払月が免除月に当たるか
      if (leave.type === 'maternity') {
        if (paidMonth >= startMonth && paidMonth <= endMonth) {
          return 'maternity';
        }
      }

      // 育児休業：支払月の末日を含んで連続1か月を超えるか
      if (leave.type === 'childcare') {
        const leaveEndNext = this.getNextDay(leave.endDate); // 終了日の翌日
        const leaveEndNextMonth = leaveEndNext.substring(0, 7);

        // 支払月の末日を含む育児休業かを判定
        if (leave.startDate <= paidMonthEnd && leaveEndNext > paidDate.substring(0, 10)) {
          // 開始日から次の月末日までの期間に支払月の末日が含まれるか
          const startToEndDays = this.daysBetween(leave.startDate, leave.endDate);
          if (startToEndDays > 30) {
            // 1か月を超える
            return 'childcare';
          }
        }
      }
    }

    return 'none';
  }

  /**
   * 与えられた月の末日を取得
   * @param dateStr 日付 ('YYYY-MM-DD')
   * @returns その月の末日 ('YYYY-MM-DD')
   */
  private getMonthEnd(dateStr: string): string {
    const [year, month] = dateStr.substring(0, 7).split('-').map(Number);
    const nextMonth = new Date(year, month, 0); // 月の最後の日
    const day = nextMonth.getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * 日付の翌日を取得
   * @param dateStr 日付 ('YYYY-MM-DD')
   * @returns 翌日 ('YYYY-MM-DD')
   */
  private getNextDay(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    const nextDate = new Date(date.getTime() + 86400000); // 1日足す
    const year = nextDate.getUTCFullYear();
    const month = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 2つの日付の間の日数を計算
   * @param startDate 開始日
   * @param endDate 終了日
   * @returns 日数
   */
  private daysBetween(startDate: string, endDate: string): number {
    const start = new Date(startDate + 'T00:00:00Z').getTime();
    const end = new Date(endDate + 'T00:00:00Z').getTime();
    return Math.floor((end - start) / 86400000) + 1; // 開始日を含める
  }
}
