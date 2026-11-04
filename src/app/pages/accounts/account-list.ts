// アカウントと権限（管理者だけ。設計書 4章 セキュリティルール）
// アカウントの発行、権限（管理者・担当者）と担当範囲（全担当・特定の適用事業所）の変更、第三課題を使えないようにする操作を行う。
import { Confirm } from '../../core/ui/confirm';
import { NoticeMessage } from '../../core/ui/notice-message';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { AccountErrors, AccountInput, AccountView, checkAccount, ROLE_LABEL, scopeLabel, SiRole } from '../../core/calc/account';
import { Office } from '../../core/calc/office';
import { AccountRepository } from '../../core/repository/account-repository';
import { MasterRepository } from '../../core/repository/master-repository';

const EMPTY: AccountInput = { email: '', password: '', siRole: 'staff', siScope: '' };

/** Cloud Functions のエラーの文言（関数が返した説明があればそれを出す） */
function messageOf(e: unknown): string {
  const m = (e as { message?: string })?.message ?? '';
  return m && !m.startsWith('internal') ? m : '処理できませんでした。通信と、Cloud Functions が動いているかを確かめてください。';
}

@Component({
  imports: [RouterLink, NoticeMessage],
  selector: 'app-account-list',
  styleUrl: './account-list.scss',
  templateUrl: './account-list.html',
})
export class AccountList implements OnInit {
  private readonly auth = inject(Auth);
  private readonly confirm = inject(Confirm);
  private readonly repo = inject(AccountRepository);
  private readonly masterRepo = inject(MasterRepository);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roles: SiRole[] = ['staff', 'admin'];
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly accounts = signal<AccountView[]>([]);
  protected readonly offices = signal<Office[]>([]);
  protected readonly myUid = computed(() => this.auth.user()?.uid ?? '');

  protected readonly form = signal<AccountInput>(EMPTY);
  protected readonly errors = signal<AccountErrors>({});
  /** 変更中の行（uid → 入力中の権限・担当範囲） */
  protected readonly edits = signal<Record<string, { siRole: SiRole; siScope: string }>>({});

  async ngOnInit(): Promise<void> {
    try {
      const [masters] = await Promise.all([this.masterRepo.loadMasters()]);
      this.offices.set(masters.offices);
      await this.reload();
    } catch (e) {
      console.error(e);
      this.error.set(messageOf(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.accounts.set(await this.repo.list());
    this.edits.set({});
  }

  protected scopeText(a: AccountView): string {
    return scopeLabel(a.siScope, this.offices());
  }

  protected setForm<K extends keyof AccountInput>(key: K, value: AccountInput[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    const f = this.form();
    const errors = checkAccount(f, this.accounts().map((a) => a.email.toLowerCase()), true);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    await this.run(async () => {
      const r = await this.repo.create({
        email: f.email.trim(),
        password: f.password,
        siRole: f.siRole as SiRole,
        siScope: f.siRole === 'admin' ? 'all' : f.siScope,
      });
      this.form.set(EMPTY);
      await this.reload();
      return r.created
        ? `${f.email.trim()} のアカウントを発行しました。初期パスワードは本人に別の方法で伝え、ログイン後に変えてもらってください。`
        : `${f.email.trim()} はすでにあるアカウント（第二課題など）のため、第三課題の権限を付けました。パスワードは今のままです。`;
    });
  }

  protected edit(a: AccountView): void {
    this.edits.update((x) => ({ ...x, [a.uid]: { siRole: a.siRole ?? 'staff', siScope: a.siScope ?? '' } }));
  }

  protected setEdit(uid: string, key: 'siRole' | 'siScope', value: string): void {
    this.edits.update((x) => ({ ...x, [uid]: { ...x[uid], [key]: value } }));
  }

  protected async saveEdit(a: AccountView): Promise<void> {
    const e = this.edits()[a.uid];
    if (!e) return;
    if (e.siRole === 'staff' && e.siScope === '') {
      this.notice.set('担当範囲を選んでください。');
      return;
    }
    await this.run(async () => {
      await this.repo.update(a.uid, e.siRole, e.siRole === 'admin' ? 'all' : e.siScope);
      await this.reload();
      return `${a.email} の権限を変えました。本人が次にログインしたときから効きます（ログイン中なら、いったんログアウトされます）。`;
    });
  }

  protected async remove(a: AccountView): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'このアカウントを使えないようにしますか',
      message: `${a.email} は第三課題を使えなくなります（アカウントそのものは残り、あとで権限を付け直せます）。`,
      ok: '使えないようにする',
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.repo.remove(a.uid);
      await this.reload();
      return `${a.email} は第三課題を使えなくなりました（アカウントそのものは残っています）。`;
    });
  }

  private async run(action: () => Promise<string>): Promise<void> {
    this.saving.set(true);
    this.notice.set(null);
    try {
      this.notice.set(await action());
    } catch (e) {
      console.error(e);
      this.notice.set(messageOf(e));
    } finally {
      this.saving.set(false);
    }
  }
}
