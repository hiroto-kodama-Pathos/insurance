// 従業員・標準報酬月額・賞与のCSVの取り込み（設計書 3.8）
// 導入時に、今の従業員・標準報酬月額・その年度の賞与をまとめて登録する。
// 列の対応づけ（csvMappings.employee・standard・bonus）でCSVの列を合わせ、取り込む前にプレビューで登録する内容とエラー行を確かめる。
import { BonusType, isRemunerationBonus } from './bonus-type';
import { parseDateLoose, parseNumberLoose } from './csv';
import { checkDependent, Dependent } from './dependent';
import { parseStandardLoose, parseYearMonthLoose } from './decision-import';
import { Qualification } from './eligibility';
import { GradeRow, gradeTableAt } from './grade-suggest';
import { INSURED_TYPE_LABEL, InsuredType } from './insured-type';
import { isValidDate } from './new-employee';
import { Assignment } from './office';
import { findByNumber } from './salary-import';
import { toHalfWidth } from './half-width';
import { dateLabel, yearMonthLabel } from './year-month';

export type ImportKind = 'employee' | 'dependent' | 'standard' | 'bonus';

/** URL の ?kind= から、最初に開く取り込みの種類を決める（賞与の画面からは ?kind=bonus で開く）。分からなければ null */
export function importKindFromQuery(value: string | null): ImportKind | null {
  return value === 'employee' || value === 'dependent' || value === 'standard' || value === 'bonus' ? value : null;
}

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  employee: '従業員',
  dependent: '被扶養者',
  standard: '標準報酬月額',
  bonus: '賞与',
};

/** アプリの項目（template はテンプレートCSVの見出し） */
export type FieldDef = { key: string; label: string; required: boolean; template: string; example: string };

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  employee: [
    { key: 'employeeNumber', label: '社員番号', required: true, template: '社員番号', example: '0101' },
    { key: 'name', label: '氏名', required: true, template: '氏名', example: '青木 健' },
    { key: 'birthDate', label: '生年月日', required: true, template: '生年月日', example: '1990-04-01' },
    { key: 'office', label: '適用事業所（名前かID）', required: true, template: '適用事業所', example: '本社' },
    { key: 'hireDate', label: '入社日', required: false, template: '入社日', example: '2020-04-01' },
    { key: 'acquiredDate', label: '資格取得日（空欄は未加入）', required: false, template: '資格取得日', example: '2020-04-01' },
    { key: 'insuredType', label: '被保険者区分', required: false, template: '被保険者区分', example: '一般被保険者' },
    { key: 'payrollGroup', label: '支払区分（名前）', required: false, template: '支払区分', example: '' },
  ],
  dependent: [
    { key: 'employeeNumber', label: '社員番号（本人）', required: true, template: '社員番号', example: '0101' },
    { key: 'name', label: '被扶養者の氏名', required: true, template: '被扶養者の氏名', example: '青木 花子' },
    { key: 'birthDate', label: '被扶養者の生年月日', required: true, template: '被扶養者の生年月日', example: '1987-06-01' },
    { key: 'certifiedDate', label: '扶養に入った日', required: true, template: '扶養に入った日', example: '2020-04-01' },
    { key: 'removedDate', label: '扶養から外れた日（扶養中は空欄）', required: false, template: '扶養から外れた日', example: '' },
  ],
  standard: [
    { key: 'employeeNumber', label: '社員番号', required: true, template: '社員番号', example: '0101' },
    { key: 'validFrom', label: '適用年月', required: true, template: '適用年月', example: '2026-09' },
    { key: 'healthStandard', label: '健康保険の標準報酬月額', required: true, template: '健康保険の標準報酬月額', example: '300000' },
    { key: 'pensionStandard', label: '厚生年金の標準報酬月額（空欄は健康保険から）', required: false, template: '厚生年金の標準報酬月額', example: '300000' },
  ],
  bonus: [
    { key: 'employeeNumber', label: '社員番号', required: true, template: '社員番号', example: '0101' },
    { key: 'paidDate', label: '支給日', required: true, template: '支給日', example: '2026-07-10' },
    { key: 'amount', label: '賞与額（現物を含む）', required: true, template: '賞与額', example: '500000' },
    { key: 'inKindAmount', label: 'うち現物', required: false, template: 'うち現物', example: '' },
    { key: 'bonusType', label: '賞与の種類（名前）', required: false, template: '賞与の種類', example: '夏季賞与' },
  ],
};

