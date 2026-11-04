import { DOCUMENT } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, HostListener, inject, signal, viewChild, Injector } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Auth } from './core/auth/auth';
import { Confirm } from './core/ui/confirm';
import { installHalfWidthInput } from './core/ui/half-width-input';
import { installErrorFocus } from './core/ui/error-focus';
import { NavigationHistory } from './core/ui/navigation-history';

type MenuLink = { path: string; label: string; help: string; exact?: boolean; adminOnly?: boolean };
/** collapsible：見出しだけを出し、押すと画面の一覧を開く（毎月使う「毎月」は、たたまずに並べる） */
type MenuGroup = { label: string; links: MenuLink[]; collapsible?: boolean };

/** メニュー。仕事の流れ（毎月の作業 → 改定 → 届出・精算 → 登録情報）の順にまとめる */
const MENU: MenuGroup[] = [
  {
    label: '毎月',
    links: [
      { path: '/', label: '要確認', help: '給与計算の前に確かめること', exact: true },
      { path: '/monthly', label: '月次保険料一覧', help: '月ごとの保険料の一覧と確定' },
      { path: '/salaries', label: '給与', help: '給与の入力・CSV取り込み' },
      { path: '/bonuses', label: '賞与', help: '賞与の登録と保険料' },
      { path: '/reconcile', label: '照合', help: '納付書の額との照合' },
    ],
  },
  {
    label: '改定',
    collapsible: true,
    links: [
      { path: '/revisions', label: '随時改定', help: '固定的賃金が変わった人の判定' },
      { path: '/regular', label: '定時決定', help: '4〜6月の報酬による算定' },
      { path: '/decisions/import', label: '決定通知書', help: '決定通知書の取り込み' },
    ],
  },
  {
    label: '届出・精算',
    collapsible: true,
    links: [
      { path: '/filings', label: '届出', help: '届出の期限' },
      { path: '/adjustments', label: '差額', help: '確定後に変わった保険料の差額と精算' },
      { path: '/totals', label: '集計', help: '期間ごとの集計' },
    ],
  },
  {
    label: '登録情報',
    collapsible: true,
    links: [
      { path: '/employees', label: '従業員', help: '従業員の一覧・登録' },
      { path: '/imports', label: 'CSV取り込み', help: '導入時の従業員・被扶養者・標準報酬月額・賞与の取り込み' },
      { path: '/settings', label: '設定', help: '会社・事業所・料率・アカウントの設定', adminOnly: true },
    ],
  },
];

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly confirm = inject(Confirm);
  private readonly router = inject(Router);

  private readonly document = inject(DOCUMENT);
  private readonly confirmCancel = viewChild<ElementRef<HTMLButtonElement>>('confirmCancel');
  private readonly confirmOk = viewChild<ElementRef<HTMLButtonElement>>('confirmOk');
  /** 確認を出す前にカーソルがあったところ（閉じたら戻す） */
  private focusBeforeConfirm: HTMLElement | null = null;
  private confirmShown = false;

  /** 開いているメニューの見出し（改定・届出・精算・登録情報のどれか。閉じていれば null） */
  protected readonly openGroup = signal<string | null>(null);
  /** 今の画面の URL（今いる画面を含む見出しを強調するため） */
  private readonly url = signal('/');

  /** 今いる画面が、その見出しの中にあるか */
  protected groupActive(g: MenuGroup): boolean {
    const path = this.url().split(/[?#]/)[0];
    return g.links.some((l) => (l.exact ? path === l.path : path === l.path || path.startsWith(`${l.path}/`)));
  }

  /** 見出しを押したら開く。もう一度押すと閉じる */
  protected toggleGroup(label: string, e: Event): void {
    e.stopPropagation(); // 狭い画面でメニュー全体が閉じないように、また下の「ほかの場所を押したら閉じる」に届かないように
    this.openGroup.update((g) => (g === label ? null : label));
  }

  /** 画面を選んだら、メニューを閉じる */
  protected closeMenus(): void {
    this.openGroup.set(null);
    this.menuOpen.set(false);
  }

  /** メニューの外を押したら、開いている一覧を閉じる */
  @HostListener('document:click')
  protected onDocumentClick(): void {
    this.openGroup.set(null);
  }

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.url.set(e.urlAfterRedirects);
      this.openGroup.set(null);
    });
    // 数字・社員番号・メールアドレスの欄は、全角で入れても半角にする（全画面に効かせる）
    inject(DestroyRef).onDestroy(installHalfWidthInput(this.document));
    // 登録・保存で入力に誤りがあったら、最初の誤りの欄へ移る（全フォームに効かせる）
    inject(DestroyRef).onDestroy(installErrorFocus(this.document, inject(Injector)));
    // 前に開いていた画面を覚え始める（従業員の詳細の「元の画面へ戻る」に使う）
    inject(NavigationHistory);

    // 確認を出したら、カーソルを「やめる」に置く（消す・取り消す操作を、Enter の押し間違いで実行しないため）。
    // 閉じたら、確認を出す前のところ（押したボタン）にカーソルを戻す
    afterRenderEffect(() => {
      const shown = this.confirm.current() !== null;
      if (shown && !this.confirmShown) {
        const active = this.document.activeElement;
        this.focusBeforeConfirm = active instanceof HTMLElement && active !== this.document.body ? active : null;
        this.confirmCancel()?.nativeElement.focus();
      } else if (!shown && this.confirmShown) {
        const back = this.focusBeforeConfirm;
        this.focusBeforeConfirm = null;
        if (back?.isConnected) back.focus();
      }
      this.confirmShown = shown;
    });
  }

  /** Esc で確認を閉じる（カーソルがどこにあっても） */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.confirm.current()) this.confirm.answer(false);
    else this.openGroup.set(null);
  }

  /** 確認を出している間は、Tab でカーソルが確認の外に出ないようにする（2つのボタンを行き来する） */
  protected onConfirmKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const cancel = this.confirmCancel()?.nativeElement;
    const ok = this.confirmOk()?.nativeElement;
    if (!cancel || !ok) return;
    const active = this.document.activeElement;
    if (e.shiftKey && active === cancel) {
      e.preventDefault();
      ok.focus();
    } else if (!e.shiftKey && active === ok) {
      e.preventDefault();
      cancel.focus();
    }
  }

  /** 狭い画面でメニューを開いているか */
  protected readonly menuOpen = signal(false);

  /** 管理者だけのメニューを除いたメニュー */
  protected readonly menu = computed(() =>
    MENU.map((g) => ({ ...g, links: g.links.filter((l) => !l.adminOnly || this.auth.isAdmin()) })).filter((g) => g.links.length > 0),
  );

  protected async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
