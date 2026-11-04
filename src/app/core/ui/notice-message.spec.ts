import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { autoCloses, isFailureMessage, NOTICE_AUTO_CLOSE_MS, NoticeMessage } from './notice-message';

describe('知らせの文の種類', () => {
  it('うまくいかなかった知らせ・入力を求める知らせは赤', () => {
    expect(isFailureMessage('保存できませんでした。権限と通信を確かめてください。')).toBe(true);
    expect(isFailureMessage('精算する給与の月を入れてください。')).toBe(true);
  });
  it('うまくいった知らせは、案内の「ください」を含んでも緑', () => {
    expect(isFailureMessage('田中さんを登録しました。資格取得届を5日以内に届け出てください。')).toBe(false);
    expect(isFailureMessage('納付書の金額を保存しました')).toBe(false);
  });
});

@Component({
  imports: [NoticeMessage],
  template: `@if (message()) { <app-notice [message]="message()!" (closed)="message.set(null)" /> }`,
})
class Host {
  readonly message = signal<string | null>(null);
}

describe('知らせの出し方', () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    const show = (m: string) => {
      fixture.componentInstance.message.set(m);
      fixture.detectChanges();
    };
    const shown = () => {
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).querySelector('app-notice .text')?.textContent ?? null;
    };
    return { fixture, show, shown };
  }

  it('自動で閉じるのは「保存しました」だけの知らせ。うまくいかなかった知らせ・案内（届出の期限など）を含む知らせは残す', () => {
    expect(autoCloses('納付書の金額を保存しました')).toBe(true);
    expect(autoCloses('田中さんを登録しました。資格取得届を5日以内に届け出てください。')).toBe(false);
    expect(autoCloses('保存できませんでした。権限と通信を確かめてください。')).toBe(false);
  });

  it('案内を含む知らせは、時間がたっても残す', () => {
    const { show, shown } = setup();
    show('田中さんを登録しました。資格取得届を5日以内に届け出てください。');
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS * 3);
    expect(shown()).toBe('田中さんを登録しました。資格取得届を5日以内に届け出てください。');
  });

  it('「保存しました」だけの知らせは、10秒で閉じる。マウスを乗せている間は閉じない', () => {
    const { fixture, show, shown } = setup();
    show('納付書の金額を保存しました');
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS - 1);
    expect(shown()).toBe('納付書の金額を保存しました');
    // マウスを乗せている間は閉じない。離すと、そこから数え直す
    const p = (fixture.nativeElement as HTMLElement).querySelector('.notice')!;
    p.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS * 2);
    expect(shown()).toBe('納付書の金額を保存しました');
    p.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS);
    expect(shown()).toBeNull();
  });

  it('うまくいかなかった知らせは、× で閉じるまで残す', () => {
    const { fixture, show, shown } = setup();
    show('保存できませんでした。権限と通信を確かめてください。');
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS * 3);
    expect(shown()).toBe('保存できませんでした。権限と通信を確かめてください。');
    ((fixture.nativeElement as HTMLElement).querySelector('button.close') as HTMLButtonElement).click();
    expect(shown()).toBeNull();
  });

  it('次の知らせが出たら、そこから10秒数え直す', () => {
    const { show, shown } = setup();
    show('Aを保存しました');
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS - 1000);
    show('Bを保存しました');
    vi.advanceTimersByTime(NOTICE_AUTO_CLOSE_MS - 1000);
    expect(shown()).toBe('Bを保存しました');
  });
});
