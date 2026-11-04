import { describe, expect, it } from 'vitest';
import { distinctOptions, matchesPerson, normalizeForSearch } from './person-search';

describe('一覧の検索と絞り込みの選択肢', () => {
  it('社員番号・氏名（空白を無視）で探す。空の検索はすべてに合う', () => {
    expect(matchesPerson('0001', '山田 太郎', '山田太郎')).toBe(true);
    expect(matchesPerson('0001', '山田 太郎', '　太郎 ')).toBe(true);
    expect(matchesPerson('0001', '山田 太郎', '0001')).toBe(true);
    expect(matchesPerson('0001', '山田 太郎', '佐藤')).toBe(false);
    expect(matchesPerson('0001', '山田 太郎', '')).toBe(true);
  });

  it('全角・半角を区別しない：全角の数字・英字で、半角の社員番号が見つかる（逆も）', () => {
    expect(matchesPerson('0001', '山田 太郎', '０００１')).toBe(true);
    expect(matchesPerson('０００１', '山田 太郎', '0001')).toBe(true);
    expect(matchesPerson('T0012', '山田 太郎', 'Ｔ００１２')).toBe(true);
    expect(matchesPerson('0001', '山田 太郎', '０００２')).toBe(false);
  });

  it('英字の大文字・小文字を区別しない', () => {
    expect(matchesPerson('T0012', '山田 太郎', 't0012')).toBe(true);
    expect(matchesPerson('0001', 'Smith John', 'ｓｍｉｔｈ')).toBe(true);
  });

  it('半角カタカナと全角カタカナを区別しない（濁点・半濁点つきも）', () => {
    expect(matchesPerson('0001', 'ヤマダ タロウ', 'ﾔﾏﾀﾞ')).toBe(true);
    expect(matchesPerson('0001', 'ﾔﾏﾀﾞ ﾀﾛｳ', 'ヤマダタロウ')).toBe(true);
    expect(matchesPerson('0001', 'パク ジヌ', 'ﾊﾟｸ')).toBe(true);
    expect(matchesPerson('0001', 'ヤマダ タロウ', 'ﾔﾏﾀﾛ')).toBe(false); // 濁点の有無は区別する（ﾀﾞ と ﾀ は別の文字）
  });

  it('そろえた形：全角英数字は半角・小文字に、半角カタカナは全角に、空白は除く', () => {
    expect(normalizeForSearch('Ｔ００１２ ﾔﾏﾀﾞ　太郎')).toBe('t0012ヤマダ太郎');
  });

  it('選択肢は重複と空を除き、出てきた順に並べる', () => {
    expect(distinctOptions(['本社', '大阪支店', '本社', null, ''])).toEqual(['本社', '大阪支店']);
  });
});
