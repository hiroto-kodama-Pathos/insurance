// 金額の欄は、欄から離れたら3桁ごとにカンマを入れて見せる（250000 → 250,000。設計書 3.0）
// 桁の読み違い（25万円と250万円など）を防ぐため。読むときはカンマを取り除く（parseNumberInput・parseNumberLoose）ので、保存する値は変わらない。
// 全画面に効かせるため、ページ全体で「欄から離れた」を受ける。年（name="year"）や小数の欄（inputmode="decimal"）は変えない。

/** カンマを入れて見せる文字（数字として読めない・1,000未満・小数はそのまま） */
export function withComma(value: string): string {
  const t = value.normalize('NFKC').replace(/[,\s]/g, '');
  if (!/^-?\d+$/.test(t) || Math.abs(Number(t)) < 1000) return value;
  return Number(t).toLocaleString('ja-JP');
}

/** ページ全体に仕掛ける。戻り値を呼ぶと外す */
export function installAmountFormat(doc: Document): () => void {
  const onBlur = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.inputMode !== 'numeric' || el.name === 'year' || el.dataset['noComma'] !== undefined) return;
    const v = withComma(el.value);
    if (v !== el.value) el.value = v;
  };
  doc.addEventListener('focusout', onBlur);
  return () => doc.removeEventListener('focusout', onBlur);
}
