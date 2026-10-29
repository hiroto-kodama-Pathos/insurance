// CSVの読み取り（設計書 3.8 取り込み時の処理）
// 給与ソフトのCSVは、文字コード（Shift_JIS・UTF-8）や日付・金額の書き方がまちまちなので、ここでそろえる。
import { isValidDate } from './new-employee';

/** 文字コードを自動で判定して文字列にする（BOMつき・UTF-8として読めればUTF-8、読めなければShift_JIS） */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** CSVを行・列に分ける。「"」で囲んだ列の中のカンマ・改行・「""」に対応する。空の行は除く */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const ERA_START: Record<string, number> = { R: 2018, 令和: 2018, H: 1988, 平成: 1988 };

/**
 * 日付を 'YYYY-MM-DD' にする。読めなければ null
 * 2026/10/25、2026-10-25、2026.10.25、20261025、2026年10月25日、R8.10.25、令和8年10月25日
 */
export function parseDateLoose(value: string): string | null {
  const v = value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(R|H|令和|平成)\s*(\d{1,2}|元)[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/i))) {
    const n = match[2] === '元' ? 1 : Number(match[2]);
    [y, m, d] = [ERA_START[match[1].toUpperCase()] + n, Number(match[3]), Number(match[4])];
  } else return null;
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(date) ? date : null;
}

/** 金額・日数を整数にする（カンマ・円・¥・空白を取り除く）。空欄は null、読めなければ NaN */
export function parseNumberLoose(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s円¥￥日]/g, '');
  if (v === '') return null;
  return /^-?\d+$/.test(v) ? Number(v) : NaN;
}
