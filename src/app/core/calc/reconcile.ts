// 納付書・給与の控除額との照合（設計書 2.28・3.13）
// 納付書の金額・給与ソフトで控除した額は、担当者が入力した事実として保存する（reconciliations・payrollDeductions）。
// 比べる相手（納付見込額・本人負担）と差、原因の候補は、表示のたびに計算する。
import { EmployeeMonthResult } from './employee-month';
import { changeReasons } from './monthly-filter';
import { MonthlySummary, PaymentLine } from './monthly-summary';
import { findByNumber, ImportEmployee } from './salary-import';
import { parseNumberLoose } from './csv';

export const PAYMENT_LINES: PaymentLine[] = ['healthCare', 'childSupport', 'pension'];

export const PAYMENT_LINE_LABEL: Record<PaymentLine, string> = {
  healthCare: '健康保険（介護保険を含む）',
  childSupport: '子ども・子育て支援金',
  pension: '厚生年金保険',
};

/** 納付書の欄ごとの金額（円） */
export type LineAmounts = Record<PaymentLine, number>;

export const zeroLines = (): LineAmounts => ({ healthCare: 0, childSupport: 0, pension: 0 });

const sumLines = (x: LineAmounts) => x.healthCare + x.childSupport + x.pension;

export type MatchStatus = 'match' | 'diff' | 'notEntered';

export const MATCH_LABEL: Record<MatchStatus, string> = {
  match: '一致',
  diff: '差あり',
  notEntered: '未入力',
};

// ---------------------------------------------------------------- 納付書

export type ExpectedPayment = { monthly: LineAmounts; bonus: LineAmounts; total: LineAmounts };

/**
 * 適用事業所ごとの納付見込額（月額と賞与）。保険者が分かれていても、事業所の欄ごとに足す
 * （小計は事業所・保険者ごとに円未満を切り捨てた額。足し上げで切り捨て直さない）
 */
export function expectedPayments(monthly: MonthlySummary, bonus: MonthlySummary): Map<string, ExpectedPayment> {
  const map = new Map<string, ExpectedPayment>();
  const get = (officeId: string) => {
    const e = map.get(officeId) ?? { monthly: zeroLines(), bonus: zeroLines(), total: zeroLines() };
    map.set(officeId, e);
    return e;
  };
  for (const [kind, s] of [['monthly', monthly], ['bonus', bonus]] as const) {
    for (const o of s.offices) {
      const e = get(o.officeId);
      for (const line of PAYMENT_LINES) {
        const v = Number(o.lines[line].paymentYen);
        e[kind][line] += v;
        e.total[line] += v;
      }
    }
  }
  return map;
}

export type NoticeComparison = {
  officeId: string;
  expected: ExpectedPayment;
  /** 納付書の金額（入力していなければ null） */
  entered: LineAmounts | null;
  /** 納付書 − 納付見込額（入力していなければ null） */
  diff: LineAmounts | null;
  diffTotal: number;
  status: MatchStatus;
};

export function compareNotice(officeId: string, expected: ExpectedPayment | undefined, entered: LineAmounts | null): NoticeComparison {
  const exp = expected ?? { monthly: zeroLines(), bonus: zeroLines(), total: zeroLines() };
  if (!entered) return { officeId, expected: exp, entered: null, diff: null, diffTotal: 0, status: 'notEntered' };
  const diff = zeroLines();
  for (const line of PAYMENT_LINES) diff[line] = entered[line] - exp.total[line];
  const diffTotal = sumLines(diff);
  const status = PAYMENT_LINES.every((l) => diff[l] === 0) ? 'match' : 'diff';
  return { officeId, expected: exp, entered, diff, diffTotal, status };
}

/** 原因の候補（1人分） */
export type CauseCandidate = { employeeId: string; label: string; reasons: string[] };

export type CauseInput = {
  employeeId: string;
  /** 「0001 山田 太郎」など */
  label: string;
  /** 前月の結果 */
  prev: EmployeeMonthResult | null;
  /** その月の結果 */
  cur: EmployeeMonthResult;
  /** その月の標準報酬月額が通知書待ち（仮の額） */
  provisional: boolean;
};

/** 前月から変わった理由（資格を失った人も含める） */
function reasonsOf(x: CauseInput): string[] {
  if (x.cur.status === 'notInsured') {
    return x.prev && x.prev.status === 'ok' ? ['退職・資格喪失（前月まで保険料がかかっていた）'] : [];
  }
  const r = changeReasons(x.prev, x.cur);
  if (x.provisional) r.push('標準報酬月額が通知書待ち（仮の額で計算）');
  return r;
}

