// アカウントの発行・変更の入力チェック（設計書 4章 セキュリティルール）
// 同じチェックを Cloud Functions でも行う（画面のチェックは入力の補助）。
export type SiRole = 'admin' | 'staff';

export type AccountView = {
  uid: string;
  email: string;
  siRole: SiRole | null;
  siScope: string | null;
  disabled: boolean;
  lastSignIn: string | null;
};

export type AccountInput = { email: string; password: string; siRole: SiRole | ''; siScope: string };
export type AccountErrors = Partial<Record<keyof AccountInput, string>>;

export const ROLE_LABEL: Record<SiRole, string> = { admin: '管理者', staff: '担当者' };

/**
 * @param isNew 新しく発行するか（初期パスワードが要る。すでにあるメールアドレスなら、そのアカウントに権限を付けるので不要）
 */
export function checkAccount(input: AccountInput, existingEmails: string[], isNew: boolean): AccountErrors {
  const e: AccountErrors = {};
  const email = input.email.trim();
  if (isNew) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'メールアドレスを正しく入力してください';
    else if (existingEmails.includes(email.toLowerCase())) e.email = 'このメールアドレスはすでに一覧にあります（権限は一覧で変えてください）';
    if (input.password !== '' && input.password.length < 8) e.password = '初期パスワードは8文字以上にしてください';
  }
  if (input.siRole === '') e.siRole = '権限を選んでください';
  if (input.siRole === 'staff' && input.siScope === '') e.siScope = '担当範囲を選んでください';
  return e;
}

/** 担当範囲の表示 */
export function scopeLabel(scope: string | null, offices: { id: string; name: string }[]): string {
  if (scope === null) return '―';
  if (scope === 'all') return '全担当';
  return offices.find((o) => o.id === scope)?.name ?? `（${scope}）`;
}