/** アプリの項目のキー → CSVの列名（空はその列なし） */
export type ColumnMapping = Record<string, string>;

export function templateMapping(kind: ImportKind): ColumnMapping {
  return Object.fromEntries(IMPORT_FIELDS[kind].map((f) => [f.key, f.template]));
}

export function emptyMapping(kind: ImportKind): ColumnMapping {
  return Object.fromEntries(IMPORT_FIELDS[kind].map((f) => [f.key, '']));
}

export function importTemplateCsv(kind: ImportKind): string {
  const f = IMPORT_FIELDS[kind];
  return `${f.map((x) => x.template).join(',')}\r\n${f.map((x) => x.example).join(',')}\r\n`;
}

/** テンプレートの見出しがそろっているか（そろっていれば対応づけなしで取り込める） */
export function isTemplateHeaders(kind: ImportKind, headers: string[]): boolean {
  return headers.length > 0 && IMPORT_FIELDS[kind].every((f) => headers.includes(f.template));
}

/** 対応づけの足りない項目・見出しにない列名 */
export function missingImportColumns(kind: ImportKind, m: ColumnMapping, headers: string[]): string[] {
  const missing: string[] = [];
  for (const f of IMPORT_FIELDS[kind]) {
    const col = m[f.key] ?? '';
    if (f.required && col === '') missing.push(`（${f.label}の列を選んでください）`);
    else if (col !== '' && !headers.includes(col)) missing.push(col);
  }
  if (kind === 'employee' && (m['hireDate'] ?? '') === '' && (m['acquiredDate'] ?? '') === '')
    missing.push('（入社日か資格取得日の列を選んでください）');
  return missing;
}

export type ImportStatus = 'new' | 'same' | 'error' | 'closed' | 'outOfScope';

export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  new: '新しく登録',
  same: '登録済み（取り込まない）',
  error: 'エラー',
  closed: '確定済みのため取り込まない',
  outOfScope: '担当範囲外',
};

export type ImportRow<T> = {
  line: number;
  label: string;
  /** 登録する内容の説明 */
  summary: string;
  status: ImportStatus;
  errors: string[];
  save: T | null;
};

type Cell = (r: string[], key: string) => string;

