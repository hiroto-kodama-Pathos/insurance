import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Auth } from '../auth/auth';
import { PageState } from './page-state';

describe('一覧の絞り込みを覚える', () => {
  const user = signal<{ uid: string } | null>({ uid: 'u1' });

  @Component({ template: '' })
  class ListPage {
    readonly query = signal('');
    readonly office = signal('');
    constructor() {
      inject(PageState).keep('test.query', this.query);
      inject(PageState).keep('test.office', this.office);
    }
  }

  beforeEach(() => {
    user.set({ uid: 'u1' });
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: { user } }] });
  });

  it('画面を離れて戻ってきたら、前の絞り込みに戻す（ほかの人がログインしたら引き継がない）', () => {
    const first = TestBed.createComponent(ListPage);
    first.componentInstance.query.set('山田');
    first.componentInstance.office.set('osaka');
    TestBed.tick();
    first.destroy();

    const again = TestBed.createComponent(ListPage);
    expect(again.componentInstance.query()).toBe('山田');
    expect(again.componentInstance.office()).toBe('osaka');
    again.destroy();

    user.set({ uid: 'u2' });
    const other = TestBed.createComponent(ListPage);
    expect(other.componentInstance.query()).toBe('');
  });
});
