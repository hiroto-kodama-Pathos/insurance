// アカウントの発行・変更（Cloud Functions を呼ぶ。設計書 4章 セキュリティルール）
// カスタムクレームは Admin SDK でしか設定できないため、画面からは管理者だけが呼び出せる関数を通す。
import { Service } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { AccountView, SiRole } from '../calc/account';
import { functions } from '../firebase';

@Service()
export class AccountRepository {
  async list(): Promise<AccountView[]> {
    const r = await httpsCallable<void, AccountView[]>(functions, 'listSiAccounts')();
    return r.data;
  }

  /** 発行する（すでにあるメールアドレスなら、そのアカウントに権限を付ける）。created：新しく作ったか */
  async create(input: { email: string; password: string; siRole: SiRole; siScope: string }): Promise<{ uid: string; created: boolean }> {
    const r = await httpsCallable<typeof input, { uid: string; created: boolean }>(functions, 'createSiAccount')(input);
    return r.data;
  }

  async update(uid: string, siRole: SiRole, siScope: string): Promise<void> {
    await httpsCallable(functions, 'updateSiAccount')({ uid, siRole, siScope });
  }

  /** 第三課題を使えないようにする（ほかの権限は残す） */
  async remove(uid: string): Promise<void> {
    await httpsCallable(functions, 'removeSiAccess')({ uid });
  }
}
