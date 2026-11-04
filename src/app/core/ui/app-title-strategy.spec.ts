import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { AppTitleStrategy, pageTitle } from './app-title-strategy';

@Component({ template: '' })
class Page {}

describe('ブラウザのタブの名前', () => {
  it('画面の名前に「｜社会保険管理システム」を添える。名前のない画面はアプリの名前だけ', () => {
    expect(pageTitle('従業員一覧')).toBe('従業員一覧｜社会保険管理システム');
    expect(pageTitle(undefined)).toBe('社会保険管理システム');
  });

  it('画面を移ると、タブの名前がその画面の名前になる', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'employees', title: '従業員一覧', component: Page },
          { path: 'employees/:id', title: '従業員の詳細', component: Page },
        ]),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/employees');
    expect(TestBed.inject(Title).getTitle()).toBe('従業員一覧｜社会保険管理システム');
    await harness.navigateByUrl('/employees/e1');
    expect(TestBed.inject(Title).getTitle()).toBe('従業員の詳細｜社会保険管理システム');
  });

  it('すべての画面（ルート）に名前がある', () => {
    const missing = routes.filter((r) => r.redirectTo === undefined && !r.title).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it('入力のある画面は、保存していない入力を確かめてから移る', () => {
    const guarded = routes.filter((r) => r.canDeactivate?.length).map((r) => r.path);
    expect(guarded).toEqual(['employees', 'employees/:id', 'bonuses', 'salaries', 'reconcile', 'settings']);
  });
});
