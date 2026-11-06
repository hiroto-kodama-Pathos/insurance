// 届出の期限の通知（設計書 2.25・3.12）
// 届出の要否と期限は、登録した内容から表示のたびに求める。担当者が「届出済み」にした記録だけを保存する（filings）。
// 月額変更届は、随時改定の候補の状態（届出済み）で管理するため、ここでは候補から一覧に並べるだけにする。
import { birthdayAt } from './age';
import { age70Notice, Age70Employee } from './age70';
import { bonusTarget } from './bonus-premium';
import { Dependent, dependentOut } from './dependent';
import { Exemption, Leave, Qualification } from './eligibility';
import { exemptionNotice } from './exemption';
import { GradeRow } from './grade-suggest';
import { Assignment } from './office';
import { CandidateStatus } from './revision';
import { SalaryRecord } from './salary';
import { dateLabel, yearMonthLabel } from './year-month';

export type FilingKind =
  | 'acquisition'
  | 'loss'
  | 'dependent'
  | 'bonus'
  | 'age70'
  | 'revision'
  | 'regular'
  | 'leave'
  | 'exemption';

export const FILING_KIND_LABEL: Record<FilingKind, string> = {
  acquisition: '資格取得届',
  loss: '資格喪失届',
  dependent: '被扶養者異動届',
  bonus: '賞与支払届',
  age70: '70歳到達届',
  revision: '月額変更届',
  regular: '算定基礎届',
  leave: '休業の取得者申出書',
  exemption: '適用除外の届出',
};

export type Filing = {
  /** 見分けるID（従業員ID_届出の種類_きっかけ）。filings のドキュメントIDにも使う */
  id: string;
  kind: FilingKind;
  /** 届出の名前（同じ種類でも内容で変わるもの：休業の申出書・適用除外など） */
  name: string;
  /** 従業員（算定基礎届は事業所ごとなので null） */
  employeeId: string | null;
  officeId: string | null;
  /** きっかけ（資格取得日・支給日など）。並べ替えにも使う */
  trigger: string;
  /** きっかけの説明（「資格取得日 2026-10-01」など） */
  triggerLabel: string;
  /** 期限の日（「速やかに」などで日がなければ null） */
  deadline: string | null;
  deadlineLabel: string;
  /** 月額変更届だけ：随時改定の候補の状態 */
  candidateStatus?: CandidateStatus;
};

export type FilingEmployee = Age70Employee & {
  qualifications: Qualification[];
  assignments: Assignment[];
  dependents?: Dependent[];
  leaves: Leave[];
  exemptions: Exemption[];
};

/** 休業終了時改定の月額変更届の名前（産休が終わったときと育休が終わったときで届書が違う） */
export function leaveEndFormName(leaveType: Leave['type'] | undefined): string {
  return leaveType === 'maternity' ? '産前産後休業終了時報酬月額変更届' : '育児休業等終了時報酬月額変更届';
}

export type FilingCandidate = {
  id: string;
  employeeId: string;
  type: 'revision' | 'leaveEnd';
  /** 休業終了時改定だけ：終わった休業の種類 */
  leaveType?: Leave['type'];
  changeMonth: string;
  expectedFrom: string;
  status: CandidateStatus;
};

/** n日後（マイナスなら前）の日 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** これより前のきっかけは一覧に出さない（アプリを使い始める前の届出がたまらないように） */
export const FILING_LOOKBACK_DAYS = 180;

const officeOn = (as: Assignment[], date: string) =>
  [...as].filter((a) => a.validFrom <= date).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.officeId ?? null;

function within5(date: string): { deadline: string; deadlineLabel: string } {
  const d = addDays(date, 5);
  return { deadline: d, deadlineLabel: `${dateLabel(d)}（5日以内）` };
}

/** 届出のID（届出済み・対応不要の記録 filings のドキュメントIDにも使う） */
export function filingId(ownerId: string, kind: FilingKind, trigger: string): string {
  return `${ownerId}_${kind}_${trigger}`;
}

/** 被扶養者が扶養に入った届出のきっかけ（扶養に入った日と氏名） */
function dependentInTrigger(certifiedDate: string, name: string): string {
  return `${certifiedDate}_in_${name}`;
}

/**
 * 導入時の登録で、すでに届け出ているはずの届出（資格取得届・扶養に入った被扶養者異動届）。
 * 導入前に届け出たものなので「対応不要」として記録し、期限切れの届出として出さない（設計書 3.1）
 */
export function onboardingFilings(
  employeeId: string,
  acquiredDate: string,
  officeId: string,
  dependents: { name: string; certifiedDate: string }[],
): { id: string; employeeId: string; kind: FilingKind; trigger: string; officeId: string }[] {
  return [
    { id: filingId(employeeId, 'acquisition', acquiredDate), employeeId, kind: 'acquisition' as const, trigger: acquiredDate, officeId },
    ...dependents.map((d) => {
      const trigger = dependentInTrigger(d.certifiedDate, d.name);
      return { id: filingId(employeeId, 'dependent', trigger), employeeId, kind: 'dependent' as const, trigger, officeId };
    }),
  ];
}

