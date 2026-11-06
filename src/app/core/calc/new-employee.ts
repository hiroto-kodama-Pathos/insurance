// 従業員の新規登録の入力チェック（設計書 3.1）
import { daysInMonth, monthOf } from './date';
import { ageReachedDate } from './age';
import { dateLabel } from './year-month';
import type { InsuredType } from './insured-type';
import type { EligibilityInput, EligibilityResult } from './eligibility-check';
import { checkDependent, type DependentInput } from './dependent';
import { standardGradeError, type GradeRow } from './grade-suggest';

/** 入社時の報酬月額の内訳（設計書 2.3）。基本給は必須、ほかは空欄なら0円 */
export type RemunerationBreakdown = {
  /** 基本給（日給・時給の人は、日額・時給 × 1か月の所定の日数・時間） */
  basic: number | null;
  /** 諸手当（役職手当・家族手当・住宅手当など、毎月決まって払う手当） */
  allowances: number | null;
  /** 通勤手当（1か月分。6か月定期などは月数で割った額） */
  commuting: number | null;
  /** 残業代の見込み */
  overtime: number | null;
};

export const BREAKDOWN_KEYS = ['basic', 'allowances', 'commuting', 'overtime'] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];

export const BREAKDOWN_LABEL: Record<BreakdownKey, string> = {
  basic: '基本給',
  allowances: '諸手当',
  commuting: '通勤手当（1か月分）',
  overtime: '残業代の見込み',
};

export const EMPTY_BREAKDOWN: RemunerationBreakdown = { basic: null, allowances: null, commuting: null, overtime: null };

/** 内訳の合計（報酬月額）。基本給が空なら null */
export function breakdownTotal(b: RemunerationBreakdown): number | null {
  if (b.basic === null) return null;
  return BREAKDOWN_KEYS.reduce((t, k) => t + (b[k] ?? 0), 0);
}

/** 保存用：空欄を0円にする */
export function normalizeBreakdown(b: RemunerationBreakdown): Record<BreakdownKey, number> {
  return { basic: b.basic ?? 0, allowances: b.allowances ?? 0, commuting: b.commuting ?? 0, overtime: b.overtime ?? 0 };
}

export type BreakdownErrors = Partial<Record<BreakdownKey, string>>;

/** 内訳のチェック。基本給は1円以上、ほかは空欄か0円以上の円 */
export function checkBreakdown(b: RemunerationBreakdown): BreakdownErrors {
  const e: BreakdownErrors = {};
  const yen = (v: number | null) => v !== null && Number.isInteger(v) && v >= 0;
  if (!yen(b.basic) || b.basic === 0) e.basic = '基本給を円で入力してください';
  for (const k of ['allowances', 'commuting', 'overtime'] as const)
    if (b[k] !== null && !yen(b[k])) e[k] = '0円以上の円で入力してください（なければ空欄）';
  return e;
}

export type NewEmployeeInput = {
  employeeNumber: string;
  name: string;
  birthDate: string;
  officeId: string;
  /** 社会保険に加入するか。未加入なら、資格取得日・報酬月額・標準報酬月額は使わない */
  insured: boolean;
  /** 資格取得日（加入しない人は入社日） */
  acquiredDate: string;
  /** 加入対象の判定の入力（設計書 2.24） */
  eligibility?: EligibilityInput;
  /** 示した候補と理由（保存用。入力が足りず判定できなかったときは null） */
  eligibilityResult?: Pick<EligibilityResult, 'candidate' | 'reasons'> | null;
  /** 給与の支払区分（初期値は既定の区分） */
  payrollGroupId?: string;
  /** 被保険者区分（初期値は一般被保険者） */
  insuredType?: InsuredType;
  /** 報酬月額の内訳（入社時の見込み）。合計が資格取得届に書く報酬月額 */
  breakdown: RemunerationBreakdown;
  healthStandard: number | null;
  pensionStandard: number | null;
  /** 被扶養者（加入する人だけ。扶養に入った日が空なら資格取得日） */
  dependents?: DependentInput[];
  /**
   * 導入時の登録（以前から在籍している人。設計書 3.1）。入社時の資格取得時決定ではなく、
   * いちばん新しい決定通知書の標準報酬月額を、その適用開始月から登録する。報酬月額の内訳は使わない
   */
  onboarding?: { validFrom: string } | null;
};

