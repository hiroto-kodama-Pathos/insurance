// ログイン状態と権限（カスタムクレーム siRole・siScope）を扱う（設計書 4章 セキュリティルール）
import { computed, Service, signal } from '@angular/core';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { auth } from '../firebase';

export type SiRole = 'staff' | 'admin';

/** ログイン中の利用者 */
export type AuthUser = {
  uid: string;
  email: string;
  /** 第三課題の権限。null は第三課題を使えないアカウント（第二課題だけの人など） */
  siRole: SiRole | null;
  /** 担当範囲。'all' または担当する適用事業所のID */
  siScope: string | null;
};

@Service()
export class Auth {
  private readonly current = signal<AuthUser | null>(null);
  private readyResolve!: () => void;
  private readonly ready = new Promise<void>((resolve) => (this.readyResolve = resolve));

  /** ログイン中の利用者（ログアウト中は null） */
  readonly user = this.current.asReadonly();
  /** 第三課題を使える人か */
  readonly canUse = computed(() => this.current()?.siRole != null);
  readonly isAdmin = computed(() => this.current()?.siRole === 'admin');

  constructor() {
    onAuthStateChanged(auth, async (u) => {
      this.current.set(u ? await toAuthUser(u) : null);
      this.readyResolve();
    });
  }

  /** 起動直後に、保存されているログイン状態の読み込みが終わるまで待つ */
  whenReady(): Promise<void> {
    return this.ready;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // 権限を付けた直後でも反映されるように、トークンを取り直す
    const user = await toAuthUser(cred.user, true);
    this.current.set(user);
    return user;
  }

  async signOut(): Promise<void> {
    await signOut(auth);
    this.current.set(null);
  }
}

async function toAuthUser(u: User, forceRefresh = false): Promise<AuthUser> {
  const token = await u.getIdTokenResult(forceRefresh);
  const role = token.claims['siRole'];
  const scope = token.claims['siScope'];
  return {
    uid: u.uid,
    email: u.email ?? '',
    siRole: role === 'staff' || role === 'admin' ? role : null,
    siScope: typeof scope === 'string' ? scope : null,
  };
}
