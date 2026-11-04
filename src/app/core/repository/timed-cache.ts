// 読み込んだデータを、画面をまたいで使い回すための入れ物（設計書 4章 データの読み込み）
// 同じ鍵（ログインした人・担当範囲）で、決めた時間のうちに読み込んだものがあれば、それを返す。
// 読み込み中に別の画面からも頼まれたときは、同じ読み込みを待つ（二重に読まない）。

export class TimedCache<T> {
  private entry: { key: string; at: number; value: Promise<T> } | null = null;

  /**
   * @param ttlMs 使い回す時間（ミリ秒）。ほかの担当者の変更は、この時間がたつと反映される
   * @param now 今の時刻（テストで差し替える）
   */
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 使い回せるものがあれば返し、なければ load で読み込んで覚える */
  get(key: string, load: () => Promise<T>): Promise<T> {
    const e = this.entry;
    if (e && e.key === key && this.now() - e.at < this.ttlMs) return e.value;
    const value = load();
    const entry = { key, at: this.now(), value };
    this.entry = entry;
    // 失敗した読み込みは覚えない（次に頼まれたときに読み直す）
    value.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return value;
  }

  /** 覚えているものを捨てる（次の get で読み直す） */
  clear(): void {
    this.entry = null;
  }
}
