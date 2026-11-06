// 決定通知書のCSVの取り込み（設計書 2.13.2・3.8）
// 電子申請で届いた決定通知書を、日本年金機構の変換ツールでCSVにしたものを取り込み、標準報酬月額の履歴に登録する。
// 変換ツール・CSVの作り方で列の並びや名前が違うため、列の対応づけ（csvMappings.decision）で合わせる。
import { parseDateLoose, parseNumberLoose } from './csv';
import { StandardHistory } from './employee-month';
import { findByNumber } from './salary-import';
import { standardGradeError, type GradeRow } from './grade-suggest';

/** アプリの項目ごとに、対応するCSVの列名（空はその列なし） */
export type DecisionMapping = {
  employeeNumber: string;
  name: string;
  birthDate: string;
  validFrom: string;
  healthStandard: string;
  pensionStandard: string;
};

export const DECISION_TEMPLATE_HEADERS = ['社員番号', '氏名', '生年月日', '適用年月', '健康保険の標準報酬月額', '厚生年金の標準報酬月額'];

export const DECISION_TEMPLATE_MAPPING: DecisionMapping = {
  employeeNumber: '社員番号',
  name: '氏名',
  birthDate: '生年月日',
  validFrom: '適用年月',
  healthStandard: '健康保険の標準報酬月額',
  pensionStandard: '厚生年金の標準報酬月額',
};

export const EMPTY_DECISION_MAPPING: DecisionMapping = {
  employeeNumber: '', name: '', birthDate: '', validFrom: '', healthStandard: '', pensionStandard: '',
};

export function decisionTemplateCsv(): string {
  return `${DECISION_TEMPLATE_HEADERS.join(',')}\r\n0001,山田 太郎,1980-05-10,2026-11,360,360\r\n`;
}

/** 対応づけが、このCSVの見出しで使えるか（使えない列名を返す） */
export function missingDecisionColumns(m: DecisionMapping, headers: string[]): string[] {
  const missing: string[] = [];
  if (m.employeeNumber === '' && (m.name === '' || m.birthDate === '')) missing.push('（社員番号か、氏名と生年月日の列を選んでください）');
  if (m.validFrom === '' || m.healthStandard === '') missing.push('（適用年月・健康保険の標準報酬月額は必須です）');
  for (const c of Object.values(m)) if (c !== '' && !headers.includes(c)) missing.push(c);
  return [...new Set(missing)];
}

const ERA_START: Record<string, number> = { R: 2018, 令和: 2018, H: 1988, 平成: 1988 };

/** 年月を 'YYYY-MM' にする（2026-09、2026/9、202609、2026年9月、R8.9、令和8年9月）。読めなければ null */
export function parseYearMonthLoose(value: string): string | null {
  const v = value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  let y: number, m: number;
  let match = v.match(/^(\d{4})[/\-.年](\d{1,2})月?$/);
  if (match) [y, m] = [Number(match[1]), Number(match[2])];
  else if ((match = v.match(/^(\d{4})(\d{2})$/))) [y, m] = [Number(match[1]), Number(match[2])];
  else if ((match = v.match(/^(R|H|令和|平成)\s*(\d{1,2}|元)[/\-.年](\d{1,2})月?$/i))) {
    [y, m] = [ERA_START[match[1].toUpperCase()] + (match[2] === '元' ? 1 : Number(match[2])), Number(match[3])];
  } else {
    // 日付で書いてあれば、その月にする
    const d = parseDateLoose(v);
    if (!d) return null;
    return d.slice(0, 7);
  }
  if (m < 1 || m > 12 || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** 標準報酬月額を円にする。通知書は千円単位で書くことが多いため、1万未満は千円単位とみなす。空欄は null、読めなければ NaN */
export function parseStandardLoose(value: string | undefined): number | null {
  const n = parseNumberLoose(value?.replace(/千円$/, ''));
  if (n === null || Number.isNaN(n)) return n;
  return n < 10_000 ? n * 1000 : n;
}

/** 千円単位として読み替えたときの注意（読み替えていなければ null） */
function thousandNote(label: string, raw: string | undefined, value: number | null): string | null {
  const n = parseNumberLoose(raw?.replace(/千円$/, ''));
  if (n === null || Number.isNaN(n) || n >= 10_000 || value === null || Number.isNaN(value)) return null;
  return `${label}の「${(raw ?? '').trim()}」を千円単位として${value.toLocaleString('ja-JP')}円と読みました`;
}

export type DecisionEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  birthDate: string;
  standardHistory: StandardHistory[];
  /** 資格の期間（渡したときは、適用年月に資格があるかを確かめる） */
  qualifications?: { acquiredDate: string; lostDate: string | null }[];
};

/** 適用開始月ごとの見込み（随時改定の候補・休業終了時改定・定時決定の見込み） */
export type DecisionExpectation = {
  employeeId: string;
  validFrom: string;
  healthStandard: number;
  pensionStandard: number;
  reason: 'regular' | 'revision' | 'leaveEnd';
};

export type DecisionStatus = 'new' | 'confirm' | 'same' | 'error';

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  new: '新しく登録',
  confirm: '通知書待ちを確定',
  same: '登録済み（同じ値）',
  error: 'エラー',
};

