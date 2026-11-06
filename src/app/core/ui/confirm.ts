import { Injectable, signal } from '@angular/core';

export type ConfirmRequest = {
  title: string;
  message: string;
  /** 実行するボタンの文字（「確定する」など） */
  ok: string;
  /** 消す・取り消すなど、注意が要る操作なら true（ボタンが赤になる） */
  danger?: boolean;
  /** 実行しないボタンの文字（初期値は「やめる」。フォームの「やめる」から出す確認では「入力に戻る」にして、紛れないようにする） */
  cancel?: string;
};

/** 取り消しにくい操作の前に出す確認（App が画面に出し、押したボタンで結果を返す） */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly current = signal<ConfirmRequest | null>(null);
  private resolve: ((ok: boolean) => void) | null = null;

  ask(request: ConfirmRequest): Promise<boolean> {
    this.resolve?.(false);
    this.current.set(request);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  answer(ok: boolean): void {
    this.resolve?.(ok);
    this.resolve = null;
    this.current.set(null);
  }
}