export type NewEmployeeErrors = Partial<Record<keyof NewEmployeeInput | BreakdownKey | 'weeklyHours' | 'monthlyDays' | 'contractEnd' | 'onboardingFrom' | `dependent${number}`, string>>;

// ---- 導入時の登録（以前から在籍している人） ----

/** 導入時の登録を選べるか：資格取得月が今月より前（今月に入社した人は、ふつうの登録で入社時の報酬から決める） */
export function canOnboard(acquiredDate: string, today: string): boolean {
  return isValidDate(acquiredDate) && monthOf(acquiredDate) < monthOf(today);
}

/**
 * 導入時の登録で、標準報酬月額の適用開始月の初期値：いちばん近い定時決定の月（今月以前の9月）。
 * それより後に入社した人は、資格取得月（資格取得時決定の額がまだ使われている）
 */
export function defaultOnboardingFrom(acquiredDate: string, today: string): string {
  const ym = monthOf(today);
  const sept = `${Number(ym.slice(0, 4)) - (ym.slice(5, 7) < '09' ? 1 : 0)}-09`;
  const acquired = isValidDate(acquiredDate) ? monthOf(acquiredDate) : '';
  return acquired > sept ? acquired : sept;
}

/** 標準報酬月額の決定の理由：資格取得月なら資格取得時決定、9月なら定時決定、それ以外は随時改定（標準報酬月額のCSVと同じ） */
export function standardReasonFor(validFrom: string, acquiredDate: string): 'acquisition' | 'regular' | 'revision' {
  if (isValidDate(acquiredDate) && monthOf(acquiredDate) === validFrom) return 'acquisition';
  return validFrom.endsWith('-09') ? 'regular' : 'revision';
}

