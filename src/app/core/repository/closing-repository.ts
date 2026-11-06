// 月次確定の保存・読み込み・解除（設計書 4章 closings）
// closings/{yearMonth}/offices/{officeId} に事業所ごとの結果、親の closings/{yearMonth} に事業所ごとの確定日時を持つ。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteField, doc, getDocs, query, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { OfficeClosing } from '../calc/closing';
import { db } from '../firebase';
import { closingOfficesCol, siCol, siDoc } from '../firestore-paths';

@Service()
export class ClosingRepository {
  private readonly auth = inject(Auth);

  /** その月に確定済みの事業所の結果 */
  async loadMonth(yearMonth: string): Promise<OfficeClosing[]> {
    const snap = await getDocs(query(closingOfficesCol(yearMonth), ...scopeWhere(this.auth)));
    return snap.docs.map((d) => {
      const x = d.data();
      const at = x['closedAt'];
      return {
        yearMonth,
        officeId: d.id,
        closedBy: x['closedBy'] ?? '',
        closedAt: at instanceof Timestamp ? at.toDate().toISOString() : null,
        rows: x['rows'] ?? [],
        totals: x['totals'],
        bonusRows: x['bonusRows'] ?? [],
        bonusTotals: x['bonusTotals'] ?? null,
      } as OfficeClosing;
    });
  }

  /** 直近の月（今月を含めて months か月）に確定済みの結果（さかのぼる差額の計算に使う） */
  async loadRecent(thisMonth: string, months: number): Promise<OfficeClosing[]> {
    const list = Array.from({ length: months }, (_, i) => {
      const [y, m] = thisMonth.split('-').map(Number);
      const t = y * 12 + (m - 1) - i;
      return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    });
    return (await Promise.all(list.map((ym) => this.loadMonth(ym)))).flat();
  }

  /**
   * その適用事業所を確定したことがある月（'YYYY-MM' の並び）。適用事業所の削除・保険者と都道府県の変更の前に、
   * 過去の確定の記録がその事業所を指していないかを確かめる（設計書 3.10）。親の closings/{yearMonth} の offices だけを読む
   */
  async closedMonthsOf(officeId: string): Promise<string[]> {
    const snap = await getDocs(siCol('closings'));
    return snap.docs.filter((d) => officeId in (d.data()['offices'] ?? {})).map((d) => d.id).sort();
  }

  /** 確定する。結果の保存と、親への確定日時の記録を1回の書き込みで行う */
  async close(closing: OfficeClosing): Promise<void> {
    const batch = writeBatch(db);
    batch.set(doc(closingOfficesCol(closing.yearMonth), closing.officeId), {
      yearMonth: closing.yearMonth,
      officeId: closing.officeId,
      closedBy: closing.closedBy,
      closedAt: serverTimestamp(),
      rows: closing.rows,
      totals: closing.totals,
      bonusRows: closing.bonusRows,
      bonusTotals: closing.bonusTotals,
    });
    batch.set(
      siDoc('closings', closing.yearMonth),
      { offices: { [closing.officeId]: serverTimestamp() } },
      { merge: true },
    );
    await batch.commit();
  }

  /** 確定を解除する */
  async reopen(yearMonth: string, officeId: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(closingOfficesCol(yearMonth), officeId));
    batch.update(siDoc('closings', yearMonth), { [`offices.${officeId}`]: deleteField() });
    await batch.commit();
  }
}
