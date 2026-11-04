import { describe, expect, it } from 'vitest';
import { parseNumberInput, toHalfWidth } from './half-width';
import { percentToRate } from './settings';
import { parseDateLoose, parseHoursLoose, parseNumberLoose } from './csv';
import { findByNumber } from './salary-import';

describe('全角・半角：半角にそろえる', () => {
  it('全角の数字・英字・記号・空白は半角に', () => {
    expect(toHalfWidth('１２，３４５')).toBe('12,345');
    expect(toHalfWidth('Ｔ００１２')).toBe('T0012');
    expect(toHalfWidth('８６．５')).toBe('86.5');
    expect(toHalfWidth('ｙａｍａｄａ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toBe('yamada@example.com');
    expect(toHalfWidth('１　２')).toBe('1 2');
  });

  it('横線のなかま（日本語入力の「ー」、全角の「－」「−」「‐」）は半角の「-」に', () => {
    expect(toHalfWidth('Aー001')).toBe('A-001');
    expect(toHalfWidth('A－001')).toBe('A-001');
    expect(toHalfWidth('−5,000')).toBe('-5,000');
    expect(toHalfWidth('A‐001')).toBe('A-001');
  });

  it('半角の文字は変えない', () => {
    expect(toHalfWidth('0001 abc-XYZ 9.85')).toBe('0001 abc-XYZ 9.85');
  });
});

describe('全角・半角：入力欄の数字を読む', () => {
  it.each([
    ['300000', 300_000],
    ['300,000', 300_000],
    ['３００，０００', 300_000],
    ['３０万', NaN], // 「万」は読まない（読めない値として入力チェックで止める）
    ['３００，０００円', 300_000],
    ['￥３００，０００', 300_000],
    ['２０日', 20],
    ['８６．５時間', 86.5],
    ['　１２３　', 123],
    ['－５００', -500],
  ])('「%s」→ %s', (text, n) => {
    expect(parseNumberInput(text)).toBe(n);
  });

  it('空欄・空白だけ・null は null', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('　')).toBeNull();
    expect(parseNumberInput(null)).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
  });

  it('料率（%）も全角で読める', () => {
    expect(percentToRate('９．８５')).toBe(9850);
    expect(percentToRate('　９．８５　')).toBe(9850);
    expect(percentToRate('９．８５％')).toBeNull(); // 「%」は欄の外に出しているので、これまでどおり入れない
  });
});

describe('全角・半角：CSVの値', () => {
  it('金額・時間・日付は、全角の数字・カンマ・小数点・区切りでも読める', () => {
    expect(parseNumberLoose('３００，０００')).toBe(300_000);
    expect(parseHoursLoose('８６．５')).toBe(86.5);
    expect(parseHoursLoose('８６：３０')).toBe(86.5);
    expect(parseDateLoose('２０２６／１０／２５')).toBe('2026-10-25');
    expect(parseDateLoose('令和８年１０月２５日')).toBe('2026-10-25');
    expect(parseDateLoose('２０２６－１０－２５')).toBe('2026-10-25');
  });

  it('社員番号は、全角でも同じ人として見つける', () => {
    const people = [{ id: 'e1', employeeNumber: '0001', name: '山田 太郎', assignments: [] }, { id: 'e2', employeeNumber: 'T0012', name: '佐藤', assignments: [] }];
    expect(findByNumber(people, '０００１')?.id).toBe('e1');
    expect(findByNumber(people, 'Ｔ００１２')?.id).toBe('e2');
    expect(findByNumber(people, '１')?.id).toBe('e1'); // 先頭の0が消えていても（これまでどおり）
  });
});
