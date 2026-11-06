import { Component, computed, effect, input, output, signal } from '@angular/core';

/** 知らせの文が、うまくいかなかったことを伝えるものか（赤で出す） */
export function isFailureMessage(message: string): boolean {
  if (/できませんでした|ませんでした/.test(message)) return true;
  // 「使用中なので、削除できません」など、できなかったことを伝える文
  if (/できません[。（]/.test(message)) return true;
  // 「〜しました」を含まず、「〜してください」だけの文は、入力の誤りなどの知らせ
  return !/しました|しています|なりました/.test(message) && /ください/.test(message);
}

/** うまくいった知らせを自動で閉じるまでの時間（ミリ秒） */
export const NOTICE_AUTO_CLOSE_MS = 10_000;

/**
 * 自動で閉じてよい知らせか。うまくいって、案内（「〜してください」：届出の期限など）を含まないものだけ。
 * うまくいかなかった知らせと、案内を含む知らせは、読み終えて × で閉じるまで残す
 */
export function autoCloses(message: string): boolean {
  return !isFailureMessage(message) && !/ください/.test(message);
}

/**
 * 保存した・登録したなどの知らせ。全画面で同じ見た目にする。
 * 画面の右下に重ねて出す（長い画面の下のほうで保存しても、知らせが画面の外に出ないように。ページのスクロール位置は変えない）。
 * うまくいったら緑、うまくいかなかったら赤。「保存しました」だけの知らせは10秒で閉じる（マウスを乗せている間は閉じない）。
 * うまくいかなかった知らせと、案内（届出の期限など）を含む知らせは、× で閉じるまで残す。
 */
@Component({
  selector: 'app-notice',
  template: `
    <p
      class="notice"
      [class.failed]="failed()"
      [attr.role]="failed() ? 'alert' : 'status'"
      (mouseenter)="hovered.set(true)"
      (mouseleave)="hovered.set(false)"
    >
      <span class="icon" aria-hidden="true">{{ failed() ? '!' : '✓' }}</span>
      <span class="text">{{ message() }}</span>
      <button type="button" class="close" aria-label="閉じる" (click)="closed.emit()">×</button>
    </p>
  `,
  styles: `
    :host {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1000;
      width: min(480px, calc(100vw - 32px));
    }
    .notice {
      display: flex; align-items: flex-start; gap: 8px; margin: 0;
      padding: 10px 12px; border-radius: 8px; border: 1px solid #86efac;
      box-shadow: 0 8px 24px rgb(15 23 42 / 0.18);
      animation: notice-in 0.18s ease-out;
    }
    @keyframes notice-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .icon { flex: none; width: 18px; height: 18px; margin-top: 2px; border-radius: 50%; background: #16a34a; color: #fff; font-size: 11px; font-weight: bold; display: inline-flex; align-items: center; justify-content: center; }
    .text { flex: 1; }
    .failed { background: #fee2e2; color: #7f1d1d; border-color: #fca5a5; }
    .failed .icon { background: #b91c1c; }
    button.close { flex: none; background: none; border: none; color: inherit; padding: 0 4px; font-size: 16px; line-height: 1.2; opacity: 0.6; }
    button.close:hover:not(:disabled) { background: none; opacity: 1; color: inherit; }
  `,
})
export class NoticeMessage {
  readonly message = input.required<string>();
  readonly closed = output<void>();
  protected readonly failed = computed(() => isFailureMessage(this.message()));
  protected readonly hovered = signal(false);

  constructor() {
    // 「保存しました」だけの知らせは、しばらくしたら閉じる。文が変わったら数え直す。マウスを乗せている間は数えない
    effect((onCleanup) => {
      this.message();
      if (!autoCloses(this.message()) || this.hovered()) return;
      const timer = setTimeout(() => this.closed.emit(), NOTICE_AUTO_CLOSE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }
}
