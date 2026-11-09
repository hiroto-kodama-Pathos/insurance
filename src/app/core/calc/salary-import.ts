// 給与のCSV取り込み（設計書 3.8）
// 給与ソフトごとに列の並びや名前が違うため、列の対応づけを会社の設定（csvMappings.salary）に保存して毎月使う。
import { parseDateLoose, parseHoursLoose, parseNumberLoose } from './csv';
import { findOffice, Assignment, Office } from './office';
import { addMonths, baseDaysTotalError, baseDaysWarning, SalaryRecord, validateSalary } from './salary';
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
  /**
   * 算定から除く額（任意の列。支払月・締め日の変更月に、随時改定・定時決定の平均から除く額。設計書 2.13）。
   * 除く額が要る月の行では、この列に額（なければ0）が入っていないと取り込まない
   */
  excludedAmount?: string;
};

/** アプリ指定の形式（テンプレート）の列名。この形式のファイルは対応づけなしで取り込める */
export const TEMPLATE_HEADERS = ['社員番号', '支払日', '支払基礎日数', '固定的賃金', '非固定的賃金', 'うち遡及差額', 'うち現物給与', '労働時間', '時給単価'];
/** テンプレートの任意の列（前のテンプレートで作ったファイルでも、テンプレートの形式として読めるように、形式の判定には使わない） */
export const TEMPLATE_OPTIONAL_HEADERS = ['算定から除く額'];

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
  excludedAmount: '算定から除く額',
};

export function templateCsv(): string {
  return `${[...TEMPLATE_HEADERS, ...TEMPLATE_OPTIONAL_HEADERS].join(',')}\r\n0001,2026-10-25,31,340000,20000,,,,,\r\n`;
}

/**
 * 対応づけの矛盾（同じ列を固定的賃金と非固定的賃金の両方に選ぶなど）。あれば取り込み・保存をしない
 * 同じ列を両方で合計すると、その額が二重に数えられ、随時改定・定時決定の報酬を誤るため
 */
export function mappingConflicts(mapping: SalaryMapping): string[] {
  const both = mapping.fixedWages.filter((c) => mapping.nonFixedWages.includes(c));
  return both.map((c) => `「${c}」の列を、固定的賃金と非固定的賃金の両方に選んでいます（どちらか一方にしてください）`);
}

/** 対応づけが、このCSVの見出しで使えるか（使えない列名を返す） */
export function missingColumns(mapping: SalaryMapping, headers: string[]): string[] {
  const required = [mapping.employeeNumber, mapping.paidDate, mapping.paymentBaseDays, ...mapping.fixedWages];
  const optional = [...mapping.nonFixedWages, mapping.retroactiveDiff, mapping.inKindWages].filter((c) => c !== '');
  // 労働時間・時給単価・算定から除く額の列はなくてもよい（ないときは取り込まない。除く額が要る月の行はエラーになる）
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
  /** 取り込むが、確かめてほしいこと（支払基礎日数が計算期間の暦日数より多いなど） */
  warnings: string[];
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
  /**
   * その人のその支払月が、算定から除く額の要る月（支払月・締め日の変更月）か。
   * 取り込む画面では必ず渡す（支払区分を読めないときは、取り込み自体を止める）。渡さないのは、ファイルの支払月を集めるときだけ
   */
  needsExclusion?: (employeeId: string, yearMonth: string) => boolean;
  /** その人のその支払月の、給与の計算期間の暦日数（締め日・支払月の変更月は null）。渡さなければ注意しない */
  periodDaysOf?: (employeeId: string, yearMonth: string) => number | null;
  /** 今日（YYYY-MM-DD）。支払日が来月より先の行に注意を出す。渡さなければ注意しない */
  today?: string;
  /** 登録済みの給与の支払基礎日数（同じ月の支払いの合計を確かめる。ファイルで上書きする支払日の分は数えない） */
  existingDays?: { employeeId: string; paidDate: string; paymentBaseDays: number }[];
};

