import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency（同時に動かす数を決めて実行する）', () => {
  it('結果は元の順で返し、同時に動くのは決めた数まで', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 7], 3, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i * 10;
    });
    expect(result).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(3);
  });

  it('空の配列なら空の結果。1つでも失敗したら、全体を失敗にする', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    await expect(mapWithConcurrency([1, 2], 2, async (x) => { if (x === 2) throw new Error('x'); return x; })).rejects.toThrow('x');
  });

  it('同時に動かす数が数でない・0のときも、1つずつ全部を実行する（穴の空いた結果を返さない）', async () => {
    expect(await mapWithConcurrency([1, 2, 3], Number.NaN, async (x) => x * 2)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x)).toEqual([1, 2]);
  });
});
