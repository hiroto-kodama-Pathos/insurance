import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { adminGuard } from './admin-guard';
import { Auth, AuthUser } from './auth';

async function run(user: AuthUser | null) {
  const u = signal(user);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: {
          user: u,
          canUse: () => u()?.siRole != null,
          isAdmin: () => u()?.siRole === 'admin',
          whenReady: async () => {},
        },
      },
    ],
  });
  return TestBed.runInInjectionContext(() =>
    adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
}

const base: AuthUser = { uid: 'u1', email: 'a@example.com', siRole: 'admin', siScope: 'all' };

describe('adminGuard', () => {
  it('管理者は通す', async () => {
    expect(await run(base)).toBe(true);
  });

  it('担当者はトップ（要確認）へ戻す', async () => {
    const r = (await run({ ...base, siRole: 'staff' })) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/');
  });

  it('ログインしていない人はログイン画面へ', async () => {
    const r = (await run(null)) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/login');
  });
});
