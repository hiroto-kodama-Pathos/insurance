// さかのぼる改定の差額の精算の記録（設計書 4章 adjustments）
// 差額そのものは毎回計算する。担当者が精算した給与の月と、精算した額だけを保存する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { getDocs, query, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
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

  /**
   * 残りの差額を、精算した給与の月とあわせて記録する（前に精算した記録は残す）。
   * 画面で読んだあとに、ほかの担当者が精算・取り消しをしていたら書かない（古い記録に足して書くと、先の精算が消えたり、
   * 同じ差額を二重に精算したりするため）。トランザクションで今の記録を読み直して確かめる
   */
  async settle(a: TrackedAdjustment, settledMonth: string, previous: SettlementRecord | undefined): Promise<void> {
    const ref = siDoc('adjustments', a.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? ((snap.data()['entries'] ?? []) as SettlementRecord['entries']) : [];
      if (!sameEntries(current, previous?.entries ?? [])) throw new AdjustmentChangedError();
      tx.set(ref, {
        employeeId: a.employeeId,
        yearMonth: a.yearMonth,
        officeId: a.officeId,
        cause: a.cause,
        beforeStandard: a.beforeStandard,
        afterStandard: a.afterStandard,
        diffs: a.diffs,
        entries: [...current, { settledMonth, diffs: a.remaining }],
        updatedAt: serverTimestamp(),
      });
    });
  }

  /**
   * 精算済みを取り消す（精算した給与の月の誤りなど）。最後に記録した精算だけを取り消し、残りの差額は未精算に戻る。
   * 精算の記録が1つもなくなったら、文書ごと消す。画面で読んだあとに記録が変わっていたら取り消さない
   */
  async unsettle(id: string, previous: SettlementRecord): Promise<void> {
    const ref = siDoc('adjustments', id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? ((snap.data()['entries'] ?? []) as SettlementRecord['entries']) : [];
      if (current.length === 0 || !sameEntries(current, previous.entries)) throw new AdjustmentChangedError();
      const entries = current.slice(0, -1);
      if (entries.length === 0) tx.delete(ref);
      else tx.update(ref, { entries, updatedAt: serverTimestamp() });
    });
  }
}

/** 画面で読んだあとに、ほかの担当者が精算の記録を変えていた */
export class AdjustmentChangedError extends Error {
  constructor() {
    super('ほかの担当者が先に精算の記録を変えました');
    this.name = 'AdjustmentChangedError';
  }
}

/** 精算の記録が同じか（件数と、精算した給与の月で比べる。精算・取り消しのたびに件数か月が変わる） */
export function sameEntries(a: SettlementRecord['entries'], b: SettlementRecord['entries']): boolean {
  return a.length === b.length && a.every((x, i) => x.settledMonth === b[i].settledMonth);
}
