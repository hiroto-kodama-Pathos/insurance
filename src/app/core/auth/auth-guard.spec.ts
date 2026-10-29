import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Auth, AuthUser } from './auth';
import { authGuard } from './auth-guard';

function fakeAuth(user: AuthUser | null) {
  const u = signal(user);
  return {
    user: u,
    canUse: () => u()?.siRole != null,
    isAdmin: () => u()?.siRole === 'admin',
    whenReady: async () => {},
  };
}

async function run(user: AuthUser | null, url = '/monthly') {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Auth, useValue: fakeAuth(user) }],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

const staff: AuthUser = { uid: 'u1', email: 'a@example.com', siRole: 'staff', siScope: 'all' };

describe('authGuard', () => {
  it('siRole のある人は通す', async () => {
    expect(await run(staff)).toBe(true);
  });

  it('ログインしていない人は、戻り先つきでログイン画面へ', async () => {
    const r = (await run(null, '/monthly')) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/login?returnUrl=%2Fmonthly');
  });

  it('siRole のない人（第二課題だけの人）は、権限なしとしてログイン画面へ', async () => {
    const r = (await run({ ...staff, siRole: null })) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/login?denied=1');
  });
});
