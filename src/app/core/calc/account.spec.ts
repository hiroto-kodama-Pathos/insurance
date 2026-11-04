import { checkAccount, scopeLabel } from './account';

describe('アカウントの入力チェック', () => {
  const ok = { email: 'sato@example.com', password: 'initial-pass', siRole: 'staff' as const, siScope: 'osaka' };
  it('正しい入力はエラーなし（すでにあるアカウントに付けるなら、初期パスワードは空でよい）', () => {
    expect(checkAccount(ok, [], true)).toEqual({});
    expect(checkAccount({ ...ok, password: '' }, [], true)).toEqual({});
  });
  it('メールアドレス・初期パスワード・権限・担当範囲', () => {
    const e = checkAccount({ email: 'sato', password: 'short', siRole: '', siScope: '' }, [], true);
    expect(Object.keys(e).sort()).toEqual(['email', 'password', 'siRole']);
    expect(checkAccount({ ...ok, siScope: '' }, [], true).siScope).toBeDefined();
    expect(checkAccount(ok, ['sato@example.com'], true).email).toContain('すでに');
  });
  it('管理者は担当範囲を選ばなくてよい（常に全担当）', () => {
    expect(checkAccount({ ...ok, siRole: 'admin', siScope: '' }, [], true)).toEqual({});
  });
  it('担当範囲の表示', () => {
    expect(scopeLabel('all', [])).toBe('全担当');
    expect(scopeLabel('osaka', [{ id: 'osaka', name: '大阪支店' }])).toBe('大阪支店');
    expect(scopeLabel(null, [])).toBe('―');
  });
});
