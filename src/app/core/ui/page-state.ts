// 一覧の絞り込み・対象月・タブを覚えておく（設計書 3.0）
// 一覧から従業員の詳細を開いて戻ってきたとき（「← 元の画面へ戻る」・ブラウザの戻る）に、元の絞り込みのまま続けられるように。
// 覚えるのはこのタブを開いている間だけ（再読み込み・ログアウトで消える）。ログインした人ごとに分ける。
import { effect, inject, Service, WritableSignal } from '@angular/core';
import { Auth } from '../auth/auth';

@Service()
export class PageState {
  private readonly auth = inject(Auth);
  private readonly values = new Map<string, unknown>();

  /**
   * 画面の値（signal）を覚える。前に覚えた値があれば戻し、そのあとは変わるたびに覚え直す。
   * 画面（コンポーネント）のコンストラクタで呼ぶ（effect を画面と一緒に片付けるため）
   * @param key 画面と項目の名前（'employees.query' など）
   */
  keep<T>(key: string, value: WritableSignal<T>): void {
    const k = `${this.auth.user()?.uid ?? ''}|${key}`;
    if (this.values.has(k)) value.set(this.values.get(k) as T);
    effect(() => {
      this.values.set(k, value());
    });
  }
}
