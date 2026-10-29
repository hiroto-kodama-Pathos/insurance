import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Auth, AuthUser } from './core/auth/auth';

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
    expect(el.querySelector('nav')?.textContent).toContain('月次保険料一覧');
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
