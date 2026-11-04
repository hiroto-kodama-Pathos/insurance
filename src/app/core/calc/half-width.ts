// 全角・半角のどちらで入れても受け付けるための共通部品（設計書 3.0）
// 数字・金額・時間・社員番号・メールアドレスは、半角にそろえてから読む。氏名などの文章は、入れたとおりに残す。

/**
 * 数字・英字・記号を半角にそろえる
 * - NFKC：全角の英数字・記号は半角に（「１２，３４５」→「12,345」「．」→「.」「：」→「:」、全角の空白は半角の空白に）
 * - 横線のなかま（日本語入力で「-」のキーを押すと入る「ー」、全角の「−」「‐」など）は、半角の「-」に
 * 文章（氏名など）には使わない。カタカナの「ー」まで「-」になってしまうため
 */
export function toHalfWidth(s: string): string {
  return s.normalize('NFKC').replace(/[‐-―−ーｰ]/g, '-');
}

/**
 * 入力欄の数字（金額・日数・時間）を読む。全角でも半角でもよい
 * カンマ・空白と、「円」「日」「時間」の単位は取り除く。空欄は null、数字として読めなければ NaN
 */
export function parseNumberInput(value: string | null | undefined): number | null {
  const t = toHalfWidth(value ?? '').replace(/[,\s円¥日時間]/g, '');
  return t === '' ? null : Number(t);
}