function cellReader(headers: string[], m: ColumnMapping): Cell {
  return (r, key) => {
    const col = m[key] ?? '';
    const i = col === '' ? -1 : headers.indexOf(col);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
}

const bodyRows = (rows: string[][]) =>
  rows
    .slice(1)
    .map((r, i) => ({ r, line: i + 2 }))
    .filter(({ r }) => r.some((c) => c.trim() !== ''));

const norm = (s: string) => s.replace(/[\s　]/g, '');

const yen = (n: number) => n.toLocaleString('ja-JP');

/** 担当範囲（'all' か事業所ID）に入るか */
const inScope = (scope: string, officeId: string | null) => scope === 'all' || officeId === scope;

/** その日の所属事業所 */
function officeAt(as: Assignment[], date: string): string | null {
  return [...as].filter((a) => a.validFrom <= date).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.officeId ?? null;
}

// ---------------------------------------------------------------- 従業員

export type EmployeeToImport = {
  employeeNumber: string;
  name: string;
  birthDate: string;
  officeId: string;
  /** 所属事業所・支払区分の開始日（資格取得日、なければ入社日） */
  startDate: string;
  /** 資格取得日（未加入は null） */
  acquiredDate: string | null;
  insuredType: InsuredType;
  /** 支払区分（既定の区分なら null） */
  payrollGroupId: string | null;
};

export type EmployeeImportContext = {
  existingNumbers: string[];
  offices: { id: string; name: string }[];
  groups: { id: string; name: string; isDefault?: boolean }[];
  scope: string;
};

/** 被保険者区分を、名前・キー・よくある書き方から読む。空欄は一般被保険者 */
export function parseInsuredType(v: string): InsuredType | null {
  const s = norm(v);
  if (s === '' || s === '一般' || s === '一般被保険者') return 'general';
  for (const [k, label] of Object.entries(INSURED_TYPE_LABEL) as [InsuredType, string][]) if (s === k || s === norm(label)) return k;
  if (s === '短時間就労者') return 'partTime';
  if (s === '短時間') return 'shortTime';
  return null;
}

export function buildEmployeeImport(rows: string[][], m: ColumnMapping, ctx: EmployeeImportContext): ImportRow<EmployeeToImport>[] {
  const cell = cellReader(rows[0] ?? [], m);
  const seen = new Set<string>();
  return bodyRows(rows).map(({ r, line }) => {
    const errors: string[] = [];
    const number = toHalfWidth(cell(r, 'employeeNumber')); // 全角の社員番号も半角にして登録する
    const name = cell(r, 'name');
    if (!number) errors.push('社員番号が空欄です');
    else if (!/^[0-9A-Za-z-]{1,20}$/.test(number)) errors.push('社員番号は半角英数字20文字以内にしてください');
    else if (seen.has(number)) errors.push('同じ社員番号の行がファイルの中に2つ以上あります');
    seen.add(number);
    if (!name) errors.push('氏名が空欄です');
    else if (name.length > 50) errors.push('氏名は50文字以内にしてください');

    const date = (key: string, label: string, required: boolean) => {
      const raw = cell(r, key);
      if (!raw) {
        if (required) errors.push(`${label}が空欄です`);
        return null;
      }
      const d = parseDateLoose(raw);
      if (!d || !isValidDate(d)) errors.push(`${label}を読み取れません（${raw}）`);
      return d;
    };
    const birthDate = date('birthDate', '生年月日', true);
    const hireDate = date('hireDate', '入社日', false);
    const acquiredDate = date('acquiredDate', '資格取得日', false);
    if (!hireDate && !acquiredDate && !errors.some((e) => e.includes('入社日') || e.includes('資格取得日')))
      errors.push('入社日か資格取得日を入れてください');
    if (birthDate && acquiredDate && acquiredDate < birthDate) errors.push('資格取得日が生年月日より前です');

    const officeRaw = cell(r, 'office');
    const office = ctx.offices.find((o) => o.id === officeRaw || norm(o.name) === norm(officeRaw));
    if (!officeRaw) errors.push('適用事業所が空欄です');
    else if (!office) errors.push(`適用事業所「${officeRaw}」が見つかりません`);

    const typeRaw = cell(r, 'insuredType');
    const insuredType = parseInsuredType(typeRaw);
    if (!insuredType) errors.push(`被保険者区分「${typeRaw}」が分かりません`);

    const groupRaw = cell(r, 'payrollGroup');
    const group = groupRaw ? ctx.groups.find((g) => g.id === groupRaw || norm(g.name) === norm(groupRaw)) : null;
    if (groupRaw && !group) errors.push(`支払区分「${groupRaw}」が見つかりません`);

    const label = `${number} ${name}`.trim();
    const summary = office
      ? `${office.name}・${acquiredDate ? `${acquiredDate}に資格取得（${INSURED_TYPE_LABEL[insuredType ?? 'general']}）` : `${hireDate}入社・未加入`}`
      : '';
    if (errors.length > 0) return { line, label, summary, status: 'error' as const, errors, save: null };
    if (ctx.existingNumbers.includes(number))
      return { line, label, summary, status: 'same' as const, errors: ['この社員番号はすでに登録されています（変更は従業員の詳細で）'], save: null };
    if (!inScope(ctx.scope, office!.id)) return { line, label, summary, status: 'outOfScope' as const, errors: [], save: null };
    return {
      line, label, summary, status: 'new' as const, errors: [],
      save: {
        employeeNumber: number, name, birthDate: birthDate!, officeId: office!.id,
        startDate: (acquiredDate ?? hireDate)!, acquiredDate, insuredType: insuredType!,
        payrollGroupId: group && !group.isDefault ? group.id : null,
      },
    };
  });
}

// ---------------------------------------------------------------- 被扶養者

export type DependentToImport = Dependent & { employeeId: string };

export type DependentImportEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  assignments: Assignment[];
  qualifications: Qualification[];
  dependents?: Dependent[];
};

/**
 * 被扶養者のCSV。1行に1人（同じ本人の被扶養者は複数行）
 * 本人に社会保険の資格がない日に扶養に入ることはできないので、扶養に入った日に本人の資格があるかを確かめる
 */