/** その人を、事業所の原因の候補に含めるか（その月か前月に、その事業所に所属していた） */
function inOffice(x: CauseInput, officeId: string): boolean {
  return x.cur.officeId === officeId || x.prev?.officeId === officeId;
}

/**
 * 納付書との差がある事業所の、原因の候補
 * 前月から保険料が変わった人・その月に賞与を支給した人を並べる
 *
 * @param bonusPayees その月に賞与を支給した人（支給日の事業所）
 */
export function noticeCauses(
  officeId: string,
  inputs: CauseInput[],
  bonusPayees: { employeeId: string; label: string; officeId: string | null; amount: number }[],
): CauseCandidate[] {
  const map = new Map<string, CauseCandidate>();
  for (const x of inputs) {
    if (!inOffice(x, officeId)) continue;
    const reasons = reasonsOf(x);
    if (reasons.length > 0) map.set(x.employeeId, { employeeId: x.employeeId, label: x.label, reasons });
  }
  for (const b of bonusPayees) {
    if (b.officeId !== officeId) continue;
    const c = map.get(b.employeeId) ?? { employeeId: b.employeeId, label: b.label, reasons: [] };
    c.reasons.push(`賞与の支給（${b.amount.toLocaleString('ja-JP')}円）`);
    map.set(b.employeeId, c);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** 人に結びつかない原因の候補（納付書の差に、いつも添える） */
export const NOTICE_GENERAL_CAUSES = [
  '前月以前の訂正の調整額（さかのぼる改定、資格の取得・喪失の届出が遅れた分など）が、この月の納付書に含まれている',
  '届け出た標準報酬月額・賞与額が、アプリに登録した額と違う（決定通知書を確かめる）',
  '料率の改定が登録されていない、または適用する月が違う',
];

// ---------------------------------------------------------------- 給与の控除額

/** 給与ソフトで控除した額（円）。健康保険は介護保険を含む */
export type DeductionLines = { health: number; childSupport: number; pension: number };

export const DEDUCTION_KEYS: (keyof DeductionLines)[] = ['health', 'childSupport', 'pension'];

export const DEDUCTION_LABEL: Record<keyof DeductionLines, string> = {
  health: '健康保険（介護保険を含む）',
  childSupport: '子ども・子育て支援金',
  pension: '厚生年金保険',
};

const sumDeduction = (x: DeductionLines) => x.health + x.childSupport + x.pension;

/** その月の本人負担（給与ソフトの控除額と同じ区切り） */
export function employeeDeduction(r: EmployeeMonthResult): DeductionLines {
  const p = r.premium;
  if (!p) return { health: 0, childSupport: 0, pension: 0 };
  return {
    health: Number((p.health?.employeeYen ?? 0n) + (p.care?.employeeYen ?? 0n)),
    childSupport: Number(p.childSupport?.employeeYen ?? 0n),
    pension: Number(p.pension?.employeeYen ?? 0n),
  };
}

export type DeductionComparison = {
  expected: DeductionLines;
  entered: DeductionLines | null;
  /** 控除額 − 本人負担 */
  diff: DeductionLines | null;
  diffTotal: number;
  status: MatchStatus;
};

export function compareDeduction(expected: DeductionLines, entered: DeductionLines | null): DeductionComparison {
  if (!entered) return { expected, entered: null, diff: null, diffTotal: 0, status: 'notEntered' };
  const diff = {
    health: entered.health - expected.health,
    childSupport: entered.childSupport - expected.childSupport,
    pension: entered.pension - expected.pension,
  };
  const diffTotal = sumDeduction(diff);
  return { expected, entered, diff, diffTotal, status: DEDUCTION_KEYS.every((k) => diff[k] === 0) ? 'match' : 'diff' };
}

/**
 * 給与の控除額との差の、原因の候補
 *
 * @param settled 同じ給与で精算した、さかのぼる改定の差額（円。追加で控除するなら正）
 */
export function deductionCauses(c: DeductionComparison, x: CauseInput, settled: number): string[] {
  if (c.status !== 'diff') return [];
  const r: string[] = [];
  if (settled !== 0 && c.diffTotal === settled)
    r.push(`同じ給与で精算した差額（${settled > 0 ? '+' : ''}${settled.toLocaleString('ja-JP')}円）を含めて控除している（照合では、その月の保険料だけと比べます）`);
  for (const reason of reasonsOf(x)) r.push(`前月から変わった：${reason}（給与ソフトに反映されているか）`);
  if (c.diff && c.diff.childSupport !== 0 && c.diff.health === -c.diff.childSupport)
    r.push('健康保険と支援金の分け方の違い（会社の設定の「支援金の端数処理」と給与ソフトの設定を確かめる）');
  else if (c.diff && DEDUCTION_KEYS.every((k) => Math.abs(c.diff![k]) <= 1))
    r.push('端数処理の違い（50銭以下切り捨て・50銭超切り上げになっているか）');
  if (r.length === 0) r.push('給与ソフトの標準報酬月額・料率・介護保険の対象かどうかを確かめる');
  return r;
}

// ---------------------------------------------------------------- 給与の控除額のCSV

/** 見出しの位置（ない列は -1） */
export type DeductionColumns = { employeeNumber: number; health: number; care: number; childSupport: number; pension: number };

const normHeader = (s: string) => s.replace(/[\s　]/g, '');

/**
 * 見出しから列を見つける（給与ソフトごとに名前が違うため、言葉で探す）
 * 介護保険を別の列に分けている給与ソフトは、健康保険に足して比べる
 * 会社負担の列（「会社」「事業主」を含む）は使わない
 */
export function detectDeductionColumns(headers: string[]): DeductionColumns | string {
  const h = headers.map(normHeader);
  const find = (test: (s: string) => boolean) => h.findIndex((s) => !/会社|事業主/.test(s) && test(s));
  const cols: DeductionColumns = {
    employeeNumber: find((s) => /社員番号|従業員番号|社員コード|従業員コード/.test(s)),
    health: find((s) => s.includes('健康保険')),
    care: find((s) => s.includes('介護') && !s.includes('健康保険')),
    childSupport: find((s) => s.includes('支援金')),
    pension: find((s) => s.includes('厚生年金')),
  };
  const missing = [
    cols.employeeNumber < 0 ? '社員番号' : '',
    cols.health < 0 ? '健康保険' : '',
    cols.pension < 0 ? '厚生年金' : '',
  ].filter((x) => x);
  return missing.length > 0 ? `見出しに「${missing.join('」「')}」の列が見つかりません` : cols;
}

export const DEDUCTION_TEMPLATE_HEADERS = ['社員番号', '健康保険（介護保険を含む）', '子ども・子育て支援金', '厚生年金保険'];

export function deductionTemplateCsv(): string {
  return `${DEDUCTION_TEMPLATE_HEADERS.join(',')}\r\n0001,14775,345,27450\r\n`;
}

export type DeductionPreviewRow = {
  line: number;
  label: string;
  employeeId: string | null;
  amounts: DeductionLines | null;
  errors: string[];
};

/**
 * CSVの行（見出しを含む）から、取り込む控除額とエラーを作る
 * @param allowed 担当範囲の従業員（特定の事業所の担当者は、その事業所の人だけ取り込める）
 */
export function buildDeductionPreview(rows: string[][], employees: ImportEmployee[], allowed: Set<string>): DeductionPreviewRow[] | string {
  const [headers, ...body] = rows;
  if (!headers) return 'ファイルが空です';
  const cols = detectDeductionColumns(headers);
  if (typeof cols === 'string') return cols;
  const seen = new Set<string>();
  return body
    .map((r, i) => ({ r, line: i + 2 }))
    .filter(({ r }) => r.some((c) => c.trim() !== ''))
    .map(({ r, line }) => {
      const errors: string[] = [];
      const number = (r[cols.employeeNumber] ?? '').trim();
      const e = number ? findByNumber(employees, number) : null;
      if (!e) errors.push(`社員番号「${number || '空欄'}」の従業員が見つかりません`);
      else if (!allowed.has(e.id)) errors.push('担当範囲の外の従業員です');
      else if (seen.has(e.id)) errors.push('同じ従業員の行がファイルの中に2つ以上あります');
      if (e) seen.add(e.id);
      const num = (idx: number, name: string, required: boolean) => {
        if (idx < 0) return 0;
        const v = parseNumberLoose(r[idx]);
        if (v === null) {
          if (required) errors.push(`${name}が空欄です`);
          return 0;
        }
        if (Number.isNaN(v) || v < 0 || !Number.isInteger(v)) {
          errors.push(`${name}を読み取れません（${r[idx]}）`);
          return 0;
        }
        return v;
      };
      const amounts = {
        health: num(cols.health, '健康保険', true) + num(cols.care, '介護保険', false),
        childSupport: num(cols.childSupport, '支援金', false),
        pension: num(cols.pension, '厚生年金', true),
      };
      return {
        line,
        label: e ? `${e.employeeNumber} ${e.name}` : number,
        employeeId: errors.length === 0 && e ? e.id : null,
        amounts: errors.length === 0 ? amounts : null,
        errors,
      };
    });
}
