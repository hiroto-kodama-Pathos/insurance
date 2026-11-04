// 登録・保存を押して入力に誤りがあったら、最初の誤りの欄へ移る（設計書 3.0）
// 長いフォーム（従業員の新規登録など）で、画面の外の欄にエラーが出ても気づけるように。
// 画面ごとの保存の処理を変えずに全フォームに効かせるため、ページ全体（document）で送信を受ける。
// 画面の処理（(submit)="save($event)"）がエラーを出し、画面を描き直したあとで、最初のエラー（.err）を探す。
import { afterNextRender, Injector } from '@angular/core';

/** フォームの中の最初のエラーへスクロールし、その欄にカーソルを置く。エラーがあれば true */
export function focusFirstError(form: HTMLElement): boolean {
  // エラーの文の入れ物は、エラーがなくても空で置いている画面があるので、文の入っているものだけを見る
  const err = [...form.querySelectorAll<HTMLElement>('.err')].find((x) => (x.textContent ?? '').trim() !== '');
  if (!err) return false;
  // エラーの文は、欄と同じ label の中に置いている。欄が見つからなければ（フォーム全体のエラーなど）、文へスクロールする
  const box = err.closest('label') ?? err.parentElement;
  const field = box?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') ?? null;
  const target = field ?? err;
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field?.focus({ preventScroll: true });
  return true;
}

/** ページ全体に仕掛ける。戻り値を呼ぶと外す（テスト用） */
export function installErrorFocus(doc: Document, injector: Injector): () => void {
  const onSubmit = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    // 画面の処理は、フォームでの送信の知らせを先に受ける（ページ全体へは、そのあとに届く）
    afterNextRender(() => focusFirstError(form), { injector });
  };
  doc.addEventListener('submit', onSubmit);
  return () => doc.removeEventListener('submit', onSubmit);
}
