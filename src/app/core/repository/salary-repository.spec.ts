import { describe, expect, it } from 'vitest';
import { chunkSalaries, SAVE_CHUNK, SAVE_CHUNK_MONTH_OFFICES } from './salary-repository';

const item = (paidDate: string, officeId = 'honsha') => ({ salary: { paidDate }, officeId });

describe('chunkSalaries（給与の取り込みの書き込みのまとまり）', () => {
  it('同じ月・事業所なら SAVE_CHUNK 件までまとめる', () => {
    const items = Array.from({ length: SAVE_CHUNK + 5 }, () => item('2026-10-25'));
    expect(chunkSalaries(items).map((c) => c.length)).toEqual([SAVE_CHUNK, 5]);
  });

  it('支払月×事業所が SAVE_CHUNK_MONTH_OFFICES を超えたら分ける（ルールの確かめる文書の数の上限）', () => {
    // 12か月 × 2事業所 = 24通り
    const items = Array.from({ length: 12 }, (_, m) => [item(`2025-${String(m + 1).padStart(2, '0')}-25`), item(`2025-${String(m + 1).padStart(2, '0')}-25`, 'osaka')]).flat();
    const chunks = chunkSalaries(items);
    for (const c of chunks) expect(new Set(c.map((x) => `${x.salary.paidDate.slice(0, 7)}|${x.officeId}`)).size).toBeLessThanOrEqual(SAVE_CHUNK_MONTH_OFFICES);
    expect(chunks.flat()).toEqual(items); // 順番は変えず、漏れもない
  });

  it('空なら書き込みなし', () => {
    expect(chunkSalaries([])).toEqual([]);
  });
});
