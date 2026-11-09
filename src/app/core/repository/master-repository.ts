// マスタ（適用事業所・保険者・料率）の読み込み（設計書 4章 マスタ）
import { Service } from '@angular/core';
import { DocumentData, getDocs } from 'firebase/firestore';
import { Masters } from '../calc/employee-month';
import { GradeRow } from '../calc/grade-suggest';
import { Office } from '../calc/office';
import type { Insurer, InsurerRate, PensionRate } from '../calc/rate';
import { GradeThreshold } from '../calc/revision';
import { EligibilityRule } from '../calc/eligibility-check';
import { siCol } from '../firestore-paths';

@Service()
export class MasterRepository {
  /** 月次の計算に使うマスタをまとめて読む */
  async loadMasters(): Promise<Masters> {
    const [offices, insurers, insurerRates, pensionRates] = await Promise.all([
      this.readAll('offices', toOffice),
      this.readAll('insurers', toInsurer),
      this.readAll('insurerRates', toInsurerRate),
      this.readAll('pensionRates', toPensionRate),
    ]);
    return { offices, insurers, insurerRates, pensionRates };
  }

  /** 協会けんぽの保険料額表の等級（標準報酬月額の提案に使う） */
  async loadGrades(): Promise<GradeRow[]> {
    return this.readAll('grades', toGrade);
  }

  /** 加入対象の判定の基準（システム共通。設計書 2.24） */
  async loadEligibilityRules(): Promise<EligibilityRule[]> {
    return this.readAll('eligibilityRules', (_id, d) => ({
      validFrom: d['validFrom'],
      fullTimeRatio: d['fullTimeRatio'],
      weeklyHours: d['weeklyHours'],
      companySize: d['companySize'] ?? null,
      contractMonths: d['contractMonths'],
      studentExcluded: d['studentExcluded'] === true,
    }));
  }

  /** 最高等級・最低等級付近の特例の閾値（随時改定の判定に使う） */
  async loadGradeThresholds(): Promise<GradeThreshold[]> {
    return this.readAll('gradeThresholds', (_id, d) => ({
      validFrom: d['validFrom'],
      insuranceType: d['insuranceType'],
      maxGrade: d['maxGrade'],
      upper: d['upper'],
      lower: d['lower'],
      topLower: d['topLower'],
      secondLower: d['secondLower'],
    }));
  }

  private async readAll<T>(name: string, map: (id: string, d: DocumentData) => T): Promise<T[]> {
    const snap = await getDocs(siCol(name));
    return snap.docs.map((d) => map(d.id, d.data()));
  }
}

function toOffice(id: string, d: DocumentData): Office {
  return {
    id,
    name: d['name'],
    prefecture: d['prefecture'] ?? '',
    insurerId: d['insurerId'],
    isDefault: d['isDefault'] === true,
    archived: d['archived'] === true,
  };
}

function toInsurer(id: string, d: DocumentData): Insurer {
  return {
    id,
    type: d['type'],
    name: d['name'],
    specialInsuredEnabled: d['specialInsuredEnabled'] ?? false,
    archived: d['archived'] === true,
  };
}

function toInsurerRate(_id: string, d: DocumentData): InsurerRate {
  return {
    insurerId: d['insurerId'],
    rateType: d['rateType'],
    prefecture: d['prefecture'] ?? null,
    validFrom: d['validFrom'],
    rate: d['rate'],
    employeeShare: d['employeeShare'],
  };
}

function toPensionRate(_id: string, d: DocumentData): PensionRate {
  return { validFrom: d['validFrom'], rate: d['rate'], employeeShare: d['employeeShare'] };
}

function toGrade(_id: string, d: DocumentData): GradeRow {
  return {
    validFrom: d['validFrom'],
    healthGrade: d['healthGrade'],
    pensionGrade: d['pensionGrade'] ?? null,
    lowerLimit: d['lowerLimit'],
    upperLimit: d['upperLimit'] ?? null,
    standardAmount: d['standardAmount'],
  };
}