/** 小数の数字か（「300000.5」など）。金額・日数は整数なので、読めない理由をはっきり伝える */
const isDecimal = (raw: string | undefined) => /^-?\d+\.\d+$/.test(toHalfWidth(raw ?? '').replace(/[,\s円¥日]/g, ''));

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
  return checkBaseDaysTotal(checkExclusion(buildRows(rows, mapping, ctx), ctx), ctx);
}

/**
 * 同じ人・同じ月の支払基礎日数の合計（ファイルの行＋登録済みの給与。上書きする支払日は、ファイルの値で数える）が、
 * 給与の計算期間の暦日数を超えたら、その月のファイルの行をエラーにする（2回目以降の支払いに1か月分の日数を入れた誤り）
 */
function checkBaseDaysTotal(result: PreviewRow[], ctx: PreviewContext): PreviewRow[] {
  const periodDaysOf = ctx.periodDaysOf;
  if (!periodDaysOf) return result;
  const days = new Map<string, Map<string, number>>(); // 人|月 → 支払日 → 日数
  const add = (employeeId: string, paidDate: string, d: number) => {
    const key = `${employeeId}|${paidDate.slice(0, 7)}`;
    if (!days.has(key)) days.set(key, new Map());
    days.get(key)!.set(paidDate, d);
  };
  for (const s of ctx.existingDays ?? []) add(s.employeeId, s.paidDate, s.paymentBaseDays);
  const imported = (r: PreviewRow) => !!r.salary && (r.status === 'new' || r.status === 'overwrite');
  for (const r of result) if (imported(r)) add(r.salary!.employeeId, r.salary!.paidDate, r.salary!.paymentBaseDays);
  return result.map((r) => {
    if (!imported(r) || !r.salary) return r;
    const key = `${r.salary.employeeId}|${r.salary.paidDate.slice(0, 7)}`;
    const all = [...days.get(key)!.values()];
    if (all.length < 2) return r;
    const msg = baseDaysTotalError(all[0], all.slice(1), periodDaysOf(r.salary.employeeId, r.salary.paidDate.slice(0, 7)));
    return msg ? { ...r, status: 'error' as const, errors: [msg] } : r;
  });
}

function checkExclusion(result: PreviewRow[], ctx: PreviewContext): PreviewRow[] {
  // 算定から除く額が要る月（支払月・締め日の変更月）は、同じ人・同じ月の行のどれかに額（なければ0）が要る。
  // 空のまま取り込むと、平均から除く額が引かれず、随時改定・定時決定を誤るため、その月の行は取り込まない
  const need = ctx.needsExclusion;
  if (!need) return result;
  const entered = new Set<string>();
  for (const r of result) if (r.salary && r.salary.excludedAmount !== null && r.salary.excludedAmount !== undefined) entered.add(`${r.salary.employeeId}|${r.salary.paidDate.slice(0, 7)}`);
  return result.map((r) => {
    if (!r.salary) return r;
    const ym = r.salary.paidDate.slice(0, 7);
    if (!need(r.salary.employeeId, ym)) return { ...r, salary: { ...r.salary, excludedAmount: null } };
    if (entered.has(`${r.salary.employeeId}|${ym}`)) return r;
    const msg = `${Number(ym.slice(5))}月は支払月・締め日の変更月のため、算定から除く額が要ります（「算定から除く額」の列に額を入れてください。除く額がなければ0）`;
    return { ...r, status: 'error' as const, errors: [...r.errors.filter((e) => e !== '担当範囲外の事業所の従業員のため取り込みません' && e !== '確定済みのため取り込みません'), msg] };
  });
}

