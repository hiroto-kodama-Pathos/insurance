// 年月・日付の表示をそろえる（設計書 3.0）：画面に出す年月は「2026年11月」、日付は「2026年11月19日」の形にする。
// 入力欄の値・保存する値は '2026-11'・'2026-11-19' のまま（表示だけを変える）。

/** '2026-11' → '2026年11月'。年月でない値（日付など）はそのまま返す */
export function yearMonthLabel(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[1]}年${Number(m[2])}月` : value;
}

/** '2026-11-19' → '2026年11月19日'。日付でない値（「（加入中）」など）はそのまま返す */
export function dateLabel(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : value;
}