/** 'YYYY-MM' として正しい年月か */
function isValidMonthText(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 被扶養者の扶養に入った日（空なら資格取得日） */
export function withCertifiedDate(d: DependentInput, acquiredDate: string): DependentInput {
  return { ...d, certifiedDate: d.certifiedDate || acquiredDate };
}

/**
 * 児童を使える日（労働基準法56条）
 * 満15歳に達した日（15歳の誕生日の前日）以後の最初の3月31日（中学校の卒業の時期）が終わるまでは、原則として働けない。
 * その3月31日を返す（この日が終わるまで＝この日以前は原則として働けない）
 */
export function childLaborEndDate(birthDate: string): string {
  const y = Number(birthDate.slice(0, 4)) + 15;
  // 満15歳に達する日は誕生日の前日。4月1日生まれは3月31日に達するので、その年の3月31日
  const reach = new Date(Date.UTC(y, Number(birthDate.slice(5, 7)) - 1, Number(birthDate.slice(8, 10)) - 1)).toISOString().slice(0, 10);
  const marchThisYear = `${reach.slice(0, 4)}-03-31`;
  return reach <= marchThisYear ? marchThisYear : `${Number(reach.slice(0, 4)) + 1}-03-31`;
}

/** 入社日（資格取得日）が、児童を原則として使えない期間に入っていれば、その注意の一文。入っていなければ空 */
export function childLaborNotice(birthDate: string, hireDate: string): string {
  if (!isValidDate(birthDate) || !isValidDate(hireDate)) return '';
  const end = childLaborEndDate(birthDate);
  if (hireDate > end) return '';
  const ja = `${Number(end.slice(0, 4))}年3月31日`;
  // 入社日の時点の満年齢（年齢は誕生日の前日に1つ増える）。なぜ出たのかが文だけで分かるように、入社日と一緒に出す
  const years = Number(hireDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  const age = hireDate >= ageReachedDate(birthDate, years) ? years : years - 1;
  return `入社日（${dateLabel(hireDate)}）の時点で${age}歳です。満15歳に達した日以後の最初の3月31日（${ja}）が終わるまでは、労働基準法により原則として働くことができません（労働基準監督署長の許可を受けた場合を除く）。入社日を確かめてください。`;
}

/** 所定労働時間・日数を空欄にできる雇用区分か（正社員・役員） */
export function hoursOptional(employmentType: EligibilityInput['employmentType']): boolean {
  return employmentType === 'regular' || employmentType === 'officer';
}

/**
 * 加入対象の判定の入力のチェック（入社時の登録と、契約が変わったときの更新で使う）
 * 正社員・役員は所定労働時間・日数を空欄でよい（正社員は通常の労働者、役員は所定労働時間で判定しないため）
 * @param baseDate 入社日・契約が変わった日（契約の終わりはこの日以後）
 * @param baseLabel エラーの文に出す、baseDate の呼び名
 */
export function checkEligibilityInput(
  el: EligibilityInput,
  baseDate: string,
  baseLabel: string,
): Partial<Record<'weeklyHours' | 'monthlyDays' | 'contractEnd', string>> {
  const e: Partial<Record<'weeklyHours' | 'monthlyDays' | 'contractEnd', string>> = {};
  const optional = hoursOptional(el.employmentType);
  const h = el.weeklyHours;
  if (h === null ? !optional : !(h >= 0 && h <= 168 && Math.round(h * 10) === h * 10)) e.weeklyHours = '週の所定労働時間を0〜168時間で入力してください（小数第1位まで）';
  const d = el.monthlyDays;
  if (d === null ? !optional : !(Number.isInteger(d) && d >= 0 && d <= 31)) e.monthlyDays = '月の所定労働日数を0〜31日で入力してください';
  if (el.contractEnd !== '') {
    if (!isValidDate(el.contractEnd)) e.contractEnd = '契約の終わりの日を正しく入力してください';
    else if (isValidDate(baseDate) && el.contractEnd < baseDate) e.contractEnd = `契約の終わりは${baseLabel}以後にしてください`;
  }
  return e;
}

/** 'YYYY-MM-DD' として正しい日付か */
export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function isPositiveInt(v: number | null): v is number {
  return v !== null && Number.isInteger(v) && v > 0;
}

/**
 * 新規登録の入力をチェックする。エラーがなければ空のオブジェクトを返す
 *
 * @param input 入力
 * @param existingNumbers 登録済みの社員番号
 * @param today 今日 'YYYY-MM-DD'（生年月日が今日より後でないかを確かめる）
 * @param grades 等級表（標準報酬月額が等級の額かを、資格取得月の表で確かめる。空なら確かめない）
 */
export function validateNewEmployee(input: NewEmployeeInput, existingNumbers: string[], today?: string, grades: GradeRow[] = []): NewEmployeeErrors {
  const e: NewEmployeeErrors = {};
  const num = input.employeeNumber.trim();
  if (!num) e.employeeNumber = '社員番号を入力してください';
  else if (!/^[0-9A-Za-z-]{1,20}$/.test(num)) e.employeeNumber = '社員番号は半角英数字20文字以内で入力してください';
  else if (existingNumbers.includes(num)) e.employeeNumber = 'この社員番号はすでに登録されています';

  if (!input.name.trim()) e.name = '氏名を入力してください';
  else if (input.name.trim().length > 50) e.name = '氏名は50文字以内で入力してください';

  if (!isValidDate(input.birthDate)) e.birthDate = '生年月日を正しく入力してください';
  else if (today && input.birthDate > today) e.birthDate = '生年月日に、今日より後の日は入れられません';
  else if (isValidDate(input.acquiredDate) && input.birthDate >= input.acquiredDate) e.birthDate = '生年月日は、資格取得日（入社日）より前の日にしてください';
  if (!input.officeId) e.officeId = '所属する適用事業所を選んでください';

  if (input.eligibility) Object.assign(e, checkEligibilityInput(input.eligibility, input.acquiredDate, '入社日'));

  if (!input.insured) {
    if (!isValidDate(input.acquiredDate)) e.acquiredDate = '入社日を正しく入力してください';
    return e;
  }

  if (!isValidDate(input.acquiredDate)) e.acquiredDate = '資格取得日を正しく入力してください';
  else if (isValidDate(input.birthDate) && input.acquiredDate <= input.birthDate)
    e.acquiredDate = '資格取得日は生年月日より後の日付にしてください';

  // 導入時の登録：内訳は使わず、決定通知書の適用開始月を確かめる
  const ob = input.onboarding ?? null;
  let standardMonth = isValidDate(input.acquiredDate) ? monthOf(input.acquiredDate) : '';
  if (ob) {
    if (today && isValidDate(input.acquiredDate) && !canOnboard(input.acquiredDate, today))
      e.acquiredDate = '今月に資格を取得した人は、導入時の登録ではなく、入社時の報酬月額から標準報酬月額を決めて登録してください';
    if (!isValidMonthText(ob.validFrom)) e.onboardingFrom = '標準報酬月額の適用開始月を、決定通知書のとおりに入力してください';
    else if (standardMonth && ob.validFrom < standardMonth) e.onboardingFrom = '適用開始月は資格取得月以後にしてください';
    else if (today && ob.validFrom > monthOf(today)) e.onboardingFrom = '適用開始月は今月以前にしてください（届いている決定通知書のうち、いちばん新しいもの）';
    standardMonth = isValidMonthText(ob.validFrom) ? ob.validFrom : '';
  } else {
    Object.assign(e, checkBreakdown(input.breakdown));
  }

  for (const key of ['healthStandard', 'pensionStandard'] as const) {
    const v = input[key];
    if (!isPositiveInt(v)) e[key] = ob ? '標準報酬月額を、決定通知書の額で入れてください' : '標準報酬月額を入れてください（「提案を入力」で入ります）';
    else if (v % 1000 !== 0) e[key] = '標準報酬月額は1,000円単位です';
    else if (standardMonth) {
      const g = standardGradeError(grades, standardMonth, key === 'healthStandard' ? 'health' : 'pension', v);
      if (g) e[key] = g;
    }
  }
  // 被扶養者（加入する人だけ）。行ごとに最初の誤りを出す
  if (input.insured) {
    (input.dependents ?? []).forEach((raw, k) => {
      const d = withCertifiedDate(raw, input.acquiredDate);
      const de = checkDependent(d, today);
      let msg = de.name ?? de.birthDate ?? de.certifiedDate;
      if (!msg && isValidDate(input.acquiredDate) && d.certifiedDate < input.acquiredDate) msg = '扶養に入った日は資格取得日以後にしてください';
      if (msg) e[`dependent${k}`] = `被扶養者${k + 1}人目：${msg}`;
    });
  }
  return e;
}

/** 同じような仕事をする人の前月の報酬（日給・時給の人の資格取得時決定。設計書 2.11） */
export type SimilarRemuneration = {
  /** 選んだ人ごとの、前月に支払った報酬（固定的賃金＋非固定的賃金−遡及差額。給与がなければ null） */
  people: { employeeId: string; total: number | null }[];
  /** 給与がある人の平均（円未満切り捨て。1人もいなければ null） */
  average: number | null;
};

/**
 * 日給・時給の人は、同じ事業所で同じような仕事をする人の前月の報酬の平均を報酬月額にする
 * @param month 前月（資格取得月の前月）'YYYY-MM'
 */
export function similarRemuneration(
  salaries: { employeeId: string; paidDate: string; fixedWages: number; nonFixedWages: number; retroactiveDiff: number | null }[],
  employeeIds: string[],
  month: string,
): SimilarRemuneration {
  const people = employeeIds.map((id) => {
    const list = salaries.filter((s) => s.employeeId === id && s.paidDate.startsWith(month));
    return { employeeId: id, total: list.length ? list.reduce((t, s) => t + s.fixedWages + s.nonFixedWages - (s.retroactiveDiff ?? 0), 0) : null };
  });
  const totals = people.map((p) => p.total).filter((t): t is number => t !== null);
  return { people, average: totals.length ? Math.floor(totals.reduce((a, b) => a + b, 0) / totals.length) : null };
}
