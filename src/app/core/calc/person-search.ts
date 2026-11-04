// 一覧の検索（氏名・社員番号）と、絞り込みの選択肢の共通部品（設計書 3.0）

/** 空白（半角・全角）を取り除く。「山田太郎」でも「山田 太郎」が見つかるようにする */
export const removeSpaces = (s: string) => s.replace(/[\s　]/g, '');

/**
 * 検索で比べるための形にそろえる（検索の文字と、社員番号・氏名の両方に使う）
 * - NFKC：全角の英数字・記号は半角に（「０００１」→「0001」）、半角カタカナは全角に（「ﾔﾏﾀﾞ」→「ヤマダ」。濁点もまとめる）
 * - 英字は小文字に（「T0001」と「t0001」を同じにする）
 * - 空白（半角・全角）を取り除く
 */
export function normalizeForSearch(s: string): string {
  return removeSpaces(s.normalize('NFKC').toLowerCase());
}

/** 社員番号か氏名に、検索の文字が含まれるか（空白・全角半角・英字の大小は区別しない）。検索が空ならいつも true */
export function matchesPerson(employeeNumber: string, name: string, query: string): boolean {
  const q = normalizeForSearch(query);
  return q === '' || normalizeForSearch(employeeNumber).includes(q) || normalizeForSearch(name).includes(q);
}

/** 絞り込みの選択肢：並び順を保ったまま、重複と空を除く */
export function distinctOptions(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}
