import { decodeCsv, parseCsv, parseDateLoose, parseHoursLoose, parseNumberLoose } from './csv';

describe('decodeCsv', () => {
  it('UTF-8（BOMつき）とShift_JISを自動で判定する', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('社員番号')]);
    expect(decodeCsv(utf8)).toBe('社員番号');
    // 「社員」の Shift_JIS
    expect(decodeCsv(new Uint8Array([0x8e, 0xd0, 0x88, 0xf5]))).toBe('社員');
  });
});

describe('parseCsv', () => {
  it('引用符の中のカンマ・改行・「""」と、CRLF・空の行に対応する', () => {
    expect(parseCsv('a,b\r\n"1,000","x""y"\r\n\r\n"改\n行",2')).toEqual([
      ['a', 'b'],
      ['1,000', 'x"y'],
      ['改\n行', '2'],
    ]);
  });
});

describe('parseDateLoose', () => {
  it.each([
    ['2026/10/25', '2026-10-25'],
    ['2026-10-25', '2026-10-25'],
    ['2026/1/5', '2026-01-05'],
    ['20261025', '2026-10-25'],
    ['2026年10月25日', '2026-10-25'],
    ['R8.10.25', '2026-10-25'],
    ['令和8年10月25日', '2026-10-25'],
    ['令和元年5月1日', '2019-05-01'],
    ['S60.4.1', '1985-04-01'],
    ['昭和64年1月7日', '1989-01-07'],
    ['平成元年1月8日', '1989-01-08'],
    ['２０２６/１０/２５', '2026-10-25'],
  ])('%s → %s', (v, d) => expect(parseDateLoose(v)).toBe(d));
  it('ありえない日付・読めない書き方は null', () => {
    expect(parseDateLoose('2026/02/30')).toBeNull();
    expect(parseDateLoose('10月25日')).toBeNull();
  });
});

describe('parseNumberLoose', () => {
  it('カンマ・円・¥を取り除く。空欄は null、読めなければ NaN', () => {
    expect(parseNumberLoose('340,000')).toBe(340000);
    expect(parseNumberLoose('¥12,000円')).toBe(12000);
    expect(parseNumberLoose(' ')).toBeNull();
    expect(parseNumberLoose(undefined)).toBeNull();
    expect(parseNumberLoose('abc')).toBeNaN();
  });
});

describe('parseHoursLoose', () => {
  it('小数・時:分・全角を読み取り、小数第1位に丸める', () => {
    expect(parseHoursLoose('86.5')).toBe(86.5);
    expect(parseHoursLoose('86:30')).toBe(86.5);
    expect(parseHoursLoose('８６時間２０分')).toBe(86.3);
    expect(parseHoursLoose(' ')).toBeNull();
    expect(parseHoursLoose(undefined)).toBeNull();
    expect(parseHoursLoose('86:75')).toBeNaN();
    expect(parseHoursLoose('abc')).toBeNaN();
  });
});
