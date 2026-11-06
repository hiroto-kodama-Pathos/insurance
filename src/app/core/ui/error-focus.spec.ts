import { Component, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { focusFirstError, installErrorFocus } from './error-focus';

describe('入力の誤りへ移る', () => {
  function form(html: string): HTMLFormElement {
    const f = document.createElement('form');
    f.innerHTML = html;
    document.body.appendChild(f);
    return f;
  }
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    document.querySelectorAll('form').forEach((f) => f.remove());
    Element.prototype.scrollIntoView = original;
  });

  it('文の入っている最初のエラーの欄にカーソルを置き、そこへスクロールする（空のエラーの入れ物は飛ばす）', () => {
    const f = form(`
      <label>社員番号<input name="a" /><span class="err"></span></label>
      <label>氏名<input name="b" /><span class="err">氏名を入れてください</span></label>
      <label>生年月日<input name="c" /><span class="err">日付を入れてください</span></label>`);
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    expect(focusFirstError(f)).toBe(true);
    expect((document.activeElement as HTMLInputElement).name).toBe('b');
    expect((scrolled[0] as HTMLInputElement).name).toBe('b');
  });

  it('欄のないエラー（登録できなかったなど）は、文へスクロールする。エラーがなければ何もしない', () => {
    const f = form(`<div class="actions"><button>登録する</button><span class="err">登録できませんでした。</span></div>`);
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    expect(focusFirstError(f)).toBe(true);
    expect(scrolled[0].textContent).toBe('登録できませんでした。');
    expect(focusFirstError(form(`<label>氏名<input /><span class="err"></span></label>`))).toBe(false);
  });

  it('登録を押して画面がエラーを出したら、描き直したあとで最初の誤りの欄へ移る（全フォームに効く）', async () => {
    @Component({
      template: `<form class="form" (submit)="save($event)">
        <label>社員番号<input name="no" /><span class="err">{{ error() }}</span></label>
        <button type="submit">登録する</button>
      </form>`,
    })
    class Page {
      readonly error = signal('');
      save(e: Event) {
        e.preventDefault();
        this.error.set('社員番号を入れてください');
      }
    }
    Element.prototype.scrollIntoView = () => {};
    const fixture = TestBed.createComponent(Page);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const remove = installErrorFocus(document, TestBed.inject(Injector));
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((document.activeElement as HTMLInputElement).name).toBe('no');
    remove();
    fixture.nativeElement.remove();
  });

  it('欄を入力し直したら、その欄のエラーだけを隠し、もう一度保存を押したら戻す（残った誤りだけが見える）', () => {
    const remove = installErrorFocus(document, TestBed.inject(Injector));
    const f = form(`
      <label>氏名<input name="a" /><span class="err">氏名を入れてください</span></label>
      <label>退職日<input name="b" /></label>
      <span class="err">退職日を入れてください</span>
      <label>理由<select name="c"><option>x</option></select></label>
      <span class="err">理由を選んでください</span>
      <button type="submit">保存</button>`);
    f.addEventListener('submit', (e) => e.preventDefault());
    const errs = () => [...f.querySelectorAll('.err')].map((x) => x.hasAttribute('data-stale'));
    f.querySelector('input[name=a]')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(errs()).toEqual([true, false, false]);
    // エラーの文が label の外（すぐ後ろ）にある画面でも、その欄のエラーだけを隠す
    f.querySelector('input[name=b]')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(errs()).toEqual([true, true, false]);
    f.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(errs()).toEqual([true, true, true]);
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(errs()).toEqual([false, false, false]);
    remove();
  });
});
