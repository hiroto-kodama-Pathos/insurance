// 入力欄を開いたら、そのフォームまで動かして最初の欄にカーソルを置く（設計書 3.0）
// 「追加」「直す」を押してすぐ入力を始められるように。開く前からあるフォーム（設定の会社の設定など）には動かない。

/** カーソルを置く欄（隠し項目・チェックボックス・使えない欄は飛ばす） */
const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * 入力欄を開く直前に呼ぶ。画面を描き直したあとで、新しく出たフォーム（なければ画面のフォーム）の最初の欄へ移る
 * @param host 画面の要素名（'app-employee-detail' など）
 * @param onlyNew 開く前からあるフォームには移らない（1画面に複数のフォームがある画面）
 */
export function focusFormSoon(host: string, onlyNew = false): void {
  const before = new Set(document.querySelectorAll(`${host} form.form`));
  setTimeout(() => {
    const forms = [...document.querySelectorAll<HTMLElement>(`${host} form.form`)];
    const form = forms.find((f) => !before.has(f)) ?? (onlyNew ? null : forms[0] ?? null);
    if (!form) return;
    if (typeof form.scrollIntoView === 'function') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector<HTMLElement>(FIELD)?.focus({ preventScroll: true });
  });
}
