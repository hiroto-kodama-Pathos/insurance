import { describe, expect, it } from 'vitest';
import { TimedCache } from './timed-cache';

describe('TimedCache（画面をまたいだ使い回し）', () => {
  function setup() {
    let t = 0;
    let loads = 0;
    const cache = new TimedCache<number>(1000, () => t);
    const load = async () => ++loads;
    return { cache, load, loads: () => loads, tick: (ms: number) => (t += ms) };
  }

  it('時間内なら、読み込まずに前の結果を返す', async () => {
    const s = setup();
    expect(await s.cache.get('u1', s.load)).toBe(1);
    s.tick(999);
    expect(await s.cache.get('u1', s.load)).toBe(1);
    expect(s.loads()).toBe(1);
  });

  it('時間がたつと読み直す', async () => {
    const s = setup();
    await s.cache.get('u1', s.load);
    s.tick(1000);
    expect(await s.cache.get('u1', s.load)).toBe(2);
  });

  it('鍵（ログインした人・担当範囲）が変わると読み直す', async () => {
    const s = setup();
    await s.cache.get('u1|all', s.load);
    expect(await s.cache.get('u2|osaka', s.load)).toBe(2);
  });

  it('clear のあとは読み直す（登録・変更したとき）', async () => {
    const s = setup();
    await s.cache.get('u1', s.load);
    s.cache.clear();
    expect(await s.cache.get('u1', s.load)).toBe(2);
  });

  it('読み込み中に同時に頼まれても、読み込みは1回だけ', async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.cache.get('u1', s.load), s.cache.get('u1', s.load)]);
    expect([a, b]).toEqual([1, 1]);
    expect(s.loads()).toBe(1);
  });

  it('失敗した読み込みは覚えず、次は読み直す', async () => {
    const s = setup();
    await expect(s.cache.get('u1', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(await s.cache.get('u1', s.load)).toBe(1);
  });
});