export function buildDependentImport(
  rows: string[][],
  m: ColumnMapping,
  employees: DependentImportEmployee[],
  scope: string,
): ImportRow<DependentToImport>[] {
  const cell = cellReader(rows[0] ?? [], m);
  const seen = new Set<string>();
  return bodyRows(rows).map(({ r, line }) => {
    const errors: string[] = [];
    const number = cell(r, 'employeeNumber');
    const e = number ? findByNumber(employees, number) : null;
    const emp = e ? employees.find((x) => x.id === e.id)! : null;
    if (!emp) errors.push(`社員番号「${number || '空欄'}」の従業員が見つかりません`);
    const name = cell(r, 'name');
    const date = (key: string, label: string, required: boolean) => {
      const raw = cell(r, key);
      if (!raw) {
        if (required) errors.push(`${label}が空欄です`);
        return null;
      }
      const d = parseDateLoose(raw);
      if (!d || !isValidDate(d)) errors.push(`${label}を読み取れません（${raw}）`);
      return d;
    };
    const birthDate = date('birthDate', '被扶養者の生年月日', true);
    const certifiedDate = date('certifiedDate', '扶養に入った日', true);
    const removedDate = date('removedDate', '扶養から外れた日', false);
    const fields = checkDependent({ name, birthDate: birthDate ?? '', certifiedDate: certifiedDate ?? '' });
    if (fields.name) errors.push(fields.name);
    if (birthDate && certifiedDate && fields.certifiedDate) errors.push(fields.certifiedDate);
    if (certifiedDate && removedDate && removedDate <= certifiedDate) errors.push('扶養から外れた日は、扶養に入った日より後の日にしてください');
    if (emp && certifiedDate && !emp.qualifications.some((q) => q.acquiredDate <= certifiedDate && (q.lostDate === null || q.lostDate > certifiedDate)))
      errors.push(`扶養に入った日（${dateLabel(certifiedDate)}）に、本人の社会保険の資格がありません`);
    if (emp && name && birthDate) {
      const key = `${emp.id}|${norm(name)}|${birthDate}`;
      if (seen.has(key)) errors.push('同じ本人・同じ被扶養者の行がファイルの中に2つ以上あります');
      seen.add(key);
    }

    const label = emp ? `${emp.employeeNumber} ${emp.name}` : number;
    const summary = name && certifiedDate ? `${name}（${dateLabel(birthDate)}生）${dateLabel(certifiedDate)}から${removedDate ? `${dateLabel(removedDate)}まで` : '扶養中'}` : '';
    if (errors.length > 0 || !emp || !birthDate || !certifiedDate) return { line, label, summary, status: 'error' as const, errors, save: null };
    if ((emp.dependents ?? []).some((d) => norm(d.name) === norm(name) && d.birthDate === birthDate))
      return { line, label, summary, status: 'same' as const, errors: ['この被扶養者は登録済みです（変更は従業員の詳細で）'], save: null };
    const office = officeAt(emp.assignments, certifiedDate) ?? officeAt(emp.assignments, '9999-12-31');
    if (!inScope(scope, office)) return { line, label, summary, status: 'outOfScope' as const, errors: [], save: null };
    return {
      line, label, summary, status: 'new' as const, errors: [],
      save: { employeeId: emp.id, name, birthDate, certifiedDate, removedDate },
    };
  });
}

// ---------------------------------------------------------------- 標準報酬月額

export type StandardToImport = {
  employeeId: string;
  validFrom: string;
  reason: 'acquisition' | 'regular' | 'revision';
  healthStandard: number;
  pensionStandard: number;
  provisionalId: null;
};

export type StandardImportEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  assignments: Assignment[];
  qualifications: Qualification[];
  standardHistory: { validFrom: string; healthStandard: number; pensionStandard: number }[];
};

/** その月に使う等級表（適用開始がその月以前で最も新しいもの） */
const gradesAt = gradeTableAt;

/** 健康保険の標準報酬月額を、厚生年金の等級の範囲に収める（厚生年金の欄が空のとき） */
export function pensionFromHealth(health: number, table: GradeRow[]): number {
  const p = table.filter((g) => g.pensionGrade !== null).map((g) => g.standardAmount);
  if (p.length === 0) return health;
  return Math.min(Math.max(health, Math.min(...p)), Math.max(...p));
}

