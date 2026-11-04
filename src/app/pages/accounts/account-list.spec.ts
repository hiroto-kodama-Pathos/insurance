import { Confirm, ConfirmRequest } from '../../core/ui/confirm';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { AccountView } from '../../core/calc/account';
import { AccountRepository } from '../../core/repository/account-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { AccountList } from './account-list';


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('AccountList', () => {
  let fixture: ComponentFixture<AccountList>;
  let store: AccountView[];
  let calls: unknown[][];

  beforeEach(async () => {
    calls = [];
    store = [
      { uid: 'a1', email: 'admin@example.com', siRole: 'admin', siScope: 'all', disabled: false, lastSignIn: null },
      { uid: 'u2', email: 'osaka@example.com', siRole: 'staff', siScope: 'osaka', disabled: false, lastSignIn: null },
    ];
    await TestBed.configureTestingModule({
      imports: [AccountList],
      providers: [
        confirmStub,
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'a1', email: 'admin@example.com', siRole: 'admin', siScope: 'all' }), isAdmin: signal(true) } },
        {
          provide: MasterRepository,
          useValue: { loadMasters: async () => ({ offices: [{ id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' }], insurers: [], insurerRates: [], pensionRates: [] }) },
        },
        {
          provide: AccountRepository,
          useValue: {
            list: async () => [...store],
            create: async (x: { email: string; siRole: 'staff'; siScope: string }) => {
              calls.push(['create', x]);
              store.push({ uid: 'n', email: x.email, siRole: x.siRole, siScope: x.siScope, disabled: false, lastSignIn: null });
              return { uid: 'n', created: true };
            },
            update: async (...a: unknown[]) => calls.push(['update', ...a]),
            remove: async (...a: unknown[]) => calls.push(['remove', ...a]),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountList);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;

  it('一覧に権限と担当範囲を出す。自分は「使えないようにする」を出さない', () => {
    const rows = [...el().querySelectorAll('table.accounts tbody tr')];
    expect(rows[0].textContent).toContain('管理者');
    expect(rows[0].textContent).toContain('全担当');
    expect(rows[0].textContent).not.toContain('使えないようにする');
    expect(rows[1].textContent).toContain('大阪支店');
    expect(rows[1].textContent).toContain('使えないようにする');
  });

  it('担当範囲を選ばないと発行しない。選ぶと発行し、初期パスワードを伝える旨を出す', async () => {
    const set = (name: string, v: string) => {
      const x = el().querySelector(`[name=${name}]`) as HTMLInputElement;
      x.value = v;
      x.dispatchEvent(new Event(x.tagName === 'SELECT' ? 'change' : 'input'));
    };
    set('email', 'nagoya@example.com');
    set('password', 'initial-pass');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('担当範囲を選んでください');
    set('scope', 'all');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(calls[0]).toEqual(['create', { email: 'nagoya@example.com', password: 'initial-pass', siRole: 'staff', siScope: 'all' }]);
    expect(el().textContent).toContain('アカウントを発行しました');
  });

  it('権限を変える・使えないようにする', async () => {
    const row = () => [...el().querySelectorAll('table.accounts tbody tr')][1];
    button(row(), '権限を変える').click();
    fixture.detectChanges();
    const scope = row().querySelector('select[name=editScope]') as HTMLSelectElement;
    scope.value = 'all';
    scope.dispatchEvent(new Event('change'));
    button(row(), '保存').click();
    await settle();
    expect(calls[0]).toEqual(['update', 'u2', 'staff', 'all']);
    button(row(), '使えないようにする').click();
    await settle();
    expect(calls[1]).toEqual(['remove', 'u2']);
  });
});
