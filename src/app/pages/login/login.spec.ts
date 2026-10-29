import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Auth, AuthUser } from '../../core/auth/auth';
import { Login, loginErrorMessage } from './login';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let signInResult: AuthUser | Error;
  let signedOut: boolean;

  beforeEach(async () => {
    signedOut = false;
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            signIn: async () => {
              if (signInResult instanceof Error) throw signInResult;
              return signInResult;
            },
            signOut: async () => {
              signedOut = true;
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
  });

  async function submit(): Promise<HTMLElement> {
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    return el;
  }

  it('siRole のある人は、トップ（要確認）へ移る', async () => {
    signInResult = { uid: 'u', email: 'a@example.com', siRole: 'staff', siScope: 'all' };
    const router = TestBed.inject(Router);
    let navigated = '';
    router.navigateByUrl = (async (url: string) => {
      navigated = url;
      return true;
    }) as Router['navigateByUrl'];
    await submit();
    expect(navigated).toBe('/');
  });

  it('siRole のない人は、ログアウトして権限がないと表示する', async () => {
    signInResult = { uid: 'u', email: 'a@example.com', siRole: null, siScope: null };
    const el = await submit();
    expect(signedOut).toBe(true);
    expect(el.querySelector('.error')?.textContent).toContain('権限がありません');
  });

  it('パスワードが違うときは、分かることばで表示する', async () => {
    signInResult = Object.assign(new Error('x'), { code: 'auth/invalid-credential' });
    const el = await submit();
    expect(el.querySelector('.error')?.textContent).toContain('メールアドレスまたはパスワードが違います');
  });
});

describe('loginErrorMessage', () => {
  it('知らないエラーは、管理者への問い合わせを案内する', () => {
    expect(loginErrorMessage('auth/unknown')).toContain('管理者');
  });
});
