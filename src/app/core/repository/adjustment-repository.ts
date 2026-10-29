// さかのぼる改定の差額の精算の記録（設計書 4章 adjustments）
// 差額そのものは毎回計算する。担当者が精算した給与の月と、精算した額だけを保存する。
import { Service } from '@angular/core';
import { getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { Diffs, SettlementRecord, TrackedAdjustment } from '../calc/adjustment';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class AdjustmentRepository {
  async loadSettlements(): Promise<SettlementRecord[]> {
    const snap = await getDocs(siCol('adjustments'));
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
}
