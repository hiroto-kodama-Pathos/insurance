// 画面の一覧（表）を、そのままCSVで保存する（設計書 3.0「一覧の出力」）
// 給与ソフト・経理に渡すとき、画面から書き写さずに済むように。表示している行（絞り込み・並び替えのあと）を、画面と同じ列で出す。
// Excel で開いても文字化けしないよう、先頭に BOM を付けた UTF-8 にする。

/** 表の見出し（2段の見出しは「健康保険 本人」のようにつなぐ）と、本文の行を、文字の表にする */
export function tableToRows(table: HTMLTableElement): string[][] {
  const text = (cell: Element): string => {
    const c = cell.cloneNode(true) as Element;
    // ボタン・入力欄（直す・削除・チェックなど）は出さない
    c.querySelectorAll('button, input, select, textarea').forEach((x) => x.remove());
    return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  // 見出し：行と列の広がり（rowspan・colspan）を考えて、列ごとに上から並べる
  const head: string[][] = [];
  const headRows = [...table.querySelectorAll('thead tr')];
  headRows.forEach((tr, r) => {
    head[r] ??= [];
    let col = 0;
    for (const th of [...tr.children]) {
      while (head[r][col] !== undefined) col++;
      const rs = Number(th.getAttribute('rowspan') ?? 1);
      const cs = Number(th.getAttribute('colspan') ?? 1);
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
        head[r + i] ??= [];
        head[r + i][col + j] = i === 0 ? text(th) : '';
      }
      col += cs;
    }
  });
  const width = Math.max(0, ...head.map((h) => h.length));
  const header = Array.from({ length: width }, (_, c) =>
    head.map((h) => h[c] ?? '').filter((x, i, a) => x !== '' && a.indexOf(x) === i).join(' '),
  );
  // 本文：月の見出しなどの行（1つのセルが全体に広がる行）と、データのない行は出さない
  const body = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => !(tr.children.length === 1 && Number(tr.children[0].getAttribute('colspan') ?? 1) > 1))
    .map((tr) => {
      const row: string[] = [];
      for (const td of [...tr.children]) {
        row.push(text(td));
        for (let j = 1; j < Number(td.getAttribute('colspan') ?? 1); j++) row.push('');
      }
      return row;
    });
  return [header, ...body];
}

/** CSV の文字にする（カンマ・改行・「"」を含む値は「"」で囲む。行の区切りは CRLF） */
export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** CSV ファイルとして保存する（ブラウザのダウンロード） */
export function downloadCsv(fileName: string, rows: string[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** 画面の中の表を探して保存する。表がなければ false */
export function saveTableCsv(host: Element, selector: string, fileName: string): boolean {
  const table = host.querySelector<HTMLTableElement>(selector);
  if (!table) return false;
  downloadCsv(fileName, tableToRows(table));
  return true;
}
