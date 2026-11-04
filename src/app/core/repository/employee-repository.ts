// 従業員と、計算に使うサブコレクションの読み込み（設計書 4章 employees）
import { Auth } from '../auth/auth';
import { employeeScopeWhere } from './scope';
import { Absence, AbsenceInput } from '../calc/absence';
import { DependentToImport, EmployeeToImport } from '../calc/master-import';
import { inject, Service } from '@angular/core';
import {
  arrayUnion,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { monthOf } from '../calc/date';
import { LeaveInput, StandardInput } from '../calc/employee-edit';
import { BreakdownKey, breakdownTotal, isValidDate, NewEmployeeInput, normalizeBreakdown, RemunerationBreakdown } from '../calc/new-employee';
import { StoredEligibility } from '../calc/eligibility-check';
import { ManualWageChange } from '../calc/salary';
import type { DecisionToSave } from '../calc/decision-import';
import { InsuredTypeHistory } from '../calc/insured-type';
import { Dependent, DependentCareExemption, DependentInput } from '../calc/dependent';
import { LEGACY_GROUP_ID, PayrollAssignment } from '../calc/payroll-group';
import { db } from '../firebase';
import { Exemption, Leave, Qualification } from '../calc/eligibility';
import { EmployeeData, StandardHistory } from '../calc/employee-month';
import { Assignment } from '../calc/office';
import { employeeSubCol, siCol, siDoc } from '../firestore-paths';
import { TimedCache } from './timed-cache';
import { mapWithConcurrency } from './concurrency';

/** 一覧に表示する項目を加えた従業員データ */
export type EmployeeRecord = EmployeeData & {
  employeeNumber: string;
  name: string;
  /** 入社時の加入対象の判定（設計書 2.24）。判定せずに登録した人は null */
  eligibility?: StoredEligibility | null;
  /** 担当者が「固定的賃金の変動として登録」した変動（設計書 2.13） */
  fixedWageChanges?: ManualWageChange[];
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
  standardHistory: WithId<StandardHistory & { reason: string; remuneration: number | null; remunerationBreakdown?: Record<BreakdownKey, number> | null }>[];
  insuredTypes: WithId<InsuredTypeHistory>[];
  dependents: WithId<Dependent>[];
  payrollAssignments: WithId<PayrollAssignment>[];
  absences: WithId<Absence>[];
  eligibility?: StoredEligibility | null;
};

/**
 * 従業員の一覧を同時に読む人数（1人10回なので、同時に約200回の問い合わせ）
 * 本番で300人を読んだ時間（2026-11-02）：全員を同時 → Too many outstanding requests で読めない／10人ずつ → 5.8秒／20人ずつ → 2.8秒
 */
export const EMPLOYEE_LOAD_CONCURRENCY = 20;

/** 従業員の一覧を使い回す時間（5分） */
export const EMPLOYEE_CACHE_MS = 5 * 60 * 1000;

@Service()
export class EmployeeRepository {
  private readonly auth = inject(Auth);

  /**
   * 全従業員と、計算に使うサブコレクションを読む
   *
   * 特定の事業所の担当者は、これまでにその事業所に所属した人だけ（ルールでも制限する）
   */
  /**
   * 従業員の一覧（担当範囲の全員と、資格・所属・標準報酬月額などの履歴）
   *
   * 1人につき10種類の履歴を読むため、300人では1回に約3,000回の問い合わせになる。
   * 画面を移るたびに読み直さないよう、読み込んだ一覧を EMPLOYEE_CACHE_MS のあいだ使い回す。
   * この画面（タブ）で登録・変更したときは、すぐに捨てて読み直す。ほかの担当者の変更は、時間がたつと反映される。
   * 返した一覧は複数の画面で共有するので、書き換えないこと。
   */
  loadAll(): Promise<EmployeeRecord[]> {
    const u = this.auth.user();
    return this.cache.get(`${u?.uid ?? ''}|${u?.siScope ?? ''}`, () => this.fetchAll());
  }

  /** 使い回している一覧を捨てる（次の loadAll で読み直す） */
  clearCache(): void {
    this.cache.clear();
  }

  private readonly cache = new TimedCache<EmployeeRecord[]>(EMPLOYEE_CACHE_MS);

  private async fetchAll(): Promise<EmployeeRecord[]> {
    const started = performance.now();
    const snap = await getDocs(query(siCol('employees'), ...employeeScopeWhere(this.auth)));
    // 1人につき10回の問い合わせになるので、一度に全員分を送らず、EMPLOYEE_LOAD_CONCURRENCY 人ずつ読む
    // （300人分を一度に送ると、本番で「Too many outstanding requests」になって読めなかった）
    const list = await mapWithConcurrency(snap.docs, EMPLOYEE_LOAD_CONCURRENCY, (d) => this.loadOne(d.id, d.data()));
    // 人数が多いときの読み込みの時間を確かめるため、コンソールに出す（F12 → コンソール）
    console.info(`[従業員の読み込み] ${list.length}人・問い合わせ ${1 + list.length * 10}回・${Math.round(performance.now() - started)}ms`);
    return list;
  }

  /** 書き込みの前と後に、使い回している一覧を捨てる（書き込み中に読んだ古い一覧も残さない） */
  private async write<T>(action: () => Promise<T>): Promise<T> {
    this.cache.clear();
    try {
      return await action();
    } finally {
      this.cache.clear();
    }
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
    return this.write(async () => {
      const ref = doc(siCol('employees'));
      const batch = writeBatch(db);
      batch.set(ref, {
        employeeNumber: input.employeeNumber.trim(),
        name: input.name.trim(),
        birthDate: input.birthDate,
        officeIds: [input.officeId],
        eligibility: input.eligibilityResult ? { ...input.eligibility, ...input.eligibilityResult } : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // 支払区分（登録した区分を選んだときだけ。既定の区分なら履歴なしでよい）
      if (input.payrollGroupId && input.payrollGroupId !== LEGACY_GROUP_ID) {
        batch.set(doc(employeeSubCol(ref.id, 'payrollAssignments')), {
          validFrom: isValidDate(input.acquiredDate) ? input.acquiredDate : today,
          payrollGroupId: input.payrollGroupId,
        });
      }
      // 未加入の人も、入社日から所属する（労働時間を見続ける）
      batch.set(doc(employeeSubCol(ref.id, 'assignments')), {
        validFrom: isValidDate(input.acquiredDate) ? input.acquiredDate : today,
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
          remuneration: breakdownTotal(input.breakdown),
          remunerationBreakdown: normalizeBreakdown(input.breakdown),
          healthStandard: input.healthStandard,
          pensionStandard: input.pensionStandard,
        });
        // 被扶養者も同じ書き込みで登録する（本人だけ登録されて、被扶養者が漏れることがない）
        for (const d of input.dependents ?? []) {
          batch.set(doc(employeeSubCol(ref.id, 'dependents')), {
            name: d.name.trim(),
            birthDate: d.birthDate,
            certifiedDate: d.certifiedDate || input.acquiredDate,
            removedDate: null,
          });
        }
      }
      await batch.commit();
      return ref.id;
    });
  }

  /**
   * CSVで取り込んだ従業員をまとめて登録する（導入時。設計書 3.8）
   * 標準報酬月額は、標準報酬月額のCSVで別に取り込む。1人分は1回の書き込みにまとめ、途中で失敗しても一部だけにならない
   */
  async importEmployees(list: EmployeeToImport[]): Promise<void> {
    return this.write(async () => {
      for (let i = 0; i < list.length; i += 50) {
        const batch = writeBatch(db);
        for (const x of list.slice(i, i + 50)) {
          const ref = doc(siCol('employees'));
          batch.set(ref, {
            employeeNumber: x.employeeNumber, name: x.name, birthDate: x.birthDate, officeIds: [x.officeId],
            eligibility: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          batch.set(doc(employeeSubCol(ref.id, 'assignments')), { validFrom: x.startDate, officeId: x.officeId });
          if (x.payrollGroupId) batch.set(doc(employeeSubCol(ref.id, 'payrollAssignments')), { validFrom: x.startDate, payrollGroupId: x.payrollGroupId });
          if (x.acquiredDate) {
            batch.set(doc(employeeSubCol(ref.id, 'qualifications')), { acquiredDate: x.acquiredDate, lostDate: null, lostReason: null });
            batch.set(doc(employeeSubCol(ref.id, 'insuredTypes')), { validFrom: x.acquiredDate, type: x.insuredType });
          }
        }
        await batch.commit();
      }
    });
  }

  /** CSVで取り込んだ被扶養者をまとめて登録する（導入時。設計書 3.8） */
  async importDependents(list: DependentToImport[]): Promise<void> {
    return this.write(async () => {
      for (let i = 0; i < list.length; i += 200) {
        const batch = writeBatch(db);
        const touched = new Set<string>();
        for (const { employeeId, ...d } of list.slice(i, i + 200)) {
          batch.set(doc(employeeSubCol(employeeId, 'dependents')), d);
          touched.add(employeeId);
        }
        for (const id of touched) batch.update(siDoc('employees', id), { updatedAt: serverTimestamp() });
        await batch.commit();
      }
    });
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
    const [qualifications, leaves, exemptions, assignments, standardHistory, insuredTypes, dependents, payrollAssignments, absences] = await Promise.all([
      withId('qualifications', (x) => ({ ...toQualification(x), lostReason: x['lostReason'] ?? null })),
      withId('leaves', toLeave),
      withId('exemptions', toExemption),
      withId('assignments', toAssignment),
      withId('standardRemunerations', (x) => ({
        ...toStandard(x),
        reason: x['reason'] ?? '',
        remuneration: x['remuneration'] ?? null,
        remunerationBreakdown: x['remunerationBreakdown'] ?? null,
      })),
      withId('insuredTypes', toInsuredType),
      withId('dependents', toDependent),
      withId('payrollAssignments', toPayrollAssignment),
      withId('absences', toAbsence),
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
      payrollAssignments,
      absences,
      eligibility: d['eligibility'] ?? null,
    };
  }

  /** 支払区分を変える（変わった日から） */
  async addPayrollAssignment(employeeId: string, input: PayrollAssignment) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'payrollAssignments')), input);
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 固定的賃金の変動として登録する（同じ月は1件。ドキュメントIDは変動月） */
  async setFixedWageChange(employeeId: string, change: ManualWageChange) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'fixedWageChanges'), change.yearMonth), change);
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 登録した固定的賃金の変動を取り消す */
  async removeFixedWageChange(employeeId: string, yearMonth: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.delete(doc(employeeSubCol(employeeId, 'fixedWageChanges'), yearMonth));
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被保険者区分を変える（変わった日から） */
  async addInsuredType(employeeId: string, input: InsuredTypeHistory) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'insuredTypes')), input);
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 加入中の資格の期間を閉じる（退職・その他の理由での喪失） */
  async closeQualification(
    employeeId: string,
    qualificationId: string,
    lostDate: string,
    lostReason: string,
    dependentIds: string[] = [],
  ) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'qualifications'), qualificationId), { lostDate, lostReason });
      // 資格を失った日に、扶養中の被扶養者も扶養から外れる
      for (const id of dependentIds) batch.update(doc(employeeSubCol(employeeId, 'dependents'), id), { removedDate: lostDate });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 氏名を変える（結婚などで変わったとき・登録の誤りを直すとき）。確定済みの月の記録は、確定したときの氏名のまま */
  async updateName(employeeId: string, name: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(siDoc('employees', employeeId), { name: name.trim(), updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /**
   * 社員番号を変える（番号の付け替え・登録の誤りを直すとき）
   * 給与・賞与などの記録は従業員ID（社員番号ではない）で結びついているので、書き換えは従業員の文書だけで済む。
   * 確定済みの月の記録は、確定したときの社員番号のまま
   */
  async updateEmployeeNumber(employeeId: string, employeeNumber: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(siDoc('employees', employeeId), { employeeNumber, updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被扶養者を足す */
  async addDependent(employeeId: string, input: DependentInput) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'dependents')), {
        name: input.name.trim(),
        birthDate: input.birthDate,
        certifiedDate: input.certifiedDate,
        removedDate: null,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被扶養者の介護保険の適用除外の期間を、まとめて書き換える（追加・非該当年月日の登録） */
  async setDependentCareExemptions(employeeId: string, dependentId: string, careExemptions: DependentCareExemption[]) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'dependents'), dependentId), { careExemptions });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被扶養者を扶養から外す */
  async removeDependent(employeeId: string, dependentId: string, removedDate: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'dependents'), dependentId), { removedDate });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 同月得喪の、厚生年金保険料の還付の状態を変える */
  async setRefundStatus(employeeId: string, qualificationId: string, refundStatus: 'pending' | 'returned' | 'none') {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'qualifications'), qualificationId), { refundStatus });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 再加入（新しい資格の期間を足す） */
  async addQualification(employeeId: string, acquiredDate: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'qualifications')), { acquiredDate, lostDate: null, lostReason: null });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 異動：所属事業所の履歴と、異動日からの標準報酬月額をまとめて足す */
  async addTransfer(
    employeeId: string,
    transferDate: string,
    officeId: string,
    standard: { healthStandard: number; pensionStandard: number },
  ) {
    return this.write(async () => {
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
    });
  }

  /** 標準報酬月額の履歴を足す */
  /** 標準報酬月額を足す。資格取得時決定で内訳を入れたときは、内訳も参考として保存する */
  async addStandard(employeeId: string, input: StandardInput, remuneration: number | null, breakdown: RemunerationBreakdown | null = null) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'standardRemunerations')), {
        ...input,
        provisional: input.provisional === true,
        remuneration,
        remunerationBreakdown: breakdown ? normalizeBreakdown(breakdown) : null,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 通知書待ちの履歴を、通知書の値で直して確定する（通知書待ちを外す） */
  async confirmStandard(employeeId: string, standardId: string, healthStandard: number, pensionStandard: number) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'standardRemunerations'), standardId), { healthStandard, pensionStandard, provisional: false });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /**
   * 決定通知書の取り込み（設計書 2.13.2）。通知書待ちの履歴は通知書の値で直し、ないものは新しく足す。
   * 1回の書き込みは500件までなので分けて書く
   */
  async saveDecisions(items: DecisionToSave[]) {
    return this.write(async () => {
      for (let i = 0; i < items.length; i += 200) {
        const batch = writeBatch(db);
        for (const x of items.slice(i, i + 200)) {
          if (x.provisionalId) {
            batch.update(doc(employeeSubCol(x.employeeId, 'standardRemunerations'), x.provisionalId), {
              healthStandard: x.healthStandard, pensionStandard: x.pensionStandard, provisional: false,
            });
          } else {
            batch.set(doc(employeeSubCol(x.employeeId, 'standardRemunerations')), {
              validFrom: x.validFrom, reason: x.reason, healthStandard: x.healthStandard, pensionStandard: x.pensionStandard,
              remuneration: null, provisional: false, ownRemuneration: null, totalRemuneration: null, selectedInsurerId: null,
            });
          }
          batch.update(siDoc('employees', x.employeeId), { updatedAt: serverTimestamp() });
        }
        await batch.commit();
      }
    });
  }

  /** 適用除外を足す（日付は届出に書く該当年月日・非該当年月日） */
  async addExemption(employeeId: string, input: { type: Exemption['type']; startDate: string; endDate: string }) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'exemptions')), {
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 適用除外の非該当年月日を入れる・直す */
  async updateExemptionEnd(employeeId: string, exemptionId: string, endDate: string) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.update(doc(employeeSubCol(employeeId, 'exemptions'), exemptionId), { endDate: endDate === '' ? null : endDate });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 休業を足す */
  async addLeave(employeeId: string, input: LeaveInput) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'leaves')), {
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
        workedDays: input.workedDays,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 休業の終了日・就業した日数を変える（延長・短縮・復帰） */
  async updateLeave(employeeId: string, leaveId: string, endDate: string, workedDays: number | null) {
    return this.write(async () => {
      await updateDoc(doc(employeeSubCol(employeeId, 'leaves'), leaveId), {
        endDate: endDate === '' ? null : endDate,
        workedDays,
      });
      await this.touch(employeeId);
    });
  }

  /** 休職を足す（設計書 2.26） */
  async addAbsence(employeeId: string, input: AbsenceInput) {
    return this.write(async () => {
      const batch = writeBatch(db);
      batch.set(doc(employeeSubCol(employeeId, 'absences')), {
        reason: input.reason,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 休職の期間を変える（延長・復職） */
  async updateAbsence(employeeId: string, absenceId: string, input: AbsenceInput) {
    return this.write(async () => {
      await updateDoc(doc(employeeSubCol(employeeId, 'absences'), absenceId), {
        reason: input.reason,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
      });
      await this.touch(employeeId);
    });
  }

  private async touch(employeeId: string) {
    await updateDoc(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
  }

  private async loadOne(id: string, d: DocumentData): Promise<EmployeeRecord> {
    const [qualifications, leaves, exemptions, assignments, standardHistory, insuredTypes, dependents, payrollAssignments, fixedWageChanges, absences] = await Promise.all([
      this.sub(id, 'qualifications', toQualification),
      this.sub(id, 'leaves', toLeave),
      this.sub(id, 'exemptions', toExemption),
      this.sub(id, 'assignments', toAssignment),
      this.subWithId(id, 'standardRemunerations', toStandard),
      this.sub(id, 'insuredTypes', toInsuredType),
      this.sub(id, 'dependents', toDependent),
      this.sub(id, 'payrollAssignments', toPayrollAssignment),
      this.sub(id, 'fixedWageChanges', (x): ManualWageChange => ({ yearMonth: x['yearMonth'], direction: x['direction'], note: x['note'] ?? '' })),
      this.sub(id, 'absences', toAbsence),
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
      payrollAssignments,
      eligibility: d['eligibility'] ?? null,
      fixedWageChanges,
      absences,
    };
  }

  private async subWithId<T>(id: string, name: string, map: (d: DocumentData) => T): Promise<(T & { id: string })[]> {
    const snap = await getDocs(employeeSubCol(id, name));
    return snap.docs.map((x) => ({ ...map(x.data()), id: x.id }));
  }

  private async sub<T>(id: string, name: string, map: (d: DocumentData) => T): Promise<T[]> {
    const snap = await getDocs(employeeSubCol(id, name));
    return snap.docs.map((x) => map(x.data()));
  }
}

function toPayrollAssignment(d: DocumentData): PayrollAssignment {
  return { validFrom: d['validFrom'], payrollGroupId: d['payrollGroupId'] };
}

function toDependent(d: DocumentData): Dependent {
  return {
    name: d['name'] ?? '',
    birthDate: d['birthDate'],
    certifiedDate: d['certifiedDate'],
    removedDate: d['removedDate'] ?? null,
    careExemptions: ((d['careExemptions'] ?? []) as DocumentData[]).map((x) => ({ startDate: x['startDate'], endDate: x['endDate'] ?? null })),
  };
}

function toInsuredType(d: DocumentData): InsuredTypeHistory {
  return { validFrom: d['validFrom'], type: d['type'] ?? 'general' };
}

function toQualification(d: DocumentData): Qualification {
  return {
    acquiredDate: d['acquiredDate'],
    lostDate: d['lostDate'] ?? null,
    lostReason: d['lostReason'] ?? null,
    refundStatus: d['refundStatus'] ?? null,
  };
}

function toLeave(d: DocumentData): Leave {
  return {
    type: d['type'],
    startDate: d['startDate'],
    endDate: d['endDate'] ?? null,
    workedDays: d['workedDays'] ?? null,
  };
}

function toAbsence(d: DocumentData): Absence {
  return { reason: d['reason'] ?? 'other', startDate: d['startDate'], endDate: d['endDate'] ?? null };
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
    provisional: d['provisional'] === true,
    healthStandard: d['healthStandard'],
    pensionStandard: d['pensionStandard'],
    remuneration: d['remuneration'] ?? null,
    ownRemuneration: d['ownRemuneration'] ?? null,
    totalRemuneration: d['totalRemuneration'] ?? null,
    selectedInsurerId: d['selectedInsurerId'] ?? null,
  };
}
