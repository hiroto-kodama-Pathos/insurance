// ブラウザのタブ・履歴に、開いている画面の名前を出す（設計書 3.0）
// 例：「従業員一覧｜社会保険管理システム」。ルートに title がない画面は、アプリの名前だけ
import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const APP_NAME = '社会保険管理システム';

/** 画面の名前からタブの名前を作る */
export function pageTitle(title: string | undefined): string {
  return title ? `${title}｜${APP_NAME}` : APP_NAME;
}

@Injectable()
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(pageTitle(this.buildTitle(snapshot)));
  }
}
