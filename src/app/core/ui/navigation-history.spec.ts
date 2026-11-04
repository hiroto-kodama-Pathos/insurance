import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter } from '@angular/router';
import { NavigationHistory, screenLabel } from './navigation-history';

describe('前に開いていた画面', () => {
  it('URL から画面の名前を求める（クエリは無視する。長い URL を先に照らし合わせる）', () => {
    expect(screenLabel('/')).toBe('要確認');
    expect(screenLabel('/monthly?month=2026-10')).toBe('月次保険料一覧');
    expect(screenLabel('/employees')).toBe('従業員一覧');
    expect(screenLabel('/employees/e1')).toBe('従業員の詳細');
    expect(screenLabel('/salaries/import')).toBe('給与のCSV取り込み');
    expect(screenLabel('/salaries')).toBe('給与');
    expect(screenLabel('/unknown')).toBeNull();
  });

  it('ひとつ前の画面を返す。同じ URL の読み込み直しは数えず、ログイン画面は返さない', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const h = TestBed.inject(NavigationHistory);
    expect(h.previous()).toBeNull();
    h.record('/login');
    h.record('/');
    expect(h.previous()).toBeNull(); // ログイン画面には戻さない
    h.record('/monthly');
    h.record('/employees/e1');
    h.record('/employees/e1');
    expect(h.previous()).toBe('/monthly');
  });
});

describe('前に開いていた画面（実際の画面の移り変わり）', () => {
  it('開いた画面の部品を作るときに、ひとつ前の画面が分かる（その前の画面ではなく）。同じ従業員をもう一度開いても、元の画面に戻れる', async () => {
    const seen: (string | null)[] = [];
    @Component({ template: '' })
    class Page {
      constructor() {
        seen.push(inject(NavigationHistory).previous());
      }
    }
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'regular', component: Page }, { path: 'bonuses', component: Page }, { path: 'employees/:id', component: Page }])],
    });
    TestBed.inject(NavigationHistory);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/employees/e1');
    await harness.navigateByUrl('/regular');
    await harness.navigateByUrl('/employees/e1');
    expect(seen.at(-1)).toBe('/regular'); // 「従業員の詳細（e1 自身）」ではなく定時決定へ戻る
    await harness.navigateByUrl('/bonuses');
    await harness.navigateByUrl('/regular');
    await harness.navigateByUrl('/employees/e2');
    expect(seen.at(-1)).toBe('/regular'); // 賞与ではなく定時決定へ戻る
    expect(TestBed.inject(NavigationHistory).previous()).toBe('/regular'); // 移り終わったあとも同じ
  });
});
