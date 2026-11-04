// 給与の読み書き（設計書 4章 salaries）
// 同じ人・同じ支払日の給与は1件にする（ドキュメントIDを 従業員ID_支払日 にして上書きする）。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { monthEnd } from '../calc/date';
import { SalaryRecord } from '../calc/salary';
import { siCol, siDoc } from '../firestore-paths';

export function salaryDocId(employeeId: string, paidDate: string): string {
  return `${employeeId}_${paidDate}`;
}

@Service()
export class SalaryRepository {
  private readonly auth = inject(Auth);

  /** 支払月が from〜to（'YYYY-MM'、両端を含む）の給与 */
  async loadRange(fromYm: string, toYm: string): Promise<SalaryRecord[]> {
    const snap = await getDocs(
      query(siCol('salaries'), ...scopeWhere(this.auth), where('paidDate', '>=', `${fromYm}-01`), where('paidDate', '<=', monthEnd(toYm))),
    );
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        employeeId: x['employeeId'],
        paidDate: x['paidDate'],
        fixedWages: x['fixedWages'],
        nonFixedWages: x['nonFixedWages'] ?? 0,
        paymentBaseDays: x['paymentBaseDays'],
        retroactiveDiff: x['retroactiveDiff'] ?? null,
        inKindWages: x['inKindWages'] ?? null,
        workingHours: x['workingHours'] ?? null,
        hourlyRate: x['hourlyRate'] ?? null,
        excludedAmount: x['excludedAmount'] ?? null,
      };
    });
  }

  /**
   * 登録する（同じ人・同じ支払日があれば上書き）。支払月と支払日の所属事業所も保存し、
   * 確定済みの月の給与をルールで守れるようにする
   */
  async save(salary: Omit<SalaryRecord, 'id'>, officeId: string): Promise<void> {
    await setDoc(siDoc('salaries', salaryDocId(salary.employeeId, salary.paidDate)), {
      ...salary,
      yearMonth: salary.paidDate.slice(0, 7),
      officeId,
      updatedAt: serverTimestamp(),
    });
  }

  /** まとめて登録する（CSVの取り込み）。1回の書き込みは500件までなので分けて書く */
  async saveMany(items: { salary: Omit<SalaryRecord, 'id'>; officeId: string }[]): Promise<void> {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const { salary, officeId } of items.slice(i, i + 400)) {
        batch.set(siDoc('salaries', salaryDocId(salary.employeeId, salary.paidDate)), {
          ...salary,
          yearMonth: salary.paidDate.slice(0, 7),
          officeId,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(siDoc('salaries', id));
  }
}
