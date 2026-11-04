// 随時改定の候補の対応状況（設計書 4章 revisionCandidates）
// 候補そのものは給与から毎回計算する。担当者が切り替えた状態（届出済み・確認済み）だけを保存する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { getDocs, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { CandidateStatusRecord, TrackedCandidate } from '../calc/revision';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class RevisionRepository {
  private readonly auth = inject(Auth);

  async loadStatuses(): Promise<CandidateStatusRecord[]> {
    const snap = await getDocs(query(siCol('revisionCandidates'), ...scopeWhere(this.auth)));
    return snap.docs.map((d) => ({ id: d.id, status: d.data()['status'] }));
  }

  /** 状態を保存する。あとで見返せるように、候補の見込みもあわせて残す */
  async setStatus(c: TrackedCandidate, status: CandidateStatusRecord['status'], officeId: string | null): Promise<void> {
    await setDoc(siDoc('revisionCandidates', c.id), {
      employeeId: c.employeeId,
      officeId,
      type: c.type,
      expectedUntil: c.expectedUntil,
      changeMonth: c.changeMonth,
      expectedFrom: c.expectedFrom,
      expectedHealth: c.expectedHealth,
      expectedPension: c.expectedPension,
      needsReview: c.needsReview,
      status,
      updatedAt: serverTimestamp(),
    });
  }
}
