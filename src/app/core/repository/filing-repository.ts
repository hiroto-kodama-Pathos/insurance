// 届出済みの記録（設計書 2.25・4章 filings）
// 届出の要否と期限は表示のたびに計算する。担当者が「届出済み」にした記録だけを保存する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { Filing } from '../calc/filing';
import { siCol, siDoc } from '../firestore-paths';

@Service()
export class FilingRepository {
  private readonly auth = inject(Auth);

  /** 届出済みにした届出のID */
  async loadFiledIds(): Promise<Set<string>> {
    const snap = await getDocs(query(siCol('filings'), ...scopeWhere(this.auth)));
    return new Set(snap.docs.map((d) => d.id));
  }

  async setFiled(f: Pick<Filing, 'id' | 'employeeId' | 'kind' | 'trigger' | 'officeId'>, filedBy: string): Promise<void> {
    await setDoc(siDoc('filings', f.id), {
      employeeId: f.employeeId,
      kind: f.kind,
      trigger: f.trigger,
      officeId: f.officeId,
      filedAt: serverTimestamp(),
      filedBy,
    });
  }

  /** 未対応に戻す */
  async unsetFiled(id: string): Promise<void> {
    await deleteDoc(siDoc('filings', id));
  }
}
