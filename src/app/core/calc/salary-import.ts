// 給与のCSV取り込み（設計書 3.8）
// 給与ソフトごとに列の並びや名前が違うため、列の対応づけを会社の設定（csvMappings.salary）に保存して毎月使う。
import { parseDateLoose, parseHoursLoose, parseNumberLoose } from './csv';
import { findOffice, Assignment, Office } from './office';
import { SalaryRecord, validateSalary } from './salary';
import { toHalfWidth } from './half-width';

/** アプリの項目ごとに、対応するCSVの列名（固定的・非固定的賃金は複数の列を合計） */
export type SalaryMapping = {
  employeeNumber: string;
  paidDate: string;
  paymentBaseDays: string;
  fixedWages: string[];
  nonFixedWages: string[];
  retroactiveDiff: string;
  inKindWages: string;
  /** 実際の労働時間（任意。未加入の人の加入の可能性に使う） */
  workingHours?: string;
  /** 時給単価（任意。時給の人の随時改定に使う） */
  hourlyRate?: string;
};

/** アプリ指定の形式（テンプレート）の列名。この形式のファイルは対応づけなしで取り込める */
export const TEMPLATE_HEADERS = ['社員番号', '支払日', '支払基礎日数', '固定的賃金', '非固定的賃金', 'うち遡及差額', 'うち現物給与', '労働時間', '時給単価'];

export const TEMPLATE_MAPPING: SalaryMapping = {
  employeeNumber: '社員番号',
  paidDate: '支払日',
  paymentBaseDays: '支払基礎日数',
  fixedWages: ['固定的賃金'],
  nonFixedWages: ['非固定的賃金'],
  retroactiveDiff: 'うち遡及差額',
  inKindWages: 'うち現物給与',
  workingHours: '労働時間',
  hourlyRate: '時給単価',
};

export function templateCsv(): string {
  return `${TEMPLATE_HEADERS.join(',')}\r\n0001,2026-10-25,31,340000,20000,,,,\r\n`;
}

/** 対応づけが、このCSVの見出しで使えるか（使えない列名を返す） */
export function missingColumns(mapping: SalaryMapping, headers: string[]): string[] {
  const required = [mapping.employeeNumber, mapping.paidDate, mapping.paymentBaseDays, ...mapping.fixedWages];
  const optional = [...mapping.nonFixedWages, mapping.retroactiveDiff, mapping.inKindWages].filter((c) => c !== '');
  // 労働時間・時給単価の列はなくてもよい（ないときは取り込まない）
  const missing = [...required, ...optional].filter((c) => !headers.includes(c));
  if (mapping.employeeNumber === '' || mapping.paidDate === '' || mapping.paymentBaseDays === '' || mapping.fixedWages.length === 0)
    missing.unshift('（必須の項目が未設定）');
  return [...new Set(missing)];
}

export type ImportEmployee = { id: string; employeeNumber: string; name: string; assignments: Assignment[] };

export type PreviewStatus = 'new' | 'overwrite' | 'error' | 'closed' | 'outOfScope';

export type PreviewRow = {
  /** CSVの行番号（見出しを1行目として数える） */
  line: number;
  employeeNumber: string;
  name: string;
  status: PreviewStatus;
  errors: string[];
  salary: Omit<SalaryRecord, 'id'> | null;
  officeId: string | null;
};

export type PreviewContext = {
  employees: ImportEmployee[];
  offices: Office[];
  /** 確定済みの「支払月|事業所ID」 */
  closed: Set<string>;
  /** 登録済みの給与のID（従業員ID_支払日） */
  existingIds: Set<string>;
  /** 担当範囲（'all' または事業所ID） */
  scope: string;
};

/** 社員番号で従業員を探す。先頭の0が消えていても、登録済みの社員番号の桁数にそろえて照合する */
export function findByNumber(employees: ImportEmployee[], raw: string): ImportEmployee | null {
  const v = toHalfWidth(raw).trim();
  const exact = employees.find((e) => e.employeeNumber === v);
  if (exact) return exact;
  if (!/^\d+$/.test(v)) return null;
  const matches = employees.filter((e) => /^\d+$/.test(e.employeeNumber) && e.employeeNumber.length > v.length && e.employeeNumber === v.padStart(e.employeeNumber.length, '0'));
  return matches.length === 1 ? matches[0] : null;
}

