// 従業員と、計算に使うサブコレクションの読み込み（設計書 4章 employees）
import { Auth } from '../auth/auth';
import { employeeScopeWhere } from './scope';
import { Absence, AbsenceInput } from '../calc/absence';
import { DependentToImport, EmployeeToImport } from '../calc/master-import';
import { inject, Service } from '@angular/core';
import {
  addDoc,
  arrayUnion,
  doc,
  limit,
  orderBy,
  Timestamp,
  DocumentData,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { monthOf } from '../calc/date';
import { dateLabel, yearMonthLabel } from '../calc/year-month';
import { LeaveInput, StandardInput } from '../calc/employee-edit';
import { BreakdownKey, breakdownTotal, isValidDate, NewEmployeeInput, normalizeBreakdown, RemunerationBreakdown, standardReasonFor } from '../calc/new-employee';
import { onboardingFilings } from '../calc/filing';
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

/** 変更の記録（誰が・いつ・何を変えたか。設計書 3.1・4章 changeLogs） */
export type ChangeLog = { id: string; at: Date | null; by: string; text: string };

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

/**
 * 社員番号がすでに使われている（ほかの担当者が同時に登録した・担当外の事業所の人が使っている）。
 * numbers は使われていた社員番号
 */
export class EmployeeNumberTakenError extends Error {
  constructor(readonly numbers: string[]) {
    super(`employee number taken: ${numbers.join(',')}`);
  }
}

/** 社員番号ごとの記録（employeeNumbers/{社員番号}）。社員番号を、保存の時点でも重ならないようにする（設計書 4章） */
function numberDoc(employeeNumber: string) {
  return siDoc('employeeNumbers', employeeNumber);
}

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

  /** 同じ書き込み（バッチ）の中で、変更の記録を1件足す */
  private logIn(batch: ReturnType<typeof writeBatch>, employeeId: string, text: string): void {
    batch.set(doc(employeeSubCol(employeeId, 'changeLogs')), { at: serverTimestamp(), by: this.auth.user()?.email ?? '', text });
  }

  /** withLog で渡された、次の書き込みに入れる変更の記録 */
  private pendingLog: { employeeId: string; text: string } | null = null;

  /**
   * 書き込みを始める。withLog の中なら、確定（commit）するときに変更の記録を同じ書き込みに入れる
   * （訂正・削除は成功したのに記録だけ残らない、ということが起きないように。設計書 3.1）
   */
  private newBatch(): ReturnType<typeof writeBatch> {
    const batch = writeBatch(db);
    const commit = batch.commit.bind(batch);
    batch.commit = async () => {
      const log = this.pendingLog;
      if (log) {
        this.logIn(batch, log.employeeId, log.text);
        this.pendingLog = null;
      }
      return commit();
    };
    return batch;
  }

  /**
   * 変更と、その変更の記録を同じ書き込みで残す（従業員の詳細での登録・訂正・削除。設計書 3.1）。
   * action の中の最初の書き込みに記録を入れる。記録を入れる書き込みがなかったとき（この従業員の書き込みでない操作）は、
   * 変更のあとに記録だけを書き、残せなかったら false を返す（画面で、記録を残せなかったことを知らせる）
   */
  async withLog(employeeId: string, text: string, action: () => Promise<unknown>): Promise<boolean> {
    this.pendingLog = { employeeId, text };
    try {
      await action();
    } catch (e) {
      this.pendingLog = null;
      throw e;
    }
    if (this.pendingLog === null) return true;
    this.pendingLog = null;
    try {
      await this.addChangeLog(employeeId, text);
      return true;
    } catch (e) {
      console.error('変更の記録を残せませんでした', e);
      return false;
    }
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
      const number = input.employeeNumber.trim();
      // 画面の一覧（担当範囲の人だけ・少し前に読んだもの）では分からない重なりを、社員番号ごとの記録で確かめる
      if ((await getDoc(numberDoc(number))).exists()) throw new EmployeeNumberTakenError([number]);
      const ref = doc(siCol('employees'));
      const batch = this.newBatch();
      // 同じ書き込みで社員番号の記録を作る。ほかの担当者が先に同じ番号で登録していれば、ルール（上書き禁止）で書き込み全体が失敗する
      batch.set(numberDoc(number), { employeeId: ref.id });
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
        const ob = input.onboarding ?? null;
        batch.set(
          doc(employeeSubCol(ref.id, 'standardRemunerations')),
          ob
            ? {
                // 導入時の登録：いちばん新しい決定通知書の額を、その適用開始月から（報酬月額の内訳はない）
                validFrom: ob.validFrom,
                reason: standardReasonFor(ob.validFrom, input.acquiredDate),
                remuneration: null,
                healthStandard: input.healthStandard,
                pensionStandard: input.pensionStandard,
              }
            : {
                validFrom: monthOf(input.acquiredDate),
                reason: 'acquisition',
                remuneration: breakdownTotal(input.breakdown),
                remunerationBreakdown: normalizeBreakdown(input.breakdown),
                healthStandard: input.healthStandard,
                pensionStandard: input.pensionStandard,
              },
        );
        // 被扶養者も同じ書き込みで登録する（本人だけ登録されて、被扶養者が漏れることがない）
        const deps = (input.dependents ?? []).map((d) => ({ name: d.name.trim(), birthDate: d.birthDate, certifiedDate: d.certifiedDate || input.acquiredDate }));
        for (const d of deps) {
          batch.set(doc(employeeSubCol(ref.id, 'dependents')), { ...d, removedDate: null });
        }
        // 導入時の登録：資格取得届・扶養に入った被扶養者異動届は導入前に届け出ているので、対応不要として記録する
        if (ob) {
          for (const f of onboardingFilings(ref.id, input.acquiredDate, input.officeId, deps)) {
            batch.set(siDoc('filings', f.id), {
              employeeId: f.employeeId, kind: f.kind, trigger: f.trigger, officeId: f.officeId,
              resolution: 'notNeeded', note: '導入時の登録（導入前に届出済み）', filedAt: serverTimestamp(), filedBy: this.auth.user()?.email ?? '',
            });
          }
        }
      }
      const man = (v: number | null) => `${((v ?? 0) / 10_000).toLocaleString('ja-JP')}万円`;
      this.logIn(
        batch,
        ref.id,
        input.insured
          ? `新規登録（${input.onboarding ? '導入時の登録・' : ''}資格取得日 ${dateLabel(input.acquiredDate)}・標準報酬月額${input.onboarding ? ` ${yearMonthLabel(input.onboarding.validFrom)}分から` : ''} 健保 ${man(input.healthStandard)}／厚年 ${man(input.pensionStandard)}` +
              `${input.dependents?.length ? `・被扶養者${input.dependents.length}人` : ''}）`
          : `新規登録（未加入・入社日 ${dateLabel(input.acquiredDate)}）`,
      );
      await this.commitNumbered(batch, [number]);
      return ref.id;
    });
  }

  /**
   * 社員番号の記録を含む書き込みを確定する。失敗したときに、その番号がほかの人に使われていれば EmployeeNumberTakenError にする
   * （同時に登録したときは、あとの書き込みがルールで拒否されるため）
   */
  private async commitNumbered(batch: ReturnType<typeof writeBatch>, numbers: string[]): Promise<void> {
    try {
      await batch.commit();
    } catch (e) {
      const taken: string[] = [];
      for (const n of numbers) if ((await getDoc(numberDoc(n)).catch(() => null))?.exists()) taken.push(n);
      if (taken.length > 0) throw new EmployeeNumberTakenError(taken);
      throw e;
    }
  }

  /**
   * 社員番号の記録がない従業員（この仕組みより前に登録した人）の記録を作る（全担当の管理者が一覧を開いたとき）。
   * すでにある記録・同じ社員番号の人が2人以上いる番号（前から重なっている）は作らない。作れた件数を返す
   */
  async fillNumberRecords(employees: { id: string; employeeNumber: string }[]): Promise<number> {
    const have = new Set((await getDocs(siCol('employeeNumbers'))).docs.map((d) => d.id));
    const count = new Map<string, number>();
    for (const e of employees) count.set(e.employeeNumber, (count.get(e.employeeNumber) ?? 0) + 1);
    const missing = employees.filter((e) => e.employeeNumber && !have.has(e.employeeNumber) && count.get(e.employeeNumber) === 1);
    for (let i = 0; i < missing.length; i += 400) {
      const batch = this.newBatch();
      for (const e of missing.slice(i, i + 400)) batch.set(numberDoc(e.employeeNumber), { employeeId: e.id });
      await batch.commit();
    }
    return missing.length;
  }

  /**
   * CSVで取り込んだ従業員をまとめて登録する（導入時。設計書 3.8）
   * 標準報酬月額は、標準報酬月額のCSVで別に取り込む。1人分は1回の書き込みにまとめ、途中で失敗しても一部だけにならない
   */
  async importEmployees(list: EmployeeToImport[]): Promise<void> {
    return this.write(async () => {
      // 取り込む前に、社員番号の記録と重なる番号がないかを確かめる（あれば何も登録しない）
      const have = new Set((await getDocs(siCol('employeeNumbers'))).docs.map((d) => d.id));
      const taken = list.map((x) => x.employeeNumber).filter((n) => have.has(n));
      if (taken.length > 0) throw new EmployeeNumberTakenError(taken);
      for (let i = 0; i < list.length; i += 50) {
        const batch = this.newBatch();
        const chunk = list.slice(i, i + 50);
        for (const x of chunk) {
          const ref = doc(siCol('employees'));
          batch.set(numberDoc(x.employeeNumber), { employeeId: ref.id });
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
          this.logIn(batch, ref.id, `CSVで登録（${x.acquiredDate ? `資格取得日 ${dateLabel(x.acquiredDate)}` : '未加入'}）`);
        }
        await this.commitNumbered(batch, chunk.map((x) => x.employeeNumber));
      }
    });
  }

  /** CSVで取り込んだ被扶養者をまとめて登録する（導入時。設計書 3.8） */
  async importDependents(list: DependentToImport[]): Promise<void> {
    return this.write(async () => {
      // 1回の書き込みは500件まで（被扶養者・変更の記録・従業員の更新日時で、1件につき最大3つ）
      for (let i = 0; i < list.length; i += 150) {
        const batch = this.newBatch();
        const touched = new Set<string>();
        for (const { employeeId, ...d } of list.slice(i, i + 150)) {
          batch.set(doc(employeeSubCol(employeeId, 'dependents')), d);
          this.logIn(batch, employeeId, `CSVで被扶養者を登録（${d.name}さん・扶養に入った日 ${dateLabel(d.certifiedDate)}）`);
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
      const batch = this.newBatch();
      batch.set(doc(employeeSubCol(employeeId, 'payrollAssignments')), input);
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }


  /** 固定的賃金の変動として登録する（同じ月は1件。ドキュメントIDは変動月） */
  async setFixedWageChange(employeeId: string, change: ManualWageChange) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.set(doc(employeeSubCol(employeeId, 'fixedWageChanges'), change.yearMonth), change);
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 登録した固定的賃金の変動を取り消す */
  async removeFixedWageChange(employeeId: string, yearMonth: string) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.delete(doc(employeeSubCol(employeeId, 'fixedWageChanges'), yearMonth));
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被保険者区分を変える（変わった日から） */
  async addInsuredType(employeeId: string, input: InsuredTypeHistory) {
    return this.write(async () => {
      const batch = this.newBatch();
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
      const batch = this.newBatch();
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
      const batch = this.newBatch();
      batch.update(siDoc('employees', employeeId), { name: name.trim(), updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /**
   * 社員番号を変える（番号の付け替え・登録の誤りを直すとき）
   * 給与・賞与などの記録は従業員ID（社員番号ではない）で結びついているので、書き換えは従業員の文書だけで済む。
   * 確定済みの月の記録は、確定したときの社員番号のまま
   */
  async updateEmployeeNumber(employeeId: string, employeeNumber: string, before: string) {
    return this.write(async () => {
      if ((await getDoc(numberDoc(employeeNumber))).exists()) throw new EmployeeNumberTakenError([employeeNumber]);
      const batch = this.newBatch();
      batch.update(siDoc('employees', employeeId), { employeeNumber, updatedAt: serverTimestamp() });
      // 新しい番号の記録を作り、前の番号の記録（この人のもの）を消す。同じ書き込みにして、番号が宙に浮かないようにする
      batch.set(numberDoc(employeeNumber), { employeeId });
      const old = await getDoc(numberDoc(before));
      if (old.exists() && old.data()['employeeId'] === employeeId) batch.delete(numberDoc(before));
      await this.commitNumbered(batch, [employeeNumber]);
    });
  }

  /** 被扶養者を足す */
  async addDependent(employeeId: string, input: DependentInput) {
    return this.write(async () => {
      const batch = this.newBatch();
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
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, 'dependents'), dependentId), { careExemptions });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 被扶養者を扶養から外す */
  async removeDependent(employeeId: string, dependentId: string, removedDate: string) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, 'dependents'), dependentId), { removedDate });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 同月得喪の、厚生年金保険料の還付の状態を変える */
  async setRefundStatus(employeeId: string, qualificationId: string, refundStatus: 'pending' | 'returned' | 'none') {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, 'qualifications'), qualificationId), { refundStatus });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 再加入（新しい資格の期間を足す） */
  async addQualification(employeeId: string, acquiredDate: string) {
    return this.write(async () => {
      const batch = this.newBatch();
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
      const batch = this.newBatch();
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
      const batch = this.newBatch();
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
      const batch = this.newBatch();
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
      // 1回の書き込みは500件まで（標準報酬月額・変更の記録・従業員の更新日時で、1件につき3つ）
      for (let i = 0; i < items.length; i += 150) {
        const batch = this.newBatch();
        for (const x of items.slice(i, i + 150)) {
          this.logIn(
            batch,
            x.employeeId,
            `決定通知書の取り込みで標準報酬月額を${x.provisionalId ? '確定' : '登録'}（${yearMonthLabel(x.validFrom)}から 健保 ${(x.healthStandard / 10_000).toLocaleString('ja-JP')}万円／厚年 ${(x.pensionStandard / 10_000).toLocaleString('ja-JP')}万円）`,
          );
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
      const batch = this.newBatch();
      batch.set(doc(employeeSubCol(employeeId, 'exemptions')), {
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 適用除外を直す（種類・該当年月日・非該当年月日の誤り） */
  async updateExemption(employeeId: string, exemptionId: string, input: { type: Exemption['type']; startDate: string; endDate: string }) {
    return this.setSub(employeeId, 'exemptions', exemptionId, {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate === '' ? null : input.endDate,
    });
  }

  /** 適用除外を消す（誤って登録したもの） */
  async deleteExemption(employeeId: string, exemptionId: string) {
    return this.deleteSub(employeeId, 'exemptions', exemptionId);
  }

  /** 休職を消す（誤って登録したもの） */
  async deleteAbsence(employeeId: string, absenceId: string) {
    return this.deleteSub(employeeId, 'absences', absenceId);
  }

  /** 休業を足す */
  async addLeave(employeeId: string, input: LeaveInput) {
    return this.write(async () => {
      const batch = this.newBatch();
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

  /** 休業を直す（延長・短縮・復帰と、種類・開始日の誤り） */
  async updateLeave(employeeId: string, leaveId: string, input: LeaveInput) {
    return this.setSub(employeeId, 'leaves', leaveId, {
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate === '' ? null : input.endDate,
      workedDays: input.workedDays,
    });
  }

  /** 休職を足す（設計書 2.26） */
  async addAbsence(employeeId: string, input: AbsenceInput) {
    return this.write(async () => {
      const batch = this.newBatch();
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
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, 'absences'), absenceId), {
        reason: input.reason,
        startDate: input.startDate,
        endDate: input.endDate === '' ? null : input.endDate,
      });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  // ---- 変更の記録（設計書 3.1「変更の記録」） ----
  // 従業員の情報を登録・変更・削除したら、誰が・いつ・何をしたかを残す。訂正・削除で元の値が分からなくならないように、直す前の値も文に含める。
  // 記録は書き換え・削除できない（ルールで守る）。従業員を削除・個人データを消去するときは一緒に消える。

  /** 変更の記録を1件残す（担当者は、ログインしている人のメールアドレス） */
  async addChangeLog(employeeId: string, text: string): Promise<void> {
    await addDoc(employeeSubCol(employeeId, 'changeLogs'), { at: serverTimestamp(), by: this.auth.user()?.email ?? '', text });
  }

  /** 何人分かの変更の記録を、まとめて残す（一括登録・CSVの取り込み） */
  async addChangeLogs(list: { employeeId: string; text: string }[]): Promise<void> {
    const by = this.auth.user()?.email ?? '';
    for (let i = 0; i < list.length; i += 400) {
      const batch = this.newBatch();
      for (const x of list.slice(i, i + 400)) batch.set(doc(employeeSubCol(x.employeeId, 'changeLogs')), { at: serverTimestamp(), by, text: x.text });
      await batch.commit();
    }
  }

  /** 変更の記録（新しい順に、最大 count 件） */
  async loadChangeLogs(employeeId: string, count = 100): Promise<ChangeLog[]> {
    const snap = await getDocs(query(employeeSubCol(employeeId, 'changeLogs'), orderBy('at', 'desc'), limit(count)));
    return snap.docs.map((d) => {
      const at = d.data()['at'];
      return { id: d.id, at: at instanceof Timestamp ? at.toDate() : null, by: d.data()['by'] ?? '', text: d.data()['text'] ?? '' };
    });
  }

  // ---- 登録した情報の訂正・削除（設計書 3.1「登録した情報の訂正・削除」） ----
  // 確定済みの月に関わる訂正でも、確定した金額は書き換えない（差額の画面に、さかのぼる改定の差額として出る）

  /** 履歴の1件を書き換える（従業員の更新日時も合わせて変える） */
  private async setSub(employeeId: string, sub: string, id: string, data: DocumentData, employee: DocumentData = {}) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, sub), id), data);
      batch.update(siDoc('employees', employeeId), { ...employee, updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 履歴の1件を消す */
  private async deleteSub(employeeId: string, sub: string, id: string, employee: DocumentData = {}) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.delete(doc(employeeSubCol(employeeId, sub), id));
      batch.update(siDoc('employees', employeeId), { ...employee, updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 加入対象の判定の情報を更新する（契約が変わったとき・入社時の入力の誤り）。候補は担当者が確かめて、加入・喪失・区分の変更を別に登録する */
  async updateEligibility(employeeId: string, eligibility: StoredEligibility) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(siDoc('employees', employeeId), { eligibility, updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 生年月日を直す（登録の誤り）。年齢による切り替え（40・65・70・75歳）は、直した日から計算し直す */
  async updateBirthDate(employeeId: string, birthDate: string) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(siDoc('employees', employeeId), { birthDate, updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /**
   * 資格の期間を直す（資格取得日・退職日の誤り、退職の取り消し）
   * @param dependentMoves 退職と同じ日に扶養から外れた被扶養者の「外れた日」を合わせて直す（取り消しなら扶養に戻す）
   */
  async updateQualification(
    employeeId: string,
    qualificationId: string,
    input: { acquiredDate: string; lostDate: string | null; lostReason: string | null },
    dependentMoves: { id: string; removedDate: string | null }[] = [],
  ) {
    return this.write(async () => {
      const batch = this.newBatch();
      batch.update(doc(employeeSubCol(employeeId, 'qualifications'), qualificationId), input);
      for (const m of dependentMoves) batch.update(doc(employeeSubCol(employeeId, 'dependents'), m.id), { removedDate: m.removedDate });
      batch.update(siDoc('employees', employeeId), { updatedAt: serverTimestamp() });
      await batch.commit();
    });
  }

  /** 資格の期間を消す（誤って登録した再加入など） */
  async deleteQualification(employeeId: string, qualificationId: string) {
    return this.deleteSub(employeeId, 'qualifications', qualificationId);
  }

  /** 標準報酬月額の履歴を直す（金額・適用開始月・理由の誤り） */
  async updateStandard(employeeId: string, standardId: string, input: StandardInput, remuneration: number | null, breakdown: RemunerationBreakdown | null = null) {
    return this.setSub(employeeId, 'standardRemunerations', standardId, {
      validFrom: input.validFrom,
      reason: input.reason,
      healthStandard: input.healthStandard,
      pensionStandard: input.pensionStandard,
      ownRemuneration: input.ownRemuneration ?? null,
      totalRemuneration: input.totalRemuneration ?? null,
      selectedInsurerId: input.selectedInsurerId ?? null,
      provisional: input.provisional === true,
      remuneration,
      remunerationBreakdown: breakdown ? normalizeBreakdown(breakdown) : null,
    });
  }

  /**
   * 何人分かの標準報酬月額の履歴を、まとめて消す（定時決定の一括登録の取り消しなど）。変更の記録も同じ書き込みで残す
   * 1回の書き込みは500件までなので、150人ずつ（履歴・記録・更新日時の3つ）
   */
  async deleteStandards(list: { employeeId: string; standardId: string; log: string }[]): Promise<void> {
    return this.write(async () => {
      for (let i = 0; i < list.length; i += 150) {
        const batch = this.newBatch();
        for (const x of list.slice(i, i + 150)) {
          batch.delete(doc(employeeSubCol(x.employeeId, 'standardRemunerations'), x.standardId));
          this.logIn(batch, x.employeeId, x.log);
          batch.update(siDoc('employees', x.employeeId), { updatedAt: serverTimestamp() });
        }
        await batch.commit();
      }
    });
  }

  /** 標準報酬月額の履歴を消す（誤って登録した改定・取り込みの誤りなど） */
  async deleteStandard(employeeId: string, standardId: string) {
    return this.deleteSub(employeeId, 'standardRemunerations', standardId);
  }

  /** 被扶養者を直す（氏名・生年月日・扶養に入った日の誤り。外れた日を空にすると扶養に戻す） */
  async updateDependent(employeeId: string, dependentId: string, input: DependentInput & { removedDate: string | null }) {
    return this.setSub(employeeId, 'dependents', dependentId, {
      name: input.name.trim(),
      birthDate: input.birthDate,
      certifiedDate: input.certifiedDate,
      removedDate: input.removedDate,
    });
  }

  /** 被扶養者を消す（誤って登録した人） */
  async deleteDependent(employeeId: string, dependentId: string) {
    return this.deleteSub(employeeId, 'dependents', dependentId);
  }

  /**
   * 所属事業所の履歴を直す・消す。担当範囲の絞り込みに使う officeIds（これまでに所属した事業所）も合わせて直す
   * （所属の履歴を変えられるのは全担当だけ。ルールでも制限する）
   */
  async updateAssignment(employeeId: string, assignmentId: string, input: Assignment, officeIds: string[]) {
    return this.setSub(employeeId, 'assignments', assignmentId, { validFrom: input.validFrom, officeId: input.officeId }, { officeIds });
  }

  async deleteAssignment(employeeId: string, assignmentId: string, officeIds: string[]) {
    return this.deleteSub(employeeId, 'assignments', assignmentId, { officeIds });
  }

  /** 被保険者区分の履歴を直す・消す */
  async updateInsuredType(employeeId: string, id: string, input: InsuredTypeHistory) {
    return this.setSub(employeeId, 'insuredTypes', id, { validFrom: input.validFrom, type: input.type });
  }

  async deleteInsuredType(employeeId: string, id: string) {
    return this.deleteSub(employeeId, 'insuredTypes', id);
  }

  /** 支払区分の履歴を直す・消す */
  async updatePayrollAssignment(employeeId: string, id: string, input: PayrollAssignment) {
    return this.setSub(employeeId, 'payrollAssignments', id, { validFrom: input.validFrom, payrollGroupId: input.payrollGroupId });
  }

  async deletePayrollAssignment(employeeId: string, id: string) {
    return this.deleteSub(employeeId, 'payrollAssignments', id);
  }

  /** 休業を消す（誤って登録したもの） */
  async deleteLeave(employeeId: string, leaveId: string) {
    return this.deleteSub(employeeId, 'leaves', leaveId);
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
