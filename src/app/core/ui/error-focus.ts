// 登録・保存を押して入力に誤りがあったら、最初の誤りの欄へ移る。欄を入力し直したら、その欄のエラーを隠す（設計書 3.0）
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

/**
 * 入力した欄のエラーを探す。エラーの文は、欄と同じ label の中か、label のすぐ後ろ（次の欄の前まで）に置いている
 */
export function errorsOfField(field: HTMLElement): HTMLElement[] {
  const box = field.closest('label');
  if (!box) return [];
  const inside = [...box.querySelectorAll<HTMLElement>('.err')];
  if (inside.length) return inside;
  const after: HTMLElement[] = [];
  for (let x = box.nextElementSibling; x && !x.matches('label, fieldset, .actions'); x = x.nextElementSibling) {
    if (x.matches('.err')) after.push(x as HTMLElement);
  }
  return after;
}

/** ページ全体に仕掛ける。戻り値を呼ぶと外す（テスト用） */
export function installErrorFocus(doc: Document, injector: Injector): () => void {
  const onSubmit = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    // 画面の処理は、フォームでの送信の知らせを先に受ける（ページ全体へは、そのあとに届く）
    afterNextRender(() => focusFirstError(form), { injector });
  };
  // もう一度保存を押したら、隠していたエラーを戻す（画面の処理がチェックし直して、残ったエラーだけが見える）。
  // 画面の処理より先に戻すため、捕捉（capture）で受ける
  const reveal = (form: Element | null) => form?.querySelectorAll('.err[data-stale]').forEach((x) => x.removeAttribute('data-stale'));
  const onSubmitCapture = (e: Event) => reveal(e.target instanceof HTMLFormElement ? e.target : null);
  // フォームの中のボタン（「提案を入力」など）でエラーを出し直すこともあるので、押したときも戻す
  const onClickCapture = (e: Event) => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    if (button && button.type !== 'submit') reveal(button.closest('form'));
  };
  // 欄を入力し直したら、その欄のエラーをすぐ隠す（直したのに赤い文が残り続けないように）
  const onInput = (e: Event) => {
    const field = e.target;
    if (!(field instanceof HTMLElement) || !field.matches('input, select, textarea')) return;
    for (const err of errorsOfField(field)) err.setAttribute('data-stale', '');
  };
  doc.addEventListener('submit', onSubmitCapture, true);
  doc.addEventListener('click', onClickCapture, true);
  doc.addEventListener('submit', onSubmit);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onInput);
  return () => {
    doc.removeEventListener('submit', onSubmitCapture, true);
    doc.removeEventListener('click', onClickCapture, true);
    doc.removeEventListener('submit', onSubmit);
    doc.removeEventListener('input', onInput);
    doc.removeEventListener('change', onInput);
  };
}