/** CSVの行（見出しを含む）から、取り込む内容とエラーを作る */
export function buildPreview(rows: string[][], mapping: SalaryMapping, ctx: PreviewContext): PreviewRow[] {
  const [headers, ...body] = rows;
  const col = (name: string) => headers.indexOf(name);
  const cell = (r: string[], name: string) => (name === '' || col(name) < 0 ? undefined : r[col(name)]);
  const seen = new Set<string>();

  return body.map((r, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const rawNumber = (cell(r, mapping.employeeNumber) ?? '').trim();
    const employee = findByNumber(ctx.employees, rawNumber);
    if (!employee) errors.push(`登録されていない社員番号です（${rawNumber || '空欄'}）`);

    const rawDate = cell(r, mapping.paidDate) ?? '';
    const paidDate = parseDateLoose(rawDate);
    if (!paidDate) errors.push(`支払日を読み取れません（${rawDate || '空欄'}）`);

    const sum = (names: string[], label: string): number | null => {
      let total: number | null = null;
      for (const n of names) {
        const v = parseNumberLoose(cell(r, n));
        if (Number.isNaN(v)) {
          errors.push(`${label}の「${n}」を数値として読み取れません`);
          continue;
        }
        if (v !== null) total = (total ?? 0) + v;
      }
      return total;
    };
    const fixedWages = sum(mapping.fixedWages, '固定的賃金') ?? 0;
    const nonFixedWages = sum(mapping.nonFixedWages, '非固定的賃金') ?? 0;
    const days = parseNumberLoose(cell(r, mapping.paymentBaseDays));
    const retro = parseNumberLoose(cell(r, mapping.retroactiveDiff));
    const inKind = parseNumberLoose(cell(r, mapping.inKindWages));
    const hours = parseHoursLoose(cell(r, mapping.workingHours ?? ''));
    const rate = parseNumberLoose(cell(r, mapping.hourlyRate ?? ''));
    if (Number.isNaN(days)) errors.push('支払基礎日数を数値として読み取れません');
    if (Number.isNaN(retro)) errors.push('うち遡及差額を数値として読み取れません');
    if (Number.isNaN(inKind)) errors.push('うち現物給与を数値として読み取れません');
    if (Number.isNaN(hours)) errors.push('労働時間を数値として読み取れません');
    if (Number.isNaN(rate)) errors.push('時給単価を数値として読み取れません');

    const input = {
      paidDate: paidDate ?? '',
      fixedWages,
      nonFixedWages,
      paymentBaseDays: Number.isNaN(days) ? null : days,
      retroactiveDiff: Number.isNaN(retro) ? null : retro,
      inKindWages: Number.isNaN(inKind) ? null : inKind,
      workingHours: Number.isNaN(hours) ? null : hours,
      hourlyRate: Number.isNaN(rate) ? null : rate,
    };
    if (paidDate) {
      const v = validateSalary(input);
      for (const [k, msg] of Object.entries(v)) if (k !== 'paidDate') errors.push(msg!);
    }

    let officeId: string | null = null;
    if (employee && paidDate) {
      try {
        officeId = findOffice(employee.assignments, ctx.offices, paidDate).id;
      } catch {
        errors.push('支払日に所属している適用事業所がありません');
      }
      const key = `${employee.id}_${paidDate}`;
      if (seen.has(key)) errors.push('同じ社員番号・支払日の行がファイルの中に2つ以上あります');
      seen.add(key);
    }

    const base = { line, employeeNumber: rawNumber, name: employee?.name ?? '', officeId };
    if (errors.length > 0) return { ...base, status: 'error' as const, errors, salary: null };
    const salary: Omit<SalaryRecord, 'id'> = {
      employeeId: employee!.id,
      paidDate: paidDate!,
      fixedWages,
      nonFixedWages,
      paymentBaseDays: input.paymentBaseDays!,
      retroactiveDiff: input.retroactiveDiff || null,
      inKindWages: input.inKindWages || null,
      workingHours: input.workingHours ?? null,
      hourlyRate: input.hourlyRate || null,
    };
    if (ctx.scope !== 'all' && officeId !== ctx.scope)
      return { ...base, status: 'outOfScope' as const, errors: ['担当範囲外の事業所の従業員のため取り込みません'], salary };
    if (ctx.closed.has(`${paidDate!.slice(0, 7)}|${officeId}`))
      return { ...base, status: 'closed' as const, errors: ['確定済みのため取り込みません'], salary };
    const status = ctx.existingIds.has(`${employee!.id}_${paidDate}`) ? ('overwrite' as const) : ('new' as const);
    return { ...base, status, errors: [], salary };
  });
}
