import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Auth, AuthUser } from './core/auth/auth';
import { Confirm } from './core/ui/confirm';

function setup(user: AuthUser | null) {
  const u = signal(user);
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: {
          user: u,
          canUse: computed(() => u()?.siRole != null),
          isAdmin: computed(() => u()?.siRole === 'admin'),
          signOut: async () => u.set(null),
        },
      },
    ],
  });
}

describe('App', () => {
  it('ログイン中は、メニューと利用者名を表示する', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav')?.textContent).toContain('要確認');
    expect(el.querySelector('nav')?.textContent).toContain('月次保険料一覧'); // 画面名・カタログと同じ名前
    expect(el.querySelector('nav')?.textContent).toContain('給与');
    expect(el.querySelector('nav')?.textContent).toContain('随時改定');
    expect(el.querySelector('nav')?.textContent).toContain('定時決定');
    expect(el.querySelector('nav')?.textContent).toContain('差額');
    expect(el.querySelector('.user')?.textContent).toContain('a@example.com（管理者）');
    expect(el.textContent).toContain('設定');
  });

  it('担当者には設定のメニューを出さない', async () => {
    setup({ uid: 'u', email: 's@example.com', siRole: 'staff', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')].map((a) => a.textContent);
    expect(links).not.toContain('設定');
  });

  it('ログアウト中は、メニューを表示しない', async () => {
    setup(null);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.app-title')?.textContent).toContain('社会保険管理システム');
    expect(el.querySelector('nav')).toBeNull();
  });
});

describe('App のメニューと確認', () => {
  it('メニューは仕事の流れでまとめ、CSV取り込みもある', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const groups = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav .group-label, nav .group-toggle')].map((g) => g.textContent!.replace('▾', '').trim());
    expect(groups).toEqual(['毎月', '改定', '届出・精算', '登録情報']);
    expect((fixture.nativeElement as HTMLElement).querySelector('nav')!.textContent).toContain('CSV取り込み');
  });

  it('「毎月」は画面を並べたまま。改定・届出・精算・登録情報は見出しだけを出し、押すと一覧が開く（ツリー）', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    await fixture.whenStable();
    fixture.detectChanges();
    const toggle = (label: string) => [...el.querySelectorAll('button.group-toggle')].find((b) => b.textContent!.includes(label)) as HTMLButtonElement;
    const menuOf = (label: string) => toggle(label).nextElementSibling as HTMLElement;

    // 毎月の画面はいつも見えている。ほかの見出しの中は閉じている
    expect([...el.querySelectorAll('nav .group:not(.dropdown) a')].map((a) => a.textContent!.trim())).toEqual(['要確認', '月次保険料一覧', '給与', '賞与', '照合']);
    for (const g of ['改定', '届出・精算', '登録情報']) {
      expect(menuOf(g).hidden).toBe(true);
      expect(toggle(g).getAttribute('aria-expanded')).toBe('false');
    }

    // 見出しを押すと開き、ほかの見出しを押すとそちらに切り替わる
    toggle('改定').click();
    fixture.detectChanges();
    expect(menuOf('改定').hidden).toBe(false);
    expect(toggle('改定').getAttribute('aria-expanded')).toBe('true');
    expect(menuOf('改定').textContent).toContain('随時改定');
    expect(menuOf('改定').textContent).toContain('固定的賃金が変わった人の判定'); // 画面の説明も添える
    toggle('届出・精算').click();
    fixture.detectChanges();
    expect(menuOf('改定').hidden).toBe(true);
    expect(menuOf('届出・精算').hidden).toBe(false);

    // Esc・メニューの外を押す・もう一度見出しを押す、で閉じる
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(menuOf('届出・精算').hidden).toBe(true);
    toggle('登録情報').click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(menuOf('登録情報').hidden).toBe(true);
    toggle('登録情報').click();
    toggle('登録情報').click();
    fixture.detectChanges();
    expect(menuOf('登録情報').hidden).toBe(true);
    el.remove();
  });

  it('今いる画面が入っている見出しを強調する（届出の期限を開いているときは「届出・精算」）', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    fixture.componentRef.instance['url'].set('/filings?x=1');
    fixture.detectChanges();
    const active = [...el.querySelectorAll('button.group-toggle.active')].map((b) => b.textContent!.replace('▾', '').trim());
    expect(active).toEqual(['届出・精算']);
    // 従業員の詳細（/employees/e1）は「登録情報」
    fixture.componentRef.instance['url'].set('/employees/e1');
    fixture.detectChanges();
    expect([...el.querySelectorAll('button.group-toggle.active')].map((b) => b.textContent!.replace('▾', '').trim())).toEqual(['登録情報']);
    // 要確認（/）は「毎月」なので、どの見出しも強調しない
    fixture.componentRef.instance['url'].set('/');
    fixture.detectChanges();
    expect(el.querySelectorAll('button.group-toggle.active')).toHaveLength(0);
  });

  it('確認を出し、押したボタンの結果を返す', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const confirm = TestBed.inject(Confirm);
    const result = confirm.ask({ title: '確定しますか', message: '本社の2026-10分を確定します', ok: '確定する' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role=alertdialog]')!.textContent).toContain('本社の2026-10分を確定します');
    (el.querySelector('button.confirm-ok') as HTMLButtonElement).click();
    expect(await result).toBe(true);
    fixture.detectChanges();
    expect(el.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('確認を出すと「やめる」にカーソルが入り、Esc で閉じ、閉じたら押した元のボタンにカーソルが戻る', async () => {
    setup({ uid: 'u', email: 'a@example.com', siRole: 'admin', siScope: 'all' });
    const fixture = TestBed.createComponent(App);
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el); // カーソル（focus）を確かめるため、画面に置く
    await fixture.whenStable();
    const origin = document.createElement('button');
    document.body.appendChild(origin);
    origin.focus();

    const result = TestBed.inject(Confirm).ask({ title: '削除しますか', message: '元に戻せません', ok: '削除する', danger: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(el.querySelector('button.confirm-cancel'));

    // Tab・Shift+Tab では、2つのボタンの間だけを行き来する
    const dialog = el.querySelector('[role=alertdialog]') as HTMLElement;
    (el.querySelector('button.confirm-ok') as HTMLButtonElement).focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(el.querySelector('button.confirm-cancel'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(el.querySelector('button.confirm-ok'));

    // カーソルがどこにあっても Esc で閉じる（やめるを選んだことになる）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBe(false);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alertdialog]')).toBeNull();
    expect(document.activeElement).toBe(origin);
    origin.remove();
    el.remove();
  });
});