export function buildStandardImport(
  rows: string[][],
  m: ColumnMapping,
  employees: StandardImportEmployee[],
  grades: GradeRow[],
  scope: string,
): ImportRow<StandardToImport>[] {
  const cell = cellReader(rows[0] ?? [], m);
  const seen = new Set<string>();
  return bodyRows(rows).map(({ r, line }) => {
    const errors: string[] = [];
    const number = cell(r, 'employeeNumber');
    const e = number ? findByNumber(employees, number) : null;
    const emp = e ? employees.find((x) => x.id === e.id)! : null;
    if (!emp) errors.push(`社員番号「${number || '空欄'}」の従業員が見つかりません`);

    const rawFrom = cell(r, 'validFrom');
    const validFrom = parseYearMonthLoose(rawFrom);
    if (!validFrom) errors.push(`適用年月を読み取れません（${rawFrom || '空欄'}）`);
    const table = validFrom ? gradesAt(grades, validFrom) : [];
    const health = parseStandardLoose(cell(r, 'healthStandard'));
    const pensionRaw = parseStandardLoose(cell(r, 'pensionStandard'));
    if (health === null || Number.isNaN(health)) errors.push('健康保険の標準報酬月額を読み取れません');
    else if (table.length > 0 && !table.some((g) => g.standardAmount === health))
      errors.push(`健康保険の標準報酬月額 ${yen(health)}円は等級表にありません`);
    if (Number.isNaN(pensionRaw)) errors.push('厚生年金の標準報酬月額を読み取れません');
    else if (pensionRaw !== null && table.length > 0 && !table.some((g) => g.pensionGrade !== null && g.standardAmount === pensionRaw))
      errors.push(`厚生年金の標準報酬月額 ${yen(pensionRaw)}円は等級表にありません`);
    if (emp && validFrom) {
      const key = `${emp.id}|${validFrom}`;
      if (seen.has(key)) errors.push('同じ人・同じ適用年月の行がファイルの中に2つ以上あります');
      seen.add(key);
      if (!emp.qualifications.some((q) => q.acquiredDate.slice(0, 7) <= validFrom && (q.lostDate === null || q.lostDate.slice(0, 7) > validFrom)))
        errors.push(`${yearMonthLabel(validFrom)}に社会保険の資格がありません`);
    }

    const label = emp ? `${emp.employeeNumber} ${emp.name}` : number;
    if (errors.length > 0 || !emp || !validFrom || health === null || Number.isNaN(health))
      return { line, label, summary: '', status: 'error' as const, errors, save: null };

    const pension = pensionRaw ?? pensionFromHealth(health, table);
    const summary = `${yearMonthLabel(validFrom)}から 健康保険 ${yen(health)}円・厚生年金 ${yen(pension)}円`;
    const same = emp.standardHistory.find((h) => h.validFrom === validFrom);
    if (same) {
      if (same.healthStandard === health && same.pensionStandard === pension)
        return { line, label, summary, status: 'same' as const, errors: [], save: null };
      return { line, label, summary, status: 'error' as const, errors: ['同じ適用年月の履歴がすでにあり、値が違います（従業員の詳細で確かめてください）'], save: null };
    }
    const office = officeAt(emp.assignments, `${validFrom}-28`) ?? officeAt(emp.assignments, '9999-12-31');
    if (!inScope(scope, office)) return { line, label, summary, status: 'outOfScope' as const, errors: [], save: null };
    // 資格取得月の履歴は資格取得時決定、9月は定時決定、それ以外は随時改定として登録する
    const reason = emp.qualifications.some((q) => q.acquiredDate.slice(0, 7) === validFrom)
      ? ('acquisition' as const)
      : validFrom.endsWith('-09')
        ? ('regular' as const)
        : ('revision' as const);
    return {
      line, label, summary, status: 'new' as const, errors: [],
      save: { employeeId: emp.id, validFrom, reason, healthStandard: health, pensionStandard: pension, provisionalId: null },
    };
  });
}

// ---------------------------------------------------------------- 賞与

export type BonusToImport = {
  employeeId: string;
  paidDate: string;
  amount: number;
  inKindAmount: number | null;
  bonusTypeId: string | null;
  isRemuneration: boolean;
  officeId: string;
};