function buildRows(rows: string[][], mapping: SalaryMapping, ctx: PreviewContext): PreviewRow[] {
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
          errors.push(
            isDecimal(cell(r, n))
              ? `${label}の「${n}」が小数です（円単位の整数で入れてください）`
              : `${label}の「${n}」を数値として読み取れません`,
          );
          continue;
        }
        if (v !== null) total = (total ?? 0) + v;
      }
      return total;
    };
    // 固定的賃金は必須（画面と同じ）。対応づけた列がすべて空欄なら、0円とせずにエラーにする（0円は「0」と入っていれば取り込む）
    const fixedSum = sum(mapping.fixedWages, '固定的賃金');
    if (fixedSum === null && !errors.some((e) => e.startsWith('固定的賃金の')))
      errors.push(`固定的賃金が空欄です（${mapping.fixedWages.map((c) => `「${c}」`).join('')}がすべて空欄。固定的賃金がない月は0を入れてください）`);
    const fixedWages = fixedSum ?? 0;
    const nonFixedWages = sum(mapping.nonFixedWages, '非固定的賃金') ?? 0;
    const days = parseNumberLoose(cell(r, mapping.paymentBaseDays));
    const retro = parseNumberLoose(cell(r, mapping.retroactiveDiff));
    const inKind = parseNumberLoose(cell(r, mapping.inKindWages));
    const hours = parseHoursLoose(cell(r, mapping.workingHours ?? ''));
    const rate = parseNumberLoose(cell(r, mapping.hourlyRate ?? ''));
    const excluded = parseNumberLoose(cell(r, mapping.excludedAmount ?? ''));
    const unreadable = (label: string, raw: string | undefined, unit: string) =>
      isDecimal(raw) ? `${label}が小数です（${unit}の整数で入れてください）` : `${label}を数値として読み取れません`;
    if (Number.isNaN(days)) errors.push(unreadable('支払基礎日数', cell(r, mapping.paymentBaseDays), '日'));
    if (Number.isNaN(retro)) errors.push(unreadable('うち遡及差額', cell(r, mapping.retroactiveDiff), '円単位'));
    if (Number.isNaN(inKind)) errors.push(unreadable('うち現物給与', cell(r, mapping.inKindWages), '円単位'));
    if (Number.isNaN(hours)) errors.push('労働時間を数値として読み取れません');
    if (Number.isNaN(rate)) errors.push('時給単価を数値として読み取れません');
    if (Number.isNaN(excluded)) errors.push('算定から除く額を数値として読み取れません');

    const input = {
      paidDate: paidDate ?? '',
      fixedWages,
      nonFixedWages,
      paymentBaseDays: Number.isNaN(days) ? null : days,
      retroactiveDiff: Number.isNaN(retro) ? null : retro,
      inKindWages: Number.isNaN(inKind) ? null : inKind,
      workingHours: Number.isNaN(hours) ? null : hours,
      hourlyRate: Number.isNaN(rate) ? null : rate,
      excludedAmount: Number.isNaN(excluded) ? null : excluded,
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

    const warnings: string[] = [];
    if (employee && paidDate && ctx.periodDaysOf) {
      const w = baseDaysWarning(input.paymentBaseDays, ctx.periodDaysOf(employee.id, paidDate.slice(0, 7)));
      if (w) warnings.push(w);
    }
    // 過去の給与は取り込める（定時決定・随時改定に前の月が要る）。来月より先の支払日は、年・月の打ち間違いのことが多いので注意する
    if (paidDate && ctx.today && paidDate.slice(0, 7) > addMonths(ctx.today.slice(0, 7), 1))
      warnings.push(`支払日（${paidDate}）が来月より先です。年・月を確かめてください`);
    const base = { line, employeeNumber: rawNumber, name: employee?.name ?? '', officeId, warnings };
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
      // 0円と入れたのは担当者の判断として残す（空欄と区別する）
      excludedAmount: input.excludedAmount,
    };
    if (ctx.scope !== 'all' && officeId !== ctx.scope)
      return { ...base, status: 'outOfScope' as const, errors: ['担当範囲外の事業所の従業員のため取り込みません'], salary };
    if (ctx.closed.has(`${paidDate!.slice(0, 7)}|${officeId}`))
      return { ...base, status: 'closed' as const, errors: ['確定済みのため取り込みません'], salary };
    const status = ctx.existingIds.has(`${employee!.id}_${paidDate}`) ? ('overwrite' as const) : ('new' as const);
    return { ...base, status, errors: [], salary };
  });
}
