// 賞与の読み書き（設計書 4章 bonuses）
// 上限（年度累計573万円）の計算には同じ年度の賞与がすべて要るので、年度（4月〜翌3月）単位で読む。
import { Service } from '@angular/core';
import { addDoc, deleteDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { BonusRecord } from '../calc/bonus-premium';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class BonusRepository {
  /** 年度（例：'2026' → 2026年4月1日〜2027年3月31日）の賞与 */
  async loadFiscalYear(fiscalYear: string): Promise<BonusRecord[]> {
    const from = `${fiscalYear}-04-01`;
    const to = `${Number(fiscalYear) + 1}-03-31`;
    const snap = await getDocs(query(siCol('bonuses'), where('paidDate', '>=', from), where('paidDate', '<=', to)));
    return snap.docs.map((d) => ({
      id: d.id,
      employeeId: d.data()['employeeId'],
      paidDate: d.data()['paidDate'],
      amount: d.data()['amount'],
      totalAmount: d.data()['totalAmount'] ?? null,
    }));
  }

  /**
   * 登録する。支給月と支給日の所属事業所も保存し、確定済みの月の賞与をルールで守れるようにする
   * （officeId は登録時点の所属。計算では、その時点の所属の履歴から事業所を決め直す）
   */
  async add(bonus: Omit<BonusRecord, 'id'>, officeId: string): Promise<void> {
    await addDoc(siCol('bonuses'), {
      ...bonus,
      yearMonth: bonus.paidDate.slice(0, 7),
      officeId,
      createdAt: serverTimestamp(),
    });
  }

  /**
   * 二以上事業所勤務：全事業所の賞与額の合計を登録する（空にするなら null）
   * 確定済みの月でも登録できる（確定した控除額は変えず、過不足を表示するだけ）
   */
  async setTotalAmount(id: string, totalAmount: number | null): Promise<void> {
    await updateDoc(siDoc('bonuses', id), { totalAmount, updatedAt: serverTimestamp() });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(siDoc('bonuses', id));
  }
}
