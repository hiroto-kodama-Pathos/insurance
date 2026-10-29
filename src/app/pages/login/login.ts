// ログイン画面（設計書 3章）。新規登録はなく、管理者が発行したアカウントでログインする
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { useEmulators } from '../../../environments/firebase-config';
import { Auth } from '../../core/auth/auth';

/** Firebase のエラーを、利用者向けのことばに直す */
export function loginErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'メールアドレスまたはパスワードが違います。';
    case 'auth/too-many-requests':
      return 'ログインの失敗が続いたため、しばらく待ってからやり直してください。';
    case 'auth/network-request-failed':
      return 'ネットワークにつながりません。接続を確かめてください。';
    default:
      return 'ログインできませんでした。管理者に問い合わせてください。';
  }
}

const DENIED = 'このアカウントには社会保険管理システムを使う権限がありません。管理者に問い合わせてください。';

@Component({
  imports: [],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly showDevHint = useEmulators;

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('denied')) this.message.set(DENIED);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const user = await this.auth.signIn(this.email().trim(), this.password());
      if (!user.siRole) {
        await this.auth.signOut();
        this.message.set(DENIED);
        return;
      }
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(returnUrl?.startsWith('/') ? returnUrl : '/');
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      this.message.set(loginErrorMessage(code));
    } finally {
      this.busy.set(false);
    }
  }
}
