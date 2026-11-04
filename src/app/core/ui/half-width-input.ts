// 数字・社員番号・メールアドレスの入力欄で、全角で入れた文字を、入れたそばから半角にする（設計書 3.0）
// 画面ごとの入力の処理（(input)="…"）を変えずに、全画面の欄に効かせるため、ページ全体（document）で入力を受ける。
//
// 日本語入力（IME）で変換している間（「１２３」の下に線が出ている間）は、画面の処理に渡さない。
// 変換の途中で欄の文字を書き換えると、変換が切れて文字が二重に入ることがあるため。
// 確定したとき（compositionend）に半角にして、あらためて input の知らせを出し、画面の処理に渡す。
import { toHalfWidth } from '../calc/half-width';

/**
 * 半角にそろえる欄か
 * - 数字の欄（inputmode="numeric"・"decimal"）
 * - メールアドレスの欄（type="email"）
 * - data-halfwidth を付けた欄（社員番号など、英数字で決まった形のもの）
 */
export function isHalfWidthField(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false;
  const mode = target.getAttribute('inputmode');
  return mode === 'numeric' || mode === 'decimal' || target.type === 'email' || target.hasAttribute('data-halfwidth');
}

/** 欄の文字を半角にする。変わったときだけ書き換え、カーソルの位置を保つ */
export function convertField(el: HTMLInputElement): void {
  const before = el.value;
  const after = toHalfWidth(before);
  if (after === before) return;
  let caret: number | null = null;
  try {
    caret = el.selectionStart; // type="email" では使えない（null か例外）
  } catch {
    caret = null;
  }
  el.value = after;
  if (caret !== null) {
    const pos = toHalfWidth(before.slice(0, caret)).length;
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      // カーソルを置けない欄（type="email" など）は、そのままでよい
    }
  }
}

/** ページ全体に仕掛ける。戻り値を呼ぶと外す（テスト用） */
export function installHalfWidthInput(doc: Document): () => void {
  const onInput = (e: Event) => {
    if (!isHalfWidthField(e.target)) return;
    if ((e as InputEvent).isComposing) {
      // 変換中は画面の処理に渡さない（確定したときに渡す）
      e.stopImmediatePropagation();
      return;
    }
    convertField(e.target);
  };
  const onCompositionEnd = (e: Event) => {
    if (!isHalfWidthField(e.target)) return;
    convertField(e.target);
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // capture（true）で、画面の処理より先に受ける
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('compositionend', onCompositionEnd, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('compositionend', onCompositionEnd, true);
  };
}
