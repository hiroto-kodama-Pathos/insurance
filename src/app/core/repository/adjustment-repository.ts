// さかのぼる改定の差額の精算の記録（設計書 4章 adjustments）
// 差額そのものは毎回計算する。担当者が精算した給与の月と、精算した額だけを保存する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Diffs, SettlementRecord, TrackedAdjustment } from '../calc/adjustment';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class AdjustmentRepository {
  private readonly auth = inject(Auth);

  async loadSettlements(): Promise<SettlementRecord[]> {
    const snap = await getDocs(query(siCol('adjustments'), ...scopeWhere(this.auth)));
    return snap.docs.map((d) => ({
      id: d.id,
      entries: (d.data()['entries'] ?? []) as { settledMonth: string; diffs: Diffs }[],
    }));
  }

  /** 残りの差額を、精算した給与の月とあわせて記録する（前に精算した記録は残す） */
  async settle(a: TrackedAdjustment, settledMonth: string, previous: SettlementRecord | undefined): Promise<void> {
    await setDoc(siDoc('adjustments', a.id), {
      employeeId: a.employeeId,
      yearMonth: a.yearMonth,
      officeId: a.officeId,
      cause: a.cause,
      beforeStandard: a.beforeStandard,
      afterStandard: a.afterStandard,
      diffs: a.diffs,
      entries: [...(previous?.entries ?? []), { settledMonth, diffs: a.remaining }],
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * 精算済みを取り消す（精算した給与の月の誤りなど）。最後に記録した精算だけを取り消し、残りの差額は未精算に戻る。
   * 精算の記録が1つもなくなったら、文書ごと消す
   */
  async unsettle(id: string, previous: SettlementRecord): Promise<void> {
    const entries = previous.entries.slice(0, -1);
    if (entries.length === 0) await deleteDoc(siDoc('adjustments', id));
    else await updateDoc(siDoc('adjustments', id), { entries, updatedAt: serverTimestamp() });
  }
}