/** 保存する内容 */
export type DecisionToSave = {
  employeeId: string;
  validFrom: string;
  /** acquisition は標準報酬月額のCSV（導入時）で、資格取得月の履歴を登録するとき */
  reason: 'acquisition' | 'regular' | 'revision' | 'leaveEnd';
  healthStandard: number;
  pensionStandard: number;
  /** 通知書待ちの履歴を直すときの、その履歴のID */
  provisionalId: string | null;
};

export type DecisionRow = {
  line: number;
  label: string;
  name: string;
  status: DecisionStatus;
  errors: string[];
  save: DecisionToSave | null;
  /** 見込み（なければ null） */
  expected: DecisionExpectation | null;
  /** 見込みと違う（見込みがない人も含む） */
  differs: boolean;
  /** 読み替えたこと（千円単位の数を円にした など）。取り込む前に確かめられるように出す */
  notes?: string[];
};

const normalize = (s: string) => s.replace(/[\s　]/g, '');

/** CSVの行（見出しを含む）から、取り込む内容とエラーを作る */
export function buildDecisionPreview(
  rows: string[][],
  m: DecisionMapping,
  employees: DecisionEmployee[],
  expectations: DecisionExpectation[],
  /** 等級表（額が適用年月の等級の額かを確かめる。その月の表がなければエラー。null なら確かめない） */
  grades: GradeRow[] | null = null,
): DecisionRow[] {
  const [headers, ...body] = rows;
  const cell = (r: string[], name: string) => (name === '' || headers.indexOf(name) < 0 ? undefined : r[headers.indexOf(name)]);
  const seen = new Set<string>();

  return body.map((r, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const number = (cell(r, m.employeeNumber) ?? '').trim();
    const name = (cell(r, m.name) ?? '').trim();
    const birth = parseDateLoose(cell(r, m.birthDate) ?? '');
    // 社員番号で探し、なければ氏名と生年月日で探す
    let employee = number ? findByNumber(employees.map((e) => ({ ...e, assignments: [] })), number) : null;
    if (!employee && name && birth) {
      const hits = employees.filter((e) => normalize(e.name) === normalize(name) && e.birthDate === birth);
      if (hits.length === 1) employee = { ...hits[0], assignments: [] };
    }
    const emp = employee ? employees.find((e) => e.id === employee!.id)! : null;
    if (!emp) errors.push(`従業員を照合できません（${number || `${name} ${cell(r, m.birthDate) ?? ''}`.trim() || '空欄'}）`);

    const rawFrom = cell(r, m.validFrom) ?? '';
    const validFrom = parseYearMonthLoose(rawFrom);
    if (!validFrom) errors.push(`適用年月を読み取れません（${rawFrom || '空欄'}）`);
    const health = parseStandardLoose(cell(r, m.healthStandard));
    const pensionRaw = parseStandardLoose(cell(r, m.pensionStandard));
    // 1万未満の数は千円単位とみなして円にした。誤入力に気づけるよう、読み替えたことを出す
    const notes = [
      thousandNote('健康保険', cell(r, m.healthStandard), health),
      thousandNote('厚生年金', cell(r, m.pensionStandard), pensionRaw),
    ].filter((x): x is string => x !== null);
    if (health === null || Number.isNaN(health) || health <= 0 || health % 1000 !== 0) errors.push('健康保険の標準報酬月額を読み取れません');
    if (Number.isNaN(pensionRaw) || (pensionRaw !== null && (pensionRaw <= 0 || pensionRaw % 1000 !== 0)))
      errors.push('厚生年金の標準報酬月額を読み取れません');
    if (validFrom && errors.length === 0) {
      const gh = standardGradeError(grades, validFrom, 'health', health!);
      if (gh) errors.push(gh);
      const gp = pensionRaw === null ? null : standardGradeError(grades, validFrom, 'pension', pensionRaw);
      if (gp && gp !== gh) errors.push(gp);
    }

    const label = emp ? `${emp.employeeNumber} ${emp.name}` : number || name;
    const base = { line, label, name: emp?.name ?? name };
    if (emp && validFrom) {
      const key = `${emp.id}|${validFrom}`;
      if (seen.has(key)) errors.push('同じ人・同じ適用年月の行がファイルの中に2つ以上あります');
      seen.add(key);
      // 資格のない月の決定は取り込まない（標準報酬月額のCSVと同じ決まり。年の誤りに気づけるように）
      if (emp.qualifications && !emp.qualifications.some((q) => q.acquiredDate.slice(0, 7) <= validFrom && (q.lostDate === null || q.lostDate.slice(0, 7) > validFrom)))
        errors.push(`${Number(validFrom.slice(0, 4))}年${Number(validFrom.slice(5))}月に社会保険の資格がありません（適用年月の年・月を確かめてください）`);
    }
    if (errors.length > 0 || !emp || !validFrom) return { ...base, status: 'error' as const, errors, save: null, expected: null, differs: false, notes };

    const sameMonth = emp.standardHistory.find((h) => h.validFrom === validFrom) ?? null;
    // 見込みは、候補・定時決定の見込み。なければ、通知書待ちで先に登録した額
    const expected =
      expectations.find((x) => x.employeeId === emp.id && x.validFrom === validFrom) ??
      (sameMonth?.provisional
        ? { employeeId: emp.id, validFrom, healthStandard: sameMonth.healthStandard, pensionStandard: sameMonth.pensionStandard, reason: validFrom.endsWith('-09') ? ('regular' as const) : ('revision' as const) }
        : null);
    // 厚生年金の欄が空（70歳以上など）なら、見込み・今の値を使う
    const current = [...emp.standardHistory].filter((h) => h.validFrom <= validFrom).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    const pension = pensionRaw ?? expected?.pensionStandard ?? sameMonth?.pensionStandard ?? current?.pensionStandard ?? health!;
    const reason = expected?.reason ?? (validFrom.endsWith('-09') ? 'regular' : 'revision');
    const save: DecisionToSave = {
      employeeId: emp.id, validFrom, reason, healthStandard: health!, pensionStandard: pension, provisionalId: null,
    };
    const differs = !expected || expected.healthStandard !== health || expected.pensionStandard !== pension;

    if (sameMonth && !sameMonth.provisional) {
      if (sameMonth.healthStandard === health && sameMonth.pensionStandard === pension)
        return { ...base, status: 'same' as const, errors: [], save: null, expected, differs, notes };
      return {
        ...base, status: 'error' as const,
        errors: ['同じ適用開始月の履歴がすでにあり、値が違います（従業員の詳細で確かめてください）'],
        save: null, expected, differs, notes,
      };
    }
    if (sameMonth?.provisional) return { ...base, status: 'confirm' as const, errors: [], save: { ...save, provisionalId: sameMonth.id ?? null }, expected, differs, notes };
    return { ...base, status: 'new' as const, errors: [], save, expected, differs, notes };
  });
}
