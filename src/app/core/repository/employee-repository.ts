// 従業員と、計算に使うサブコレクションの読み込み（設計書 4章 employees）
import { Service } from '@angular/core';
import {
  arrayUnion,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { monthOf } from '../calc/date';
import { LeaveInput, StandardInput } from '../calc/employee-edit';
import { NewEmployeeInput } from '../calc/new-employee';
import { InsuredTypeHistory } from '../calc/insured-type';
import { Dependent, DependentInput } from '../calc/dependent';
import { db } from '../firebase';
import { Exemption, Leave, Qualification } from '../calc/eligibility';
import { EmployeeData, StandardHistory } from '../calc/employee-month';
import { Assignment } from '../calc/office';
import { employeeSubCol, siCol, siDoc } from '../firestore-paths';

/** 一覧に表示する項目を加えた従業員データ */
export type EmployeeRecord = EmployeeData & {
  employeeNumber: string;
  name: string;
};

/** Firestore のドキュメントIDつき */
export type WithId<T> = T & { id: string };

/** 詳細画面で使う、サブコレクションのIDつきの従業員データ */
export type EmployeeDetail = {
  id: string;
  employeeNumber: string;
  name: string;
  birthDate: string;
  qualifications: WithId<Qualification & { lostReason: string | null }>[];
  leaves: WithId<Leave>[];
  exemptions: WithId<Exemption>[];
  assignments: WithId<Assignment>[];
  standardHistory: WithId<StandardHistory & { reason: string; remuneration: number | null }>[];
  insuredTypes: WithId<InsuredTypeHistory>[];
  dependents: WithId<Dependent>[];
};

@Service()
export class EmployeeRepository {
  /**
   * 全従業員と、計算に使うサブコレクションを読む
   *
   * TODO: 担当範囲（siScope）が特定の事業所の担当者は、officeIds で絞り込んだクエリにする
   */
  async loadAll(): Promise<EmployeeRecord[]> {
    const snap = await getDocs(siCol('employees'));
    return Promise.all(snap.docs.map((d) => this.loadOne(d.id, d.data())));
  }

  /**
   * 従業員を新しく登録する
   *
   * 従業員本体と所属事業所、加入する人はさらに最初の資格の期間と標準報酬月額（資格取得時決定）を、
   * まとめて1回で書き込む。途中で失敗しても、一部だけが登録されることはない。
   *
   * @param input 入力（チェック済み）
   * @param today 今日 'YYYY-MM-DD'。未加入の人の所属事業所の開始日に使う
   * @returns 登録した従業員のID
   */
  async create(input: NewEmployeeInput, today: string): Promise<string> {
    const ref = doc(siCol('employees'));
    const batch = writeBatch(db);
    batch.set(ref, {
      employeeNumber: input.employeeNumber.trim(),
      name: input.name.trim(),
      birthDate: input.birthDate,
      officeIds: [input.officeId],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(employeeSubCol(ref.id, 'assignments')), {
      validFrom: input.insured ? input.acquiredDate : today,
      officeId: input.officeId,
    });
    if (input.insured) {
      batch.set(doc(employeeSubCol(ref.id, 'qualifications')), {
        acquiredDate: input.acquiredDate,
        lostDate: null,
        lostReason: null,
      });
      batch.set(doc(employeeSubCol(ref.id, 'insuredTypes')), {
        validFrom: input.acquiredDate,
        type: input.insuredType ?? 'general',
      });
      batch.set(doc(employeeSubCol(ref.id, 'standardRemunerations')), {
        validFrom: monthOf(input.acquiredDate),
        reason: 'acquisition',
        remuneration: input.remuneration,
        healthStandard: input.healthStandard,
        pensionStandard: input.pensionStandard,
      });
    }
    await batch.commit();
    return ref.id;
  }

  /** 詳細画面用に、1人分をサブコレクションのIDつきで読む。いなければ null */
  async loadDetail(id: string): Promise<EmployeeDetail | null> {
    const snap = await getDoc(siDoc('employees', id));
    if (!snap.exists()) return null;
    const d = snap.data();
    const withId = async <T>(name: string, map: (d: DocumentData) => T): Promise<WithId<T>[]> => {
      const s = await getDocs(employeeSubCol(id, name));
      return s.docs.map((x) => ({ ...map(x.data()), id: x.id }));
    };
    const [qualifications, leaves, exemptions, assignments, standardHistory, insuredTypes, dependents] = await Promise.all([
      withId('qualifications', (x) => ({ ...toQualification(x), lostReason: x['lostReason'] ?? null })),
      withId('leaves', toLeave),
      withId('exemptions', toExemption),
      withId('assignments', toAssignment),
      withId('standardRemunerations', (x) => ({
        ...toStandard(x),
        reason: x['reason'] ?? '',
        remuneration: x['remuneration'] ?? null,
      })),
      withId('insuredTypes', toInsuredType),
      withId('dependents', toDependent),
    ]);
    return {
      id,
      employeeNumber: d['employeeNumber'] ?? '',
      name: d['name'] ?? '',
      birthDate: d['birthDate'],
      qualifications,
      leaves,
      exemptions,
      assignments,
      standardHistory,
      insuredTypes,
      dependents,
    };
  }

  /** 被保険者区分を変える（変わった日から） */
  async addInsuredType(employeeId: string, input: InsuredTypeHistory) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'insuredTypes')), input);
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 加入中の資格の期間を閉じる（退職・その他の理由での喪失） */
  async closeQualification(
    employeeId: string,
    qualificationId: string,
    lostDate: string,
    lostReason: string,
    dependentIds: string[] = [],
  ) {
    const batch = writeBatch(db);
    batch.update(doc(employeeSubCol(employeeId, 'qualifications'), qualificationId), { lostDate, lostReason });
    // 資格を失った日に、扶養中の被扶養者も扶養から外れる
    for (const id of dependentIds) batch.update(doc(employeeSubCol(employeeId, 'dependents'), id), { removedDate: lostDate });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 被扶養者を足す */
  async addDependent(employeeId: string, input: DependentInput) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'dependents')), {
      name: input.name.trim(),
      birthDate: input.birthDate,
      certifiedDate: input.certifiedDate,
      removedDate: null,
    });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 被扶養者を扶養から外す */
  async removeDependent(employeeId: string, dependentId: string, removedDate: string) {
    const batch = writeBatch(db);
    batch.update(doc(employeeSubCol(employeeId, 'dependents'), dependentId), { removedDate });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 再加入（新しい資格の期間を足す） */
  async addQualification(employeeId: string, acquiredDate: string) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'qualifications')), { acquiredDate, lostDate: null, lostReason: null });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 異動：所属事業所の履歴と、異動日からの標準報酬月額をまとめて足す */
  async addTransfer(
    employeeId: string,
    transferDate: string,
    officeId: string,
    standard: { healthStandard: number; pensionStandard: number },
  ) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'assignments')), { validFrom: transferDate, officeId });
    batch.set(doc(employeeSubCol(employeeId, 'standardRemunerations')), {
      validFrom: monthOf(transferDate),
      reason: 'acquisition',
      healthStandard: standard.healthStandard,
      pensionStandard: standard.pensionStandard,
    });
    batch.update(siDoc('employees', employeeId), { officeIds: arrayUnion(officeId), updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 標準報酬月額の履歴を足す */
  async addStandard(employeeId: string, input: StandardInput, remuneration: number | null) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'standardRemunerations')), { ...input, remuneration });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 適用除外を足す（日付は届出に書く該当年月日・非該当年月日） */
  async addExemption(employeeId: string, input: { type: Exemption['type']; startDate: string; endDate: string }) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'exemptions')), {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate === '' ? null : input.endDate,
    });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 適用除外の非該当年月日を入れる・直す */
  async updateExemptionEnd(employeeId: string, exemptionId: string, endDate: string) {
    const batch = writeBatch(db);
    batch.update(doc(employeeSubCol(employeeId, 'exemptions'), exemptionId), { endDate: endDate === '' ? null : endDate });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 休業を足す */
  async addLeave(employeeId: string, input: LeaveInput) {
    const batch = writeBatch(db);
    batch.set(doc(employeeSubCol(employeeId, 'leaves')), {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate === '' ? null : input.endDate,
      workedDays: input.workedDays,
    });
    batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
    await batch.commit();
  }

  /** 休業の終了日・就業した日数を変える（延長・短縮・復帰） */
  async updateLeave(employeeId: string, leaveId: string, endDate: string, workedDays: number | null) {
    await updateDoc(doc(employeeSubCol(employeeId, 'leaves'), leaveId), {
      endDate: endDate === '' ? null : endDate,
      workedDays,
    });
    await this.touch(employeeId);
  }

  private async touch(employeeId: string) {
    await updateDoc(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
  }

  private async loadOne(id: string, d: DocumentData): Promise<EmployeeRecord> {
    const [qualifications, leaves, exemptions, assignments, standardHistory, insuredTypes, dependents] = await Promise.all([
      this.sub(id, 'qualifications', toQualification),
      this.sub(id, 'leaves', toLeave),
      this.sub(id, 'exemptions', toExemption),
      this.sub(id, 'assignments', toAssignment),
      this.sub(id, 'standardRemunerations', toStandard),
      this.sub(id, 'insuredTypes', toInsuredType),
      this.sub(id, 'dependents', toDependent),
    ]);
    return {
      id,
      employeeNumber: d['employeeNumber'] ?? '',
      name: d['name'] ?? '',
      birthDate: d['birthDate'],
      qualifications,
      leaves,
      exemptions,
      assignments,
      standardHistory,
      insuredTypes,
      dependents,
    };
  }

  private async sub<T>(id: string, name: string, map: (d: DocumentData) => T): Promise<T[]> {
    const snap = await getDocs(employeeSubCol(id, name));
    return snap.docs.map((x) => map(x.data()));
  }
}

function toDependent(d: DocumentData): Dependent {
  return { name: d['name'] ?? '', birthDate: d['birthDate'], certifiedDate: d['certifiedDate'], removedDate: d['removedDate'] ?? null };
}

function toInsuredType(d: DocumentData): InsuredTypeHistory {
  return { validFrom: d['validFrom'], type: d['type'] ?? 'general' };
}

function toQualification(d: DocumentData): Qualification {
  return { acquiredDate: d['acquiredDate'], lostDate: d['lostDate'] ?? null };
}

function toLeave(d: DocumentData): Leave {
  return {
    type: d['type'],
    startDate: d['startDate'],
    endDate: d['endDate'] ?? null,
    workedDays: d['workedDays'] ?? null,
  };
}

function toExemption(d: DocumentData): Exemption {
  return { type: d['type'], startDate: d['startDate'], endDate: d['endDate'] ?? null };
}

function toAssignment(d: DocumentData): Assignment {
  return { validFrom: d['validFrom'], officeId: d['officeId'] };
}

function toStandard(d: DocumentData): StandardHistory {
  return {
    validFrom: d['validFrom'],
    healthStandard: d['healthStandard'],
    pensionStandard: d['pensionStandard'],
    remuneration: d['remuneration'] ?? null,
    ownRemuneration: d['ownRemuneration'] ?? null,
    totalRemuneration: d['totalRemuneration'] ?? null,
    selectedInsurerId: d['selectedInsurerId'] ?? null,
  };
}