/**
 * 届け出るものの一覧（届出済みかどうかは filings と突き合わせて決める）
 *
 * @param today 今日（きっかけが FILING_LOOKBACK_DAYS 日より前のものは出さない）
 * @param startDate このアプリの利用開始日。期限がこの日より前の届出は、導入前に届け出たものとして出さない
 *   （期限のない月額変更届の見込みと、期限が利用開始日以後の届出は出す。導入の時点でまだ届け出ていないことがあるため）
 */
export function findFilings(
  employees: FilingEmployee[],
  bonuses: { employeeId: string; paidDate: string; isRemuneration?: boolean }[],
  salaries: SalaryRecord[],
  grades: GradeRow[],
  candidates: FilingCandidate[],
  offices: { id: string }[],
  today: string,
  startDate: string | null = null,
): Filing[] {
  const from = addDays(today, -FILING_LOOKBACK_DAYS);
  const list: Filing[] = [];
  const push = (f: Omit<Filing, 'id'>) => {
    if (f.trigger.slice(0, 10) < from) return;
    if (startDate && f.deadline !== null && f.deadline < startDate) return;
    list.push({ ...f, id: filingId(`${f.employeeId ?? f.officeId}`, f.kind, f.trigger) });
  };

  for (const e of employees) {
    for (const q of e.qualifications) {
      push({
        kind: 'acquisition', name: FILING_KIND_LABEL.acquisition, employeeId: e.id, officeId: officeOn(e.assignments, q.acquiredDate),
        trigger: q.acquiredDate, triggerLabel: `資格取得日 ${dateLabel(q.acquiredDate)}`, ...within5(q.acquiredDate),
      });
      if (q.lostDate)
        push({
          kind: 'loss', name: FILING_KIND_LABEL.loss, employeeId: e.id, officeId: officeOn(e.assignments, addDays(q.lostDate, -1)),
          trigger: q.lostDate, triggerLabel: `資格喪失日 ${dateLabel(q.lostDate)}`, ...within5(q.lostDate),
        });
    }
    // 75歳到達（誕生日に後期高齢者医療へ移り、健康保険の資格を失う）。喪失日を登録していなくても出す
    if (e.birthDate) {
      const b75 = birthdayAt(e.birthDate, 75);
      const q = e.qualifications.find((x) => x.acquiredDate <= b75 && (x.lostDate === null || x.lostDate > b75));
      if (q && b75 <= addDays(today, 31))
        push({
          kind: 'loss', name: '資格喪失届（75歳到達）', employeeId: e.id, officeId: officeOn(e.assignments, b75),
          trigger: b75, triggerLabel: `75歳の誕生日 ${dateLabel(b75)}`, ...within5(b75),
        });
    }
    for (const d of e.dependents ?? []) {
      push({
        kind: 'dependent', name: `${FILING_KIND_LABEL.dependent}（${d.name}・扶養に入った）`, employeeId: e.id,
        officeId: officeOn(e.assignments, d.certifiedDate), trigger: dependentInTrigger(d.certifiedDate, d.name),
        triggerLabel: `認定日 ${dateLabel(d.certifiedDate)}`, ...within5(d.certifiedDate),
      });
      // 外れた日を登録した人と、75歳の誕生日を迎える人（外れた日を登録していなくても、誕生日に後期高齢者医療へ移り扶養から外れる）
      const out = dependentOut(d);
      if (out && (out.reason === 'removed' || out.date <= addDays(today, 31)))
        push({
          kind: 'dependent',
          name: `${FILING_KIND_LABEL.dependent}（${d.name}・${out.reason === 'age75' ? '75歳到達で扶養から外れた' : '扶養から外れた'}）`,
          employeeId: e.id, officeId: officeOn(e.assignments, out.date), trigger: `${out.date}_out_${d.name}`,
          triggerLabel: `${out.reason === 'age75' ? '75歳の誕生日' : '外れた日'} ${dateLabel(out.date)}`, ...within5(out.date),
        });
    }
    // 70歳到達届（不要と判定した人は出さない）
    const n70 = age70Notice(e, salaries, grades);
    if (n70 && n70.status !== 'notRequired' && n70.reachedDate <= addDays(today, 31))
      push({
        kind: 'age70', name: n70.status === 'unknown' ? '70歳到達届（要否を確かめる）' : FILING_KIND_LABEL.age70, employeeId: e.id,
        officeId: officeOn(e.assignments, n70.reachedDate), trigger: n70.reachedDate, triggerLabel: `70歳到達日 ${dateLabel(n70.reachedDate)}`,
        deadline: n70.deadline, deadlineLabel: `${dateLabel(n70.deadline)}（5日以内）`,
      });
    for (const l of e.leaves) {
      push({
        kind: 'leave', name: l.type === 'maternity' ? '産前産後休業取得者申出書' : '育児休業等取得者申出書', employeeId: e.id,
        officeId: officeOn(e.assignments, l.startDate), trigger: l.startDate, triggerLabel: `休業開始日 ${dateLabel(l.startDate)}`,
        deadline: l.endDate, deadlineLabel: l.endDate ? `休業の期間中（${dateLabel(l.endDate)}まで）・速やかに` : '休業の期間中・速やかに',
      });
    }
    for (const x of e.exemptions) {
      const n = exemptionNotice(x.type, x.startDate);
      const date = n.deadlineDate;
      push({
        kind: 'exemption', name: n.name, employeeId: e.id, officeId: officeOn(e.assignments, x.startDate),
        trigger: `${x.startDate}_${x.type}`, triggerLabel: `該当年月日 ${dateLabel(x.startDate)}`, deadline: date, deadlineLabel: n.deadline,
      });
    }
  }

  // 賞与支払届（保険料のかからない賞与も含む。資格のない日の支給は除く）
  const seen = new Set<string>();
  for (const b of bonuses) {
    const e = employees.find((x) => x.id === b.employeeId);
    // 報酬扱いの賞与（年4回以上支給）は賞与支払届の対象外
    if (!e || b.isRemuneration || bonusTarget(e.qualifications, b.paidDate) === 'outside') continue;
    const key = `${b.employeeId}_${b.paidDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push({
      kind: 'bonus', name: FILING_KIND_LABEL.bonus, employeeId: b.employeeId, officeId: officeOn(e.assignments, b.paidDate),
      trigger: b.paidDate, triggerLabel: `支給日 ${dateLabel(b.paidDate)}`, ...within5(b.paidDate),
    });
  }

  // 月額変更届（随時改定の候補。休業終了時改定は本人の申出があったときだけなので、届出済みにした候補だけ並べる）
  for (const c of candidates) {
    if (c.status === 'dismissed') continue;
    if (c.type === 'leaveEnd' && c.status !== 'filed') continue;
    const e = employees.find((x) => x.id === c.employeeId);
    push({
      kind: 'revision', name: c.type === 'leaveEnd' ? leaveEndFormName(c.leaveType) : FILING_KIND_LABEL.revision, employeeId: c.employeeId,
      officeId: e ? officeOn(e.assignments, `${c.changeMonth}-01`) : null, trigger: `${c.changeMonth}-01`,
      triggerLabel: `変動月 ${yearMonthLabel(c.changeMonth)}（${yearMonthLabel(c.expectedFrom)}分から改定の見込み）`, deadline: null, deadlineLabel: '速やかに',
      candidateStatus: c.status,
    });
  }

  // 算定基礎届（7月1日に資格がある人がいる適用事業所ごと。6月から出す）
  const year = Number(today.slice(0, 4));
  for (const y of [year - 1, year]) {
    const july1 = `${y}-07-01`;
    if (addDays(today, 31) < `${y}-06-01`) continue;
    for (const o of offices) {
      const any = employees.some(
        (e) => officeOn(e.assignments, july1) === o.id && e.qualifications.some((q) => q.acquiredDate <= july1 && (q.lostDate === null || q.lostDate > july1)),
      );
      if (!any) continue;
      push({
        kind: 'regular', name: `${FILING_KIND_LABEL.regular}（${y}年）`, employeeId: null, officeId: o.id,
        trigger: july1, triggerLabel: `${y}年7月1日に資格がある人`, deadline: `${y}-07-10`, deadlineLabel: `${y}年7月1日〜7月10日`,
      });
    }
  }

  return list.sort((a, b) => (a.deadline ?? a.trigger).localeCompare(b.deadline ?? b.trigger));
}

export type FilingState = 'overdue' | 'soon' | 'open' | 'filed';

/** 期限が過ぎた・3日以内のものを強調する */
export const SOON_DAYS = 3;

/** 届出の状態。月額変更届は候補の状態、それ以外は filings の記録で決める */
export function filingState(f: Filing, filedIds: Set<string>, today: string): FilingState {
  const filed = f.kind === 'revision' ? f.candidateStatus === 'filed' || f.candidateStatus === 'registered' : filedIds.has(f.id);
  if (filed) return 'filed';
  if (f.deadline && f.deadline < today) return 'overdue';
  if (f.deadline && f.deadline <= addDays(today, SOON_DAYS)) return 'soon';
  return 'open';
}

/** トップに出す件数：未対応のうち、期限が7日以内・過ぎたもの・期限の日がないもの */
export function urgentFilings(list: Filing[], filedIds: Set<string>, today: string): Filing[] {
  const limit = addDays(today, 7);
  return list.filter((f) => filingState(f, filedIds, today) !== 'filed' && (f.deadline === null || f.deadline <= limit));
}
