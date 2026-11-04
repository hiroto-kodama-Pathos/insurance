import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installHalfWidthInput, isHalfWidthField } from './half-width-input';

// 画面の (input)="…" の代わりに、欄に直接つけた処理が受け取った値を記録する
describe('入力欄の全角を半角にする（ページ全体の仕掛け）', () => {
  let uninstall: () => void;
  let received: string[];

  beforeEach(() => {
    uninstall = installHalfWidthInput(document);
    received = [];
  });
  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function field(attrs: Record<string, string>): HTMLInputElement {
    const el = document.createElement('input');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.addEventListener('input', () => received.push(el.value));
    document.body.appendChild(el);
    return el;
  }
  const type = (el: HTMLInputElement, value: string, isComposing = false) => {
    el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing }));
  };

  it('数字の欄（inputmode="numeric"）：全角の数字を半角にしてから、画面の処理に渡す', () => {
    const el = field({ inputmode: 'numeric' });
    type(el, '３００，０００');
    expect(el.value).toBe('300,000');
    expect(received).toEqual(['300,000']);
  });

  it('日本語入力で変換している間は画面の処理に渡さず、確定したときに半角にして渡す', () => {
    const el = field({ inputmode: 'numeric' });
    type(el, '３', true);
    type(el, '３０', true);
    expect(received).toEqual([]); // 変換中は渡さない
    expect(el.value).toBe('３０'); // 変換中の文字は書き換えない（変換が切れないように）
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '３０' }));
    expect(el.value).toBe('30');
    expect(received).toEqual(['30']);
  });

  it('社員番号（data-halfwidth）・メールアドレス（type="email"）・小数の欄（inputmode="decimal"）も半角にする', () => {
    const number = field({ 'data-halfwidth': '' });
    type(number, 'Ａー００１');
    expect(number.value).toBe('A-001');
    const mail = field({ type: 'email' });
    type(mail, 'ｙａｍａｄａ＠ｅｘａｍｐｌｅ．ｃｏｍ');
    expect(mail.value).toBe('yamada@example.com');
    const hours = field({ inputmode: 'decimal' });
    type(hours, '８６．５');
    expect(hours.value).toBe('86.5');
  });

  it('氏名などの文章の欄は、入れたとおりに残す（カタカナの「ー」も変えない）', () => {
    const name = field({ name: 'name' });
    type(name, 'ヤマダ　ルーシー');
    expect(name.value).toBe('ヤマダ　ルーシー');
    expect(received).toEqual(['ヤマダ　ルーシー']);
    expect(isHalfWidthField(name)).toBe(false);
  });

  it('文章の欄では、変換中でも画面の処理に渡す（検索欄で、打つそばから絞り込めるように）', () => {
    const search = field({ type: 'search' });
    type(search, 'やまだ', true);
    expect(received).toEqual(['やまだ']);
  });

  it('カーソルの位置を保つ（途中に全角の数字を入れたとき）', () => {
    const el = field({ inputmode: 'numeric' });
    el.value = '10０00';
    el.setSelectionRange(3, 3);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(el.value).toBe('10000');
    expect(el.selectionStart).toBe(3);
  });

  it('外すと、もう書き換えない', () => {
    uninstall();
    const el = field({ inputmode: 'numeric' });
    type(el, '１');
    expect(el.value).toBe('１');
    uninstall = () => undefined;
  });
});
