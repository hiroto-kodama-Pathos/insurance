// 賞与の読み書き（設計書 4章 bonuses）
// 上限（年度累計573万円）の計算には同じ年度の賞与がすべて要るので、年度（4月〜翌3月）単位で読む。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { addDoc, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { BonusRecord } from '../calc/bonus-premium';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class BonusRepository {
  private readonly auth = inject(Auth);

  /** 年度（例：'2026' → 2026年4月1日〜2027年3月31日）の賞与 */
  async loadFiscalYear(fiscalYear: string): Promise<BonusRecord[]> {
    const from = `${fiscalYear}-04-01`;
    const to = `${Number(fiscalYear) + 1}-03-31`;
    const snap = await getDocs(query(siCol('bonuses'), ...scopeWhere(this.auth), where('paidDate', '>=', from), where('paidDate', '<=', to)));
    return snap.docs.map((d) => ({
      id: d.id,
      employeeId: d.data()['employeeId'],
      paidDate: d.data()['paidDate'],
      amount: d.data()['amount'],
      totalAmount: d.data()['totalAmount'] ?? null,
      inKindAmount: d.data()['inKindAmount'] ?? null,
      bonusTypeId: d.data()['bonusTypeId'] ?? null,
      isRemuneration: d.data()['isRemuneration'] === true,
    }));
  }

  /** 支給日が from〜to（'YYYY-MM-DD'、両端を含む）の賞与（届出の一覧に使う） */
  async loadRange(from: string, to: string): Promise<BonusRecord[]> {
    const snap = await getDocs(query(siCol('bonuses'), ...scopeWhere(this.auth), where('paidDate', '>=', from), where('paidDate', '<=', to)));
    return snap.docs.map((d) => ({
      id: d.id,
      employeeId: d.data()['employeeId'],
      paidDate: d.data()['paidDate'],
      amount: d.data()['amount'],
      totalAmount: d.data()['totalAmount'] ?? null,
      inKindAmount: d.data()['inKindAmount'] ?? null,
      bonusTypeId: d.data()['bonusTypeId'] ?? null,
      isRemuneration: d.data()['isRemuneration'] === true,
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

  /** CSVで取り込んだ賞与をまとめて登録する（設計書 3.8） */
  async importMany(list: (Omit<BonusRecord, 'id'> & { officeId: string })[]): Promise<void> {
    for (let i = 0; i < list.length; i += 400) {
      const batch = writeBatch(db);
      for (const { officeId, ...b } of list.slice(i, i + 400)) {
        batch.set(doc(siCol('bonuses')), { ...b, yearMonth: b.paidDate.slice(0, 7), officeId, createdAt: serverTimestamp() });
      }
      await batch.commit();
    }
  }

  /**
   * 二以上事業所勤務：全事業所の賞与額の合計を登録する（空にするなら null）
   * 確定済みの月でも登録できる（確定した控除額は変えず、過不足を表示するだけ）
   */
  async setTotalAmount(id: string, totalAmount: number | null): Promise<void> {
    await updateDoc(siDoc('bonuses', id), { totalAmount, updatedAt: serverTimestamp() });
  }

  /**
   * 登録した賞与を直す（支給日・賞与額・現物・種類の誤り）。直す前の月と、直したあとの月のどちらも確定済みでないこと（ルールでも守る）
   * 全事業所の合計（二以上事業所勤務）が賞与額以下になったら、合計は消す（登録し直してもらう）
   */
  async update(id: string, bonus: Omit<BonusRecord, 'id' | 'employeeId'>, officeId: string): Promise<void> {
    const total = bonus.totalAmount ?? null;
    await updateDoc(siDoc('bonuses', id), {
      paidDate: bonus.paidDate,
      yearMonth: bonus.paidDate.slice(0, 7),
      amount: bonus.amount,
      inKindAmount: bonus.inKindAmount ?? null,
      bonusTypeId: bonus.bonusTypeId ?? null,
      isRemuneration: bonus.isRemuneration === true,
      totalAmount: total !== null && total > bonus.amount ? total : null,
      officeId,
      updatedAt: serverTimestamp(),
    });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(siDoc('bonuses', id));
  }
}
