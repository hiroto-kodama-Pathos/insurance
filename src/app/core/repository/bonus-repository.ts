// 賞与の読み書き（設計書 4章 bonuses）
// 上限（年度累計573万円）の計算には同じ年度の賞与がすべて要るので、年度（4月〜翌3月）単位で読む。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { BonusRecord } from '../calc/bonus-premium';
import { siCol, siDoc } from '../firestore-paths';

/** 同じ人・同じ支給日の賞与がすでにある（二重に登録しないように止めた） */
export class BonusExistsError extends Error {
  constructor(readonly paidDate: string) {
    super(`bonus exists: ${paidDate}`);
  }
}

/**
 * 新しく登録する賞与のドキュメントID（従業員ID_支給日）。同じ人・同じ支給日の賞与を2件にしない（設計書 4章 bonuses）
 * （前に登録した賞与は自動のIDのまま。同じ支給日かは、読み込んだ賞与でも確かめる）
 */
export function bonusDocId(employeeId: string, paidDate: string): string {
  return `${employeeId}_${paidDate}`;
}

/** CSVの取り込みで、1回の書き込み（トランザクション）にまとめる件数 */
export const IMPORT_CHUNK = 8;

/** CSVの取り込みの結果 */
export type BonusImportResult = {
  /** 新しく登録した件数 */
  added: number;
  /** 登録済みの賞与を訂正した件数 */
  updated: number;
  /** 書く時点で同じ人・同じ支給日の賞与がすでにあったので登録しなかった行 */
  conflicts: { employeeId: string; paidDate: string }[];
  /** 途中で書き込めなかった件数 */
  failed: number;
  error: unknown;
};

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
    // ほかの担当者が同じ人・同じ支給日の賞与を同時に登録しても2件にならないよう、IDを決めてトランザクションで確かめる
    const ref = siDoc('bonuses', bonusDocId(bonus.employeeId, bonus.paidDate));
    await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) throw new BonusExistsError(bonus.paidDate);
      tx.set(ref, { ...bonus, yearMonth: bonus.paidDate.slice(0, 7), officeId, createdAt: serverTimestamp() });
    });
  }

  /**
   * CSVで取り込んだ賞与を登録・訂正する（設計書 3.8）
   * - existingId のない行は新しく登録する。書く時点で同じ人・同じ支給日の賞与があれば書かない（conflicts）
   * - existingId のある行は、その賞与を訂正する（賞与額・現物・種類。担当者が「訂正する」を選んだ行だけ渡す）
   * - IMPORT_CHUNK 件ずつのトランザクションで書き、途中で失敗したら止めて、書けた件数と書けなかった件数を返す
   *   （ルールが1件ごとに従業員・種類・確定を確かめ、1回の書き込みで確かめられるドキュメントは20件までのため、少しずつ書く）
   */
  async importMany(list: (Omit<BonusRecord, 'id'> & { officeId: string; existingId?: string | null })[]): Promise<BonusImportResult> {
    const result: BonusImportResult = { added: 0, updated: 0, conflicts: [], failed: 0, error: null };
    for (let i = 0; i < list.length; i += IMPORT_CHUNK) {
      const chunk = list.slice(i, i + IMPORT_CHUNK);
      try {
        const r = await runTransaction(db, async (tx) => {
          const news = chunk.filter((x) => !x.existingId);
          const refs = news.map((x) => siDoc('bonuses', bonusDocId(x.employeeId, x.paidDate)));
          const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
          const out = { added: 0, updated: 0, conflicts: [] as { employeeId: string; paidDate: string }[] };
          news.forEach(({ officeId, existingId: _, ...b }, k) => {
            if (snaps[k].exists()) {
              out.conflicts.push({ employeeId: b.employeeId, paidDate: b.paidDate });
              return;
            }
            tx.set(refs[k], { ...b, yearMonth: b.paidDate.slice(0, 7), officeId, createdAt: serverTimestamp() });
            out.added++;
          });
          for (const x of chunk.filter((y) => y.existingId)) {
            tx.update(siDoc('bonuses', x.existingId!), {
              amount: x.amount,
              inKindAmount: x.inKindAmount ?? null,
              bonusTypeId: x.bonusTypeId ?? null,
              isRemuneration: x.isRemuneration === true,
              // 全事業所の合計（二以上事業所勤務）は、賞与額を変えたので消す（登録し直してもらう）
              totalAmount: null,
              updatedAt: serverTimestamp(),
            });
            out.updated++;
          }
          return out;
        });
        result.added += r.added;
        result.updated += r.updated;
        result.conflicts.push(...r.conflicts);
      } catch (e) {
        result.failed = list.length - i;
        result.error = e;
        break;
      }
    }
    return result;
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
