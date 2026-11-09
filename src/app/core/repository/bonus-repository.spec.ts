import { describe, expect, it } from 'vitest';
import { chunkBonuses, IMPORT_CHUNK, IMPORT_CHUNK_REFS } from './bonus-repository';

const b = (employeeId: string, paidDate: string, officeId: string, bonusTypeId: string | null) => ({ employeeId, paidDate, officeId, bonusTypeId });
const refsOf = (c: ReturnType<typeof b>[]) =>
  new Set(c.flatMap((x) => [`e|${x.employeeId}`, `c|${x.paidDate.slice(0, 7)}|${x.officeId}`, ...(x.bonusTypeId ? [`t|${x.bonusTypeId}`] : [])])).size;

describe('chunkBonuses（賞与の取り込みの書き込みのまとまり）', () => {
  it('人・種類・月・事業所がすべて違う行でも、確かめる文書が IMPORT_CHUNK_REFS を超えないように分ける', () => {
    const items = Array.from({ length: 30 }, (_, i) => b(`e${i}`, `2025-${String((i % 12) + 1).padStart(2, '0')}-10`, `o${i % 5}`, `t${i % 7}`));
    const chunks = chunkBonuses(items);
    for (const c of chunks) {
      expect(refsOf(c)).toBeLessThanOrEqual(IMPORT_CHUNK_REFS);
      expect(c.length).toBeLessThanOrEqual(IMPORT_CHUNK);
    }
    expect(chunks.flat()).toEqual(items); // 順番は変えず、漏れもない
  });

  it('同じ月・同じ事業所・同じ種類なら、確かめるのは主に従業員なので、多めにまとめる', () => {
    const items = Array.from({ length: 40 }, (_, i) => b(`e${i}`, '2026-12-10', 'honsha', 't1'));
    const chunks = chunkBonuses(items);
    expect(chunks[0].length).toBe(IMPORT_CHUNK_REFS - 2); // 確定・種類の2つ＋従業員16人
    expect(chunks.flat()).toEqual(items);
  });
});
