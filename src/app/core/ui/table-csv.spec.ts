import { tableToRows, toCsv } from './table-csv';

describe('一覧をCSVで保存', () => {
  function table(html: string): HTMLTableElement {
    const t = document.createElement('table');
    t.innerHTML = html;
    return t;
  }

  it('2段の見出しはつなぎ、月の見出しの行は出さず、ボタン・チェックは出さない', () => {
    const t = table(`
      <thead>
        <tr><th rowspan="2">氏名</th><th colspan="2">健康保険</th><th rowspan="2"></th></tr>
        <tr><th>本人</th><th>会社</th></tr>
      </thead>
      <tbody>
        <tr class="month-head"><td colspan="4">2026年11月が期限（1件）</td></tr>
        <tr><td><input type="checkbox" />山田 太郎</td><td>14,775</td><td>14,775</td><td><button>直す</button></td></tr>
        <tr><td>佐藤 花子</td><td colspan="2">対象外（40歳未満）</td><td></td></tr>
      </tbody>`);
    expect(tableToRows(t)).toEqual([
      ['氏名', '健康保険 本人', '健康保険 会社', ''],
      ['山田 太郎', '14,775', '14,775', ''],
      ['佐藤 花子', '対象外（40歳未満）', '', ''],
    ]);
  });

  it('カンマ・改行・「"」を含む値は「"」で囲み、行は CRLF で区切る', () => {
    expect(toCsv([['氏名', '本人負担'], ['山田 "太郎"', '14,775']])).toBe('氏名,本人負担\r\n"山田 ""太郎""","14,775"\r\n');
  });
});
