import { describe, expect, it } from 'vitest';
import { Confirm } from './confirm';

describe('Confirm', () => {
  it('押したボタンで結果を返し、閉じる', async () => {
    const c = new Confirm();
    const p = c.ask({ title: '確定', message: 'よいですか', ok: '確定する' });
    expect(c.current()?.ok).toBe('確定する');
    c.answer(true);
    expect(await p).toBe(true);
    expect(c.current()).toBeNull();
  });

  it('新しい確認を出すと、前の確認は「やめる」になる', async () => {
    const c = new Confirm();
    const first = c.ask({ title: 'a', message: '', ok: 'a' });
    const second = c.ask({ title: 'b', message: '', ok: 'b' });
    expect(await first).toBe(false);
    c.answer(false);
    expect(await second).toBe(false);
  });
});
