// 届出済みの記録（設計書 2.25・4章 filings）
// 届出の要否と期限は表示のたびに計算する。担当者が「届出済み」にした記録だけを保存する。
import { inject, Service } from '@angular/core';
import { Auth } from '../auth/auth';
import { scopeWhere } from './scope';
import { deleteDoc, getDocs, query, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Filing } from '../calc/filing';
import { siCol, siDoc } from '../firestore-paths';

/** 届出への対応：届け出た／届け出なくてよい */
export type FilingResolution = 'filed' | 'notNeeded';

@Service()
export class FilingRepository {
  private readonly auth = inject(Auth);

  /** 届出済み・対応不要にした届出のID（どちらも、未対応の一覧と要確認には出さない） */
  async loadFiledIds(): Promise<Set<string>> {
    return new Set((await this.loadResolutions()).keys());
  }

  /** 届出ごとの対応（届出済み・対応不要） */
  async loadResolutions(): Promise<Map<string, FilingResolution>> {
    const snap = await getDocs(query(siCol('filings'), ...scopeWhere(this.auth)));
    return new Map(snap.docs.map((d) => [d.id, d.data()['resolution'] === 'notNeeded' ? 'notNeeded' : 'filed']));
  }

  /**
   * 対応不要にする（取り消した退職の資格喪失届など、届け出なくてよいと分かったもの）。届出済みと同じく未対応の一覧から外れ、未対応に戻せる
   */
  async setNotNeeded(f: Pick<Filing, 'id' | 'employeeId' | 'kind' | 'trigger' | 'officeId'>, by: string): Promise<void> {
    await setDoc(siDoc('filings', f.id), {
      employeeId: f.employeeId,
      kind: f.kind,
      trigger: f.trigger,
      officeId: f.officeId,
      resolution: 'notNeeded',
      filedAt: serverTimestamp(),
      filedBy: by,
    });
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

  /**
   * まとめて届出済みにする（届出の期限の画面で選んだもの）
   * 1回の書き込み（バッチ）は500件までなので、400件ずつに分ける。途中で失敗したら、それまでの分は届出済みのまま残る
   */
  async setFiledMany(list: Pick<Filing, 'id' | 'employeeId' | 'kind' | 'trigger' | 'officeId'>[], filedBy: string): Promise<void> {
    for (let i = 0; i < list.length; i += 400) {
      const batch = writeBatch(db);
      for (const f of list.slice(i, i + 400)) {
        batch.set(siDoc('filings', f.id), {
          employeeId: f.employeeId,
          kind: f.kind,
          trigger: f.trigger,
          officeId: f.officeId,
          filedAt: serverTimestamp(),
          filedBy,
        });
      }
      await batch.commit();
    }
  }

  /** 未対応に戻す */
  async unsetFiled(id: string): Promise<void> {
    await deleteDoc(siDoc('filings', id));
  }
}
