// 納付書の金額・給与ソフトの控除額の読み書き（設計書 2.28・4章 reconciliations・payrollDeductions）
// 入力した金額（事実）だけを保存する。納付見込額・本人負担との差は、表示のたびに計算する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DeductionLines, LineAmounts } from '../calc/reconcile';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class ReconcileRepository {
  private readonly auth = inject(Auth);

  /** その保険料の月の、事業所ごとの納付書の金額（キーは事業所ID） */
  async loadNotices(yearMonth: string): Promise<Map<string, LineAmounts>> {
    const snap = await getDocs(query(siCol('reconciliations'), where('yearMonth', '==', yearMonth), ...scopeWhere(this.auth)));
    return new Map(snap.docs.map((d) => [d.data()['officeId'] as string, d.data()['lines'] as LineAmounts]));
  }

  async saveNotice(yearMonth: string, officeId: string, lines: LineAmounts): Promise<void> {
    await setDoc(siDoc('reconciliations', `${yearMonth}_${officeId}`), { yearMonth, officeId, lines, updatedAt: serverTimestamp() });
  }

  async removeNotice(yearMonth: string, officeId: string): Promise<void> {
    await deleteDoc(siDoc('reconciliations', `${yearMonth}_${officeId}`));
  }

  /** その保険料の月の、従業員ごとの給与の控除額（キーは従業員ID） */
  async loadDeductions(yearMonth: string): Promise<Map<string, DeductionLines>> {
    const snap = await getDocs(query(siCol('payrollDeductions'), where('yearMonth', '==', yearMonth), ...scopeWhere(this.auth)));
    return new Map(
      snap.docs.map((d) => [
        d.data()['employeeId'] as string,
        { health: d.data()['health'], childSupport: d.data()['childSupport'], pension: d.data()['pension'] },
      ]),
    );
  }

  /** まとめて保存する（同じ人・同じ月は上書き）。1回の書き込みは500件までなので分ける */
  async saveDeductions(yearMonth: string, list: { employeeId: string; officeId: string; amounts: DeductionLines }[]): Promise<void> {
    for (let i = 0; i < list.length; i += 400) {
      const batch = writeBatch(db);
      for (const x of list.slice(i, i + 400)) {
        batch.set(siDoc('payrollDeductions', `${x.employeeId}_${yearMonth}`), {
          employeeId: x.employeeId, officeId: x.officeId, yearMonth, ...x.amounts, updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  async removeDeduction(employeeId: string, yearMonth: string): Promise<void> {
    await deleteDoc(siDoc('payrollDeductions', `${employeeId}_${yearMonth}`));
  }
}