export type BonusImportContext = {
  employees: { id: string; employeeNumber: string; name: string; assignments: Assignment[] }[];
  /** 登録済みの賞与（同じ人・同じ支給日の二重登録を防ぐ） */
  existing: { employeeId: string; paidDate: string }[];
  types: BonusType[];
  /** 確定済みの「支給月|事業所ID」 */
  closed: Set<string>;
  scope: string;
};

export function buildBonusImport(rows: string[][], m: ColumnMapping, ctx: BonusImportContext): ImportRow<BonusToImport>[] {
  const cell = cellReader(rows[0] ?? [], m);
  const seen = new Set<string>();
  return bodyRows(rows).map(({ r, line }) => {
    const errors: string[] = [];
    const number = cell(r, 'employeeNumber');
    const e = number ? findByNumber(ctx.employees, number) : null;
    if (!e) errors.push(`社員番号「${number || '空欄'}」の従業員が見つかりません`);
    const rawDate = cell(r, 'paidDate');
    const paidDate = parseDateLoose(rawDate);
    if (!paidDate || !isValidDate(paidDate)) errors.push(`支給日を読み取れません（${rawDate || '空欄'}）`);
    const amount = parseNumberLoose(cell(r, 'amount'));
    if (amount === null || Number.isNaN(amount) || amount <= 0) errors.push('賞与額を読み取れません（1円以上）');
    const inKind = parseNumberLoose(cell(r, 'inKindAmount'));
    if (Number.isNaN(inKind) || (inKind !== null && inKind < 0)) errors.push('うち現物を読み取れません');
    else if (inKind !== null && amount !== null && !Number.isNaN(amount) && inKind > amount) errors.push('うち現物が賞与額より多いです');
    const typeRaw = cell(r, 'bonusType');
    const type = typeRaw ? ctx.types.find((t) => t.id === typeRaw || norm(t.name) === norm(typeRaw)) : null;
    if (typeRaw && !type) errors.push(`賞与の種類「${typeRaw}」が見つかりません`);
    const office = e && paidDate ? officeAt(e.assignments, paidDate) : null;
    if (e && paidDate && isValidDate(paidDate) && !office) errors.push('支給日に所属している適用事業所がありません');
    if (e && paidDate) {
      const key = `${e.id}|${paidDate}`;
      if (seen.has(key)) errors.push('同じ社員番号・支給日の行がファイルの中に2つ以上あります');
      seen.add(key);
    }

    const label = e ? `${e.employeeNumber} ${e.name}` : number;
    const summary =
      paidDate && amount && !Number.isNaN(amount)
        ? `${dateLabel(paidDate)} ${yen(amount)}円${inKind ? `（うち現物 ${yen(inKind)}円）` : ''}${type ? `・${type.name}` : ''}`
        : '';
    if (errors.length > 0 || !e || !paidDate || amount === null || !office)
      return { line, label, summary, status: 'error' as const, errors, save: null };
    if (ctx.existing.some((b) => b.employeeId === e.id && b.paidDate === paidDate))
      return { line, label, summary, status: 'same' as const, errors: ['同じ支給日の賞与が登録済みです（直すときは賞与の画面で）'], save: null };
    if (ctx.closed.has(`${paidDate.slice(0, 7)}|${office}`)) return { line, label, summary, status: 'closed' as const, errors: [], save: null };
    if (!inScope(ctx.scope, office)) return { line, label, summary, status: 'outOfScope' as const, errors: [], save: null };
    const isRemuneration = isRemunerationBonus(ctx.types, type?.id, paidDate);
    return {
      line, label, summary: isRemuneration ? `${summary}（報酬扱い）` : summary, status: 'new' as const, errors: [],
      save: { employeeId: e.id, paidDate, amount, inKindAmount: inKind, bonusTypeId: type?.id ?? null, isRemuneration, officeId: office },
    };
  });
}

/** CSVの支給日の列から、支給日の範囲（既存の賞与・確定を読むのに使う） */
export function bonusDateRange(rows: string[][], m: ColumnMapping): { from: string; to: string } | null {
  const cell = cellReader(rows[0] ?? [], m);
  const dates = bodyRows(rows)
    .map(({ r }) => parseDateLoose(cell(r, 'paidDate')))
    .filter((d): d is string => !!d && isValidDate(d))
    .sort();
  return dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
}
