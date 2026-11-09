import { describe, expect, it } from 'vitest';
import { chunkSalaries, SAVE_CHUNK, SAVE_CHUNK_REFS } from './salary-repository';

const item = (paidDate: string, officeId = 'honsha', employeeId = 'e1') => ({ salary: { paidDate, employeeId }, officeId });
const refsOf = (c: ReturnType<typeof item>[]) =>
  new Set([...c.map((x) => `c|${x.salary.paidDate.slice(0, 7)}|${x.officeId}`), ...c.map((x) => `e|${x.salary.employeeId}`)]).size;

describe('chunkSalaries（給与の取り込みの書き込みのまとまり）', () => {
  it('同じ人・同じ月・同じ事業所なら SAVE_CHUNK 件までまとめる', () => {
    const items = Array.from({ length: SAVE_CHUNK + 5 }, (_, i) => item(`2025-${String((i % 12) + 1).padStart(2, '0')}-25`)).slice(0, SAVE_CHUNK + 5);
    for (const c of chunkSalaries(items)) expect(c.length).toBeLessThanOrEqual(SAVE_CHUNK);
  });

  it('確かめる文書（支払月×事業所と従業員）が SAVE_CHUNK_REFS を超えたら分ける（ルールの上限）', () => {
    // 1か月分・200人（従業員ごとにルールがその人を確かめる）
    const items = Array.from({ length: 200 }, (_, i) => item('2026-10-25', i % 2 ? 'osaka' : 'honsha', `e${i}`));
    const chunks = chunkSalaries(items);
    for (const c of chunks) expect(refsOf(c)).toBeLessThanOrEqual(SAVE_CHUNK_REFS);
    expect(chunks.flat()).toEqual(items); // 順番は変えず、漏れもない
  });

  it('空なら書き込みなし', () => {
    expect(chunkSalaries([])).toEqual([]);
  });
});
