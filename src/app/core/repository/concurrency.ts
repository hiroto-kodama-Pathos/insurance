// 問い合わせを一度に送りすぎないための部品（設計書 5章 データの読み込み）
// Firestore は同時に待っている問い合わせが多すぎると「Too many outstanding requests」で断るため、
// 同時に動かす数を決めて、終わったものから次を始める。

/**
 * items の1つずつに fn を実行し、結果を items と同じ順で返す。同時に動かすのは limit 個まで
 * @param limit 同時に動かす数（1以上）
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
