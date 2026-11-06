// 保存していない入力がある画面から移るときに確認する（設計書 3.0）
// 画面（コンポーネント）が HasUnsavedChanges を持っていれば、ルートの canDeactivate でこの確認を出す。
import { inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { Confirm, ConfirmRequest } from './confirm';

export interface HasUnsavedChanges {
  /** 保存していない入力の件数（0 なら確認しない） */
  unsavedCount(): number;
}

/** 移る前に「保存していない入力があります」と確認する。「移る」を選んだときだけ移る */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  const n = component?.unsavedCount?.() ?? 0;
  if (n === 0) return true;
  return inject(Confirm).ask({
    title: '保存していない入力があります',
    message: `${n}件の入力をまだ保存していません。このまま移ると、入力した内容は消えます。`,
    ok: '保存せずに移る',
    danger: true,
  });
};

/** フォームを閉じる（「やめる」・別のフォームを開く・月を変える）前の確認 */
export const DISCARD_REQUEST: ConfirmRequest = {
  title: '保存していない入力があります',
  message: '入力した内容は保存されていません。破棄して閉じますか。',
  ok: '破棄して閉じる',
  cancel: '入力に戻る',
  danger: true,
};

/**
 * フォームを閉じる前に、変えた入力を捨ててよいかを確かめる（設計書 3.0）。
 * 入力を変えていなければ確かめずに true。画面を移るとき（unsavedChangesGuard）だけでなく、
 * 「やめる」や別のフォームを開くときにも、同じ基準（開いたときの値から変えたか）で確かめる
 */
export async function confirmDiscard(confirm: Confirm, changed: boolean): Promise<boolean> {
  return !changed || confirm.ask(DISCARD_REQUEST);
}

/**
 * 入力を変えていなければすぐ（同期で）action を行い、変えていれば破棄してよいかを確かめてから行う。
 * 開く・閉じるボタンは、確かめる必要がなければ押したその場でフォームが変わるようにする
 */
export function afterDiscardCheck(confirm: Confirm, changed: boolean, action: () => void): void | Promise<void> {
  if (!changed) {
    action();
    return;
  }
  return confirm.ask(DISCARD_REQUEST).then((ok) => {
    if (ok) action();
  });
}

/**
 * フォームを開いたときの入力を覚えておき、そのあと変えたかを見る（保存していない入力の確認に使う）
 * state には、フォームの入力をまとめて返す関数を渡す（値を JSON にして比べる）
 */
export class FormSnapshot {
  private readonly baseline = signal<string | null>(null);
  constructor(private readonly state: () => unknown) {}

  /** いまの入力を「変えていない」状態として覚える */
  takeNow(): void {
    this.baseline.set(JSON.stringify(this.state()));
  }
  /** 開く処理が続けて入力に値を入れる画面もあるので、その処理が終わってから覚える */
  take(): void {
    queueMicrotask(() => this.takeNow());
  }
  /** 覚えたときから入力を変えたか（まだ覚えていなければ false） */
  changed(): boolean {
    const b = this.baseline();
    return b !== null && JSON.stringify(this.state()) !== b;
  }
}
