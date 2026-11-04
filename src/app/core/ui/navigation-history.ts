// 前に開いていた画面を覚えておき、「元の画面へ戻る」に使う（設計書 3.0）
// 例：月次保険料一覧 → 従業員の詳細 →「← 月次保険料一覧へ戻る」
import { inject, Injectable } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';

/** 画面の名前（URL の先頭で決める。長いものから順に照らし合わせる） */
const SCREEN_LABELS: [string, string][] = [
  ['/decisions/import', '決定通知書の取り込み'],
  ['/salaries/import', '給与のCSV取り込み'],
  ['/settings/accounts', 'アカウントと権限'],
  ['/employees/', '従業員の詳細'],
  ['/employees', '従業員一覧'],
  ['/monthly', '月次保険料一覧'],
  ['/salaries', '給与'],
  ['/bonuses', '賞与'],
  ['/reconcile', '照合'],
  ['/revisions', '随時改定'],
  ['/regular', '定時決定'],
  ['/filings', '届出の期限'],
  ['/adjustments', '差額'],
  ['/totals', '集計'],
  ['/imports', 'CSV取り込み'],
  ['/settings', '設定'],
];

/** URL から画面の名前を求める（分からなければ null） */
export function screenLabel(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  if (path === '/' || path === '') return '要確認';
  return SCREEN_LABELS.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
}

@Injectable({ providedIn: 'root' })
export class NavigationHistory {
  private current: string | null = null;
  private last: string | null = null;
  /** 移っている途中の画面の URL（移り終わったら null） */
  private pending: string | null = null;

  constructor() {
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) this.pending = e.url;
      else if (e instanceof NavigationEnd) this.record(e.urlAfterRedirects);
      else if (e instanceof NavigationCancel || e instanceof NavigationError) this.pending = null;
    });
  }

  /** 画面を移ったことを記録する（同じ URL の読み込み直しは数えない） */
  record(url: string): void {
    this.pending = null;
    if (url === this.current) return;
    this.last = this.current;
    this.current = url;
  }

  /**
   * ひとつ前に開いていた画面の URL（ログイン画面と、初めに開いた画面では null）
   * 画面の部品は、移り終わった知らせ（NavigationEnd）より先に作られる。
   * 移っている途中に呼ばれたら、まだ記録していない「いまの画面」が、ひとつ前の画面になる
   */
  previous(): string | null {
    const url = this.pending !== null && this.pending !== this.current ? this.current : this.last;
    return url && !url.startsWith('/login') ? url : null;
  }
}
