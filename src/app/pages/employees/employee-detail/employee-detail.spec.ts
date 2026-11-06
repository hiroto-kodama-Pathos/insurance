import { ClosingRepository } from '../../../core/repository/closing-repository';
import { FilingRepository } from '../../../core/repository/filing-repository';
import { signal } from '@angular/core';
import { Auth } from '../../../core/auth/auth';
import { MaintenanceRepository } from '../../../core/repository/maintenance-repository';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Masters } from '../../../core/calc/employee-month';
import { buildKyokaiGrades } from '../../../core/calc/grade-suggest';
import { EmployeeNumberTakenError, EmployeeDetail as Detail, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { Confirm } from '../../../core/ui/confirm';
import { EmployeeDetail } from './employee-detail';
import { NavigationHistory } from '../../../core/ui/navigation-history';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
  ],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [],
  pensionRates: [],
};

function yamada(): Detail {
  return {
    id: 'e1',
    employeeNumber: '0001',
    name: '山田 太郎',
    birthDate: '1980-05-10',
    qualifications: [
      { id: 'q1', acquiredDate: '2024-04-01', lostDate: null, lostReason: null },
      // 以前の入社で、同じ月に退職した（同月得喪）
      { id: 'q0', acquiredDate: '2023-06-05', lostDate: '2023-06-21', lostReason: 'retirement' },
    ],
    leaves: [{ id: 'l1', type: 'maternity', startDate: '2022-01-01', endDate: '2022-03-31', workedDays: null }],
    exemptions: [],
    assignments: [{ id: 'a1', validFrom: '2020-04-01', officeId: 'honsha' }],
    standardHistory: [
      { id: 's1', validFrom: '2024-04', reason: 'acquisition', healthStandard: 300_000, pensionStandard: 300_000, remuneration: null },
      { id: 's2', validFrom: '2027-03', reason: 'revision', healthStandard: 300_000, pensionStandard: 300_000, remuneration: 300_000, provisional: true },
    ],
    insuredTypes: [{ id: 't1', validFrom: '2024-04-01', type: 'general' }],
    payrollAssignments: [],
    absences: [{ id: 'ab1', reason: 'sickness', startDate: '2023-01-10', endDate: '2023-02-28' }],
    eligibility: {
      employmentType: 'regular', weeklyHours: 40, monthlyDays: 20, contractEnd: '', renewalExpected: false, isStudent: false,
      candidate: 'general', reasons: ['週40時間・月20日で、通常の労働者（週40時間・月20日）の4分の3以上'],
    },
    dependents: [{ id: 'd1', name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2024-04-01', removedDate: null }],
  };
}

describe('EmployeeDetail', () => {
  let fixture: ComponentFixture<EmployeeDetail>;
  let calls: unknown[][];
  let logs: string[];
  /** 変更の記録を残せない・読み込めない（記録の失敗を画面に出すか） */
  let logWriteFails: boolean;
  /** 確定済みの月（事業所ID → 月） */
  let closedMonths: Record<string, string[]>;
  /** 確定済みの月・ほかの従業員を読めない（読み込みに失敗したときの動きを確かめる） */
  let closedFail = false;
  let loadAllFail = false;
  let logLoadFails: boolean;
  /** yamada() の一部を差し替えて読み込ませる（reload() で画面を作り直す） */
  let detailOverride: Record<string, unknown> = {};

  beforeEach(async () => {
    calls = [];
    logs = [];
    logWriteFails = false;
    closedMonths = {};
    closedFail = false;
    loadAllFail = false;
    logLoadFails = false;
    detailOverride = {};
    const record = (name: string) => async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
    await TestBed.configureTestingModule({
      imports: [EmployeeDetail],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'admin', siScope: 'all' }), isAdmin: signal(true) } },
        { provide: MaintenanceRepository, useValue: { deleteMistakenEmployee: record('deleteMistakenEmployee') } },
        {
          provide: FilingRepository,
          useValue: { loadFiledIds: async () => new Set<string>(), setFiled: record('setFiled'), unsetFiled: record('unsetFiled') },
        },
        // 削除の影響に使う、確定済みの月（事業所ごと）
        {
          provide: ClosingRepository,
          useValue: {
            closedMonthsOf: async (officeId: string) => {
              if (closedFail) throw new Error('unavailable');
              return closedMonths[officeId] ?? [];
            },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadDetail: async () => ({ ...yamada(), ...detailOverride }),
            loadAll: async () => {
              if (loadAllFail) throw new Error('unavailable');
              return [
              { id: 'e1', employeeNumber: '0001' },
              { id: 'e2', employeeNumber: '0002' },
            ];
            },
            // 担当外の事業所の人が使っている番号（画面の一覧には出ない）は、保存のときに止まる
            updateEmployeeNumber: async (...args: unknown[]) => {
              if (args[1] === '0099') throw new EmployeeNumberTakenError(['0099']);
              await record('updateEmployeeNumber')(...args);
            },
            closeQualification: record('closeQualification'),
            addQualification: record('addQualification'),
            addTransfer: record('addTransfer'),
            addStandard: record('addStandard'),
            confirmStandard: record('confirmStandard'),
            addLeave: record('addLeave'),
            updateLeave: record('updateLeave'),
            addInsuredType: record('addInsuredType'),
            addPayrollAssignment: record('addPayrollAssignment'),
            addExemption: record('addExemption'),
            addDependent: record('addDependent'),
            removeDependent: record('removeDependent'),
            updateName: record('updateName'),
            setDependentCareExemptions: record('setDependentCareExemptions'),
            updateExemption: record('updateExemption'),
            deleteExemption: record('deleteExemption'),
            deleteAbsence: record('deleteAbsence'),
            updateEligibility: record('updateEligibility'),
            setRefundStatus: record('setRefundStatus'),
            addAbsence: record('addAbsence'),
            updateAbsence: record('updateAbsence'),
            updateBirthDate: record('updateBirthDate'),
            addChangeLog: async (_id: string, text: string) => {
              logs.push(text);
            },
            // 本物は、変更と記録を同じ書き込みで残す。記録を残せなかったら false
            withLog: async (_id: string, text: string, action: () => Promise<unknown>) => {
              await action();
              if (logWriteFails) return false;
              logs.push(text);
              return true;
            },
            loadChangeLogs: async () => {
              if (logLoadFails) throw new Error('unavailable');
              return [{ id: 'g1', at: new Date(2026, 10, 5, 9, 3), by: 'tanto@example.com', text: '新規登録（資格取得日 2024年4月1日）' }];
            },
            updateQualification: record('updateQualification'),
            deleteQualification: record('deleteQualification'),
            updateStandard: record('updateStandard'),
            deleteStandard: record('deleteStandard'),
            updateDependent: record('updateDependent'),
            deleteDependent: record('deleteDependent'),
            updateAssignment: record('updateAssignment'),
            deleteAssignment: record('deleteAssignment'),
            updateInsuredType: record('updateInsuredType'),
            deleteInsuredType: record('deleteInsuredType'),
            updatePayrollAssignment: record('updatePayrollAssignment'),
            deletePayrollAssignment: record('deletePayrollAssignment'),
            deleteLeave: record('deleteLeave'),
          },
        },
        {
          provide: SettingsRepository,
          useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [
            { id: 'monthly', name: '月給者', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: true },
            { id: 'part', name: 'パート', cutoffDay: 15, paidIn: 'sameMonth', deductionTiming: 'sameMonth', payDay: 25 },
          ] },
        },
        {
          provide: MasterRepository,
          useValue: { loadMasters: async () => masters, loadGrades: async () => buildKyokaiGrades('2020-09'), loadEligibilityRules: async () => [{ validFrom: '2016-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: null, contractMonths: 2, studentExcluded: true }] },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EmployeeDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const input = (selector: string, value: string) => {
    const i = el().querySelector(selector) as HTMLInputElement;
    i.value = value;
    i.dispatchEvent(new Event('input'));
  };
  async function reload() {
    fixture = TestBed.createComponent(EmployeeDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function submit() {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  type Unsaved = { unsavedCount(): number };
  const unsaved = () => (fixture.componentInstance as unknown as Unsaved).unsavedCount();

  it('開いたフォームで入力を変えたまま画面を移ろうとしたら確かめる。「やめる」・別のフォームを開くときも、破棄してよいかを確かめる', async () => {
    const c = fixture.componentInstance as unknown as {
      open(m: string): void | Promise<void>; cancel(): void | Promise<void>; nameForm: { set(v: string): void }; mode(): unknown;
    };
    const ask = vi.spyOn(TestBed.inject(Confirm), 'ask');
    expect(unsaved()).toBe(0);
    c.open('name');
    await fixture.whenStable();
    expect(unsaved()).toBe(0); // 今の氏名が入っているだけ
    // 変えていなければ、確かめずに閉じる
    c.cancel();
    expect(c.mode()).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    c.open('name');
    await fixture.whenStable();
    c.nameForm.set('山田 花子');
    expect(unsaved()).toBe(1);
    // 「やめる」：「キャンセル」なら閉じずに入力を残す
    ask.mockResolvedValueOnce(false);
    await c.cancel();
    expect(c.mode()).toBe('name');
    expect(unsaved()).toBe(1);
    // 別のフォームを開こうとしても確かめる。「破棄して閉じる」なら開く
    ask.mockResolvedValueOnce(true);
    await c.open('leave');
    expect(ask.mock.calls.at(-1)?.[0].ok).toBe('破棄して閉じる');
    expect(c.mode()).toBe('leave');
    await fixture.whenStable();
    expect(unsaved()).toBe(0);
  });

  it('同月得喪の資格の期間に、還付の状態（初めは還付待ち）を出し、変えられる', async () => {
    const table = el().querySelector('table.same-month')!;
    expect(table.textContent).toContain('2023年6月');
    const select = table.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('pending');
    select.value = 'returned';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(calls).toContainEqual(['setRefundStatus', 'e1', 'q0', 'returned']);
  });

  it('休職を追加する（ほかの休職と重なる期間はエラー）', async () => {
    expect(el().querySelector('table.absences')!.textContent).toContain('私傷病');
    button('休職を追加').click();
    fixture.detectChanges();
    const start = el().querySelector('input[name=absenceStart]') as HTMLInputElement;
    start.value = '2023-02-01';
    start.dispatchEvent(new Event('input'));
    await submit();
    expect(el().textContent).toContain('ほかの休職の期間と重なっています');
    start.value = '2026-10-01';
    start.dispatchEvent(new Event('input'));
    await submit();
    expect(calls).toContainEqual(['addAbsence', 'e1', { reason: 'sickness', startDate: '2026-10-01', endDate: '' }]);
  });

  it('操作ボタンは欄ごとにまとめ、入力フォームはその欄の中に開く', () => {
    expect(el().querySelector('#card-family .actions')!.textContent).toContain('被扶養者を追加');
    expect(el().querySelector('#card-standard .actions')!.textContent).toContain('標準報酬月額を追加');
    button('被扶養者を追加').click();
    fixture.detectChanges();
    expect(el().querySelector('#card-family form')).not.toBeNull();
    expect(el().querySelector('#card-qual form')).toBeNull();
    button('休業を追加').click();
    fixture.detectChanges();
    expect(el().querySelector('#card-leave form')).not.toBeNull();
    expect(el().querySelectorAll('form').length).toBe(1);
  });

  it('管理者は、確認してから誤登録として削除できる', async () => {
    const confirm = TestBed.inject(Confirm);
    button('誤登録として削除').click();
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(confirm.current()!.message).toContain('0001 山田 太郎さんを、給与・賞与などと一緒に削除します');
    confirm.answer(true);
    await fixture.whenStable();
    expect(calls).toContainEqual(['deleteMistakenEmployee', 'e1']);
  });

  it('休業の取得者申出書を「届出済みにする」と、届出の記録を作る', async () => {
    const row = el().querySelector('tr.leave-row')!;
    expect(row.textContent).toContain('申出待ち');
    button('届出済みにする').click();
    await fixture.whenStable();
    expect(calls).toContainEqual(['setFiled', { id: 'e1_leave_2022-01-01', employeeId: 'e1', kind: 'leave', trigger: '2022-01-01', officeId: 'honsha' }, 'u1']);
  });

  it('基本情報と履歴を表示する', () => {
    expect(el().querySelector('h1')?.textContent).toContain('山田 太郎');
    expect(el().textContent).toContain('加入中');
    expect(el().textContent).toContain('資格取得時決定');
    expect(el().textContent).toContain('30万円');
    expect(el().textContent).toContain('直近12か月の保険料');
  });

  it('退職日を入れると、資格喪失日を翌日にして保存する', async () => {
    button('退職を登録').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-10-31');
    await submit();
    // 扶養中の被扶養者（d1）も、資格喪失日に扶養から外れる
    expect(calls).toEqual([['closeQualification', 'e1', 'q1', '2026-11-01', 'retirement', ['d1']]]);
    expect(el().textContent).toContain('被扶養者1人も同じ日に扶養から外れます。');
    expect(el().textContent).toContain('資格喪失日 2026年11月1日');
  });

  it('退職日を入れると、退職月の保険料と最終給与で控除する月数を表示する', () => {
    button('退職を登録').click();
    fixture.detectChanges();
    input('form input[type=date]', '2026-10-31');
    fixture.detectChanges();
    const t = el().querySelector('.retire-preview')!.textContent!;
    expect(t).toContain('資格喪失日：2026年11月1日');
    expect(t).toContain('退職月（2026年10月）の保険料もかかります');
    // 既定の区分（翌月控除・翌月払い）なので、最終給与は11月支給で10月分の1か月分
    expect(t).toContain('最終給与（2026年11月支給）で、2026年10月分を控除します');
    input('form input[type=date]', '2026-10-20');
    fixture.detectChanges();
    expect(el().querySelector('.retire-preview')!.textContent).toContain('退職月の保険料はかかりません（2026年9月分まで）');
  });

  it('退職日が空ならエラーを出して保存しない', async () => {
    button('退職を登録').click();
    fixture.detectChanges();
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('退職日を正しく入力してください');
  });

  it('異動は、今の標準報酬月額を初期値にして保存する', async () => {
    button('異動を登録').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-11-01');
    const select = el().querySelector('select') as HTMLSelectElement;
    select.value = 'osaka';
    select.dispatchEvent(new Event('change'));
    await submit();
    expect(calls).toEqual([
      ['addTransfer', 'e1', '2026-11-01', 'osaka', { healthStandard: 300_000, pensionStandard: 300_000 }],
    ]);
  });

  it('報酬月額から標準報酬月額の提案を入れる', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2026-09');
    input('input[inputmode=numeric]', '700000');
    button('提案を入力').click();
    fixture.detectChanges();
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ validFrom: '2026-09', healthStandard: 710_000, pensionStandard: 650_000 });
    expect(calls[0][3]).toBe(700_000);
  });

  it('資格取得時決定では、報酬月額の内訳を入れると合計を報酬月額にして内訳も保存する', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2026-09');
    const reason = [...el().querySelectorAll('select')].find((x) => x.querySelector('option[value=acquisition]')) as HTMLSelectElement;
    reason.value = 'acquisition';
    reason.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    input('input[name=breakdown-basic]', '250,000');
    input('input[name=breakdown-allowances]', '20000');
    input('input[name=breakdown-commuting]', '15000');
    input('input[name=breakdown-overtime]', '20000');
    fixture.detectChanges();
    expect(el().querySelector('fieldset.breakdown .total')!.textContent).toContain('305,000円');
    button('提案を入力').click();
    fixture.detectChanges();
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ reason: 'acquisition', healthStandard: 300_000, pensionStandard: 300_000 });
    expect(calls[0][3]).toBe(305_000);
    expect(calls[0][4]).toEqual({ basic: 250_000, allowances: 20_000, commuting: 15_000, overtime: 20_000 });
  });

  it('通知書待ちの履歴に印を付け、「通知書の値で確定」で通知書の値に直す', async () => {
    expect(el().textContent).toContain('通知書待ち');
    button('通知書の値で確定').click();
    fixture.detectChanges();
    expect(el().querySelector('form')!.textContent).toContain('2027年3月分から');
    input('input[name=confirmHealth]', '380,000');
    input('input[name=confirmPension]', '380000');
    await submit();
    expect(calls).toEqual([['confirmStandard', 'e1', 's2', 380_000, 380_000]]);
  });

  it('標準報酬月額の追加で「通知書待ち」にすると、通知書待ちとして登録する', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2027-01');
    const c = el().querySelector('input[name=provisional]') as HTMLInputElement;
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ validFrom: '2027-01', provisional: true });
  });

  it('休業を追加する', async () => {
    button('休業を追加').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-12-01');
    await submit();
    expect(calls).toEqual([
      ['addLeave', 'e1', { type: 'childcare', startDate: '2026-12-01', endDate: '', workedDays: null }],
    ]);
  });

  it('被保険者区分を変える（今と同じ区分は登録しない）', async () => {
    expect(fixture.nativeElement.querySelector('.page-header').textContent).toContain('一般被保険者');
    button('被保険者区分を変える').click();
    fixture.detectChanges();
    input('input[name=insuredTypeDate]', '2026-11-01');
    await submit();
    expect(calls).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('この日の区分と同じです');
    const select = fixture.nativeElement.querySelector('select[name=insuredType]') as HTMLSelectElement;
    select.value = 'shortTime';
    select.dispatchEvent(new Event('change'));
    await submit();
    expect(calls).toEqual([['addInsuredType', 'e1', { validFrom: '2026-11-01', type: 'shortTime' }]]);
  });

  it('入社時の加入対象の判定（入力と示した候補・理由）を出す', () => {
    const t = fixture.nativeElement.querySelector('.eligibility').textContent;
    expect(t).toContain('正社員・週40時間・月20日');
    expect(t).toContain('示した候補：一般の被保険者');
    expect(t).toContain('4分の3以上');
  });

  it('給与の支払区分を変える（今と同じ区分は登録しない）', async () => {
    expect(fixture.nativeElement.querySelector('.page-header').textContent).toContain('月給者');
    expect(fixture.nativeElement.querySelector('.payroll-assignments').textContent).toContain('「月給者」として扱います');
    button('支払区分を変える').click();
    fixture.detectChanges();
    input('input[name=payrollDate]', '2026-11-01');
    await submit();
    expect(calls).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('この日の支払区分と同じです');
    const select = fixture.nativeElement.querySelector('select[name=payrollGroup]') as HTMLSelectElement;
    select.value = 'part';
    select.dispatchEvent(new Event('change'));
    await submit();
    expect(calls).toEqual([['addPayrollAssignment', 'e1', { validFrom: '2026-11-01', payrollGroupId: 'part' }]]);
  });

  it('適用除外を追加する（届け出ることと期限を出す）', async () => {
    button('適用除外を追加').click();
    fixture.detectChanges();
    input('input[name=exemptionStart]', '2026-11-02');
    await submit();
    expect(calls).toEqual([['addExemption', 'e1', { type: 'care', startDate: '2026-11-02', endDate: '' }]]);
    expect(fixture.nativeElement.textContent).toContain('介護保険適用除外等該当・非該当届：遅滞なく');
  });

  it('前の画面が分からないときは「← 従業員一覧へ戻る」だけ。月次保険料一覧から開いたら、そこへ戻るリンクを出す', async () => {
    const links = () => [...el().querySelectorAll('.back-links a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links()).toEqual([['← 従業員一覧へ戻る', '/employees']]);
    const history = TestBed.inject(NavigationHistory);
    history.record('/monthly?month=2026-10');
    history.record('/employees/e1');
    await reload();
    expect(links()).toEqual([
      ['← 月次保険料一覧へ戻る', '/monthly?month=2026-10'],
      ['従業員一覧へ', '/employees'],
    ]);
    // 従業員一覧から開いたときは、同じリンクを2つ出さない
    history.record('/employees');
    history.record('/employees/e1');
    await reload();
    expect(links()).toEqual([['← 従業員一覧へ戻る', '/employees']]);
  });

  it('表は横にスクロールできる枠に入れる（狭い画面で、ページ全体が横にはみ出さないように）', () => {
    const tables = [...el().querySelectorAll('table.list')];
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((t) => t.parentElement!.classList.contains('table-wrap'))).toBe(true);
  });

  it('社員番号を変更する（ほかの人と同じ番号・今と同じ番号は保存しない。全角は半角にそろえる）', async () => {
    button('社員番号を変更').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((el().querySelector('input[name=newEmployeeNumber]') as HTMLInputElement).value).toBe('0001');
    input('input[name=newEmployeeNumber]', '0002');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('この社員番号はほかの従業員が使っています');
    // 画面の一覧にはないが、保存のときに使われていると分かった番号
    input('input[name=newEmployeeNumber]', '0099');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('この社員番号はほかの従業員が使っています（ほかの担当者が先に登録したか、担当外の事業所の人が使っています）');
    input('input[name=newEmployeeNumber]', 'Ａ－００１');
    await submit();
    expect(calls).toEqual([['updateEmployeeNumber', 'e1', 'A-001', '0001']]);
    expect(el().textContent).toContain('社員番号を「0001」から「A-001」に変えました。');
  });

  it('氏名を変更する（今と同じ・空欄は保存しない。届出の要否を知らせる）', async () => {
    button('氏名を変更').click();
    fixture.detectChanges();
    expect((el().querySelector('input[name=newName]') as HTMLInputElement).value).toBe('山田 太郎');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('今の氏名と同じです');
    input('input[name=newName]', '　');
    await submit();
    expect(el().textContent).toContain('氏名を入力してください');
    input('input[name=newName]', ' 佐藤 太郎 ');
    await submit();
    expect(calls).toEqual([['updateName', 'e1', '佐藤 太郎']]);
    expect(el().textContent).toContain('氏名を「山田 太郎」から「佐藤 太郎」に変えました。');
    expect(el().textContent).toContain('被保険者氏名変更（訂正）届');
  });

  it('被扶養者を追加し、扶養から外す（被扶養者異動届の期限を出す）', async () => {
    button('被扶養者を追加').click();
    fixture.detectChanges();
    input('input[name=dependentName]', '山田 一郎');
    input('input[name=dependentBirth]', '2026-10-01');
    input('input[name=dependentCertified]', '2026-10-01');
    await submit();
    expect(calls).toEqual([['addDependent', 'e1', { name: '山田 一郎', birthDate: '2026-10-01', certifiedDate: '2026-10-01' }]]);
    expect(fixture.nativeElement.textContent).toContain('被扶養者異動届：2026年10月6日まで（5日以内）');
    calls.length = 0;
    button('扶養から外す').click();
    fixture.detectChanges();
    input('input[name=dependentRemoved]', '2026-11-01');
    await submit();
    expect(calls).toEqual([['removeDependent', 'e1', 'd1', '2026-11-01']]);
  });

  it('同じ人の二重登録・本人を被扶養者にする・本人の資格がない日の被扶養者は登録しない', async () => {
    button('被扶養者を追加').click();
    fixture.detectChanges();
    input('input[name=dependentName]', '山田花子');
    input('input[name=dependentBirth]', '1982-03-03');
    input('input[name=dependentCertified]', '2025-04-01');
    await submit();
    expect(el().textContent).toContain('すでに被扶養者として登録されています');
    input('input[name=dependentName]', '山田 太郎');
    input('input[name=dependentBirth]', '1980-05-10');
    await submit();
    expect(el().textContent).toContain('本人を被扶養者にはできません');
    input('input[name=dependentName]', '山田 一郎');
    input('input[name=dependentBirth]', '2010-01-01');
    input('input[name=dependentCertified]', '2022-04-01');
    await submit();
    expect(el().textContent).toContain('扶養に入った日に、本人の社会保険の資格がありません');
    expect(calls).toEqual([]);
  });

  it('壊れた被扶養者のデータは、計算に使っていないことを出し、削除できる', async () => {
    detailOverride = { brokenDependents: [{ id: 'bad1', text: '氏名：a・生年月日：（なし）・扶養に入った日：2024-04-01・外れた日：（なし）' }] };
    await reload();
    const box = el().querySelector('#card-family .broken-leave')!;
    expect(box.textContent).toContain('壊れた被扶養者のデータがあります（計算に使っていません）');
    (box.querySelector('button') as HTMLButtonElement).click();
    await answer(true);
    expect(calls).toContainEqual(['deleteDependent', 'e1', 'bad1']);
  });

  it('被扶養者の介護保険の適用除外を登録し、あとから非該当年月日を入れる', async () => {
    button('介護保険の適用除外を追加').click();
    fixture.detectChanges();
    input('input[name=depExemptionStart]', '2026-10-02');
    await submit();
    expect(calls).toEqual([['setDependentCareExemptions', 'e1', 'd1', [{ startDate: '2026-10-02', endDate: null }]]]);
    expect(el().textContent).toContain('山田 花子さんの介護保険の適用除外を登録しました。介護保険適用除外等該当・非該当届：遅滞なく');
  });

  it('被扶養者が75歳になっていたら、外れた日を登録していなくても「75歳到達」で扶養から外れたと出す（外す操作は出さない）', async () => {
    detailOverride = {
      dependents: [{ id: 'd2', name: '山田 キヨ', birthDate: '1940-05-01', certifiedDate: '2010-04-01', removedDate: null }],
    };
    await reload();
    const row = el().querySelector('table.dependents tbody tr')!;
    expect(row.textContent).toContain('2015年5月1日');
    expect(row.textContent).toContain('75歳到達');
    expect(row.classList.contains('muted')).toBe(true);
    expect(row.textContent).not.toContain('扶養から外す');
  });

  it('被扶養者の介護保険の適用除外：該当中の期間に非該当年月日を入れる（空欄では保存しない）', async () => {
    detailOverride = {
      dependents: [{ id: 'd1', name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2024-04-01', removedDate: null, careExemptions: [{ startDate: '2026-04-02', endDate: null }] }],
    };
    await reload();
    expect(el().querySelector('td.care-exemptions')!.textContent).toContain('2026年4月2日〜（該当中）');
    button('非該当年月日を入れる').click();
    fixture.detectChanges();
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('非該当年月日を入力してください');
    input('input[name=depExemptionEnd]', '2027-03-15');
    await submit();
    expect(calls).toEqual([['setDependentCareExemptions', 'e1', 'd1', [{ startDate: '2026-04-02', endDate: '2027-03-15' }]]]);
  });

  it('二以上事業所勤務の人は、自社の報酬・合計の報酬・選んだ保険者を一緒に登録する', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2026-11');
    (el().querySelector('input[name=multiOffice]') as HTMLInputElement).click();
    fixture.detectChanges();
    input('input[name=ownRemuneration]', '200,000');
    input('input[name=totalRemuneration]', '300000');
    const sel = el().querySelector('select[name=selectedInsurer]') as HTMLSelectElement;
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change'));
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ validFrom: '2026-11', ownRemuneration: 200_000, totalRemuneration: 300_000, selectedInsurerId: sel.options[1].value });
  });

  // ---- 登録した情報の訂正・削除（設計書 3.1） ----
  const rowButton = (tableSelector: string, rowText: string, label: string) => {
    const row = [...el().querySelectorAll(`${tableSelector} tbody tr`)].find((r) => r.textContent?.includes(rowText))!;
    return [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  };
  async function answer(ok: boolean) {
    await fixture.whenStable();
    TestBed.inject(Confirm).answer(ok);
    // 確認のあとの保存（変更と記録の書き込み）が終わるのを待つ
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('生年月日を直せる。今日より後の日と、資格取得日以降の日は入れない', async () => {
    button('生年月日を直す').click();
    fixture.detectChanges();
    expect((el().querySelector('input[name=birthDateEdit]') as HTMLInputElement).value).toBe('1980-05-10');
    input('input[name=birthDateEdit]', '2023-07-01');
    await submit();
    expect(el().textContent).toContain('生年月日は、資格取得日（入社日）より前の日にしてください');
    input('input[name=birthDateEdit]', '1980-06-10');
    await submit();
    expect(calls).toEqual([['updateBirthDate', 'e1', '1980-06-10']]);
    expect(el().textContent).toContain('生年月日を1980年5月10日から1980年6月10日に直しました');
  });

  it('退職を取り消すと加入中に戻り、退職と同じ日に扶養から外れた被扶養者も扶養に戻す', async () => {
    detailOverride = {
      qualifications: [{ id: 'q1', acquiredDate: '2024-04-01', lostDate: '2026-04-01', lostReason: 'retirement' }],
      dependents: [{ id: 'd1', name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2024-04-01', removedDate: '2026-04-01' }],
    };
    await reload();
    rowButton('table', '2024年4月1日', '直す').click();
    fixture.detectChanges();
    // 退職は、資格喪失日の前日（退職日）で出す
    expect((el().querySelector('input[name=qualEnd]') as HTMLInputElement).value).toBe('2026-03-31');
    const sel = el().querySelector('select[name=qualReason]') as HTMLSelectElement;
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await submit();
    expect(calls).toEqual([['updateQualification', 'e1', 'q1', { acquiredDate: '2024-04-01', lostDate: null, lostReason: null }, [{ id: 'd1', removedDate: null }]]]);
    expect(el().textContent).toContain('退職（資格喪失）を取り消し、加入中に戻しました');
  });

  it('資格の期間を直すとき、生年月日より前・75歳以上の資格取得日は入れない', async () => {
    rowButton('table', '2024年4月1日', '直す').click();
    fixture.detectChanges();
    input('input[name=qualAcquired]', '1979-04-01');
    await submit();
    expect(el().textContent).toContain('資格取得日は生年月日より後の日付にしてください');
    input('input[name=qualAcquired]', '2055-05-10');
    await submit();
    expect(el().textContent).toContain('資格取得日に75歳以上の人は');
    expect(calls).toEqual([]);
  });

  it('資格取得日を後ろにずらすと、被扶養者の扶養に入った日が資格の期間の外になるときは止める', async () => {
    rowButton('table', '2024年4月1日', '直す').click();
    fixture.detectChanges();
    input('input[name=qualAcquired]', '2024-05-01');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('山田 花子さん（扶養に入った日 2024年4月1日）の扶養に入った日が、資格の期間の外になります');
  });

  it('再加入は、資格取得時決定の標準報酬月額と一緒に登録する（75歳以上は登録しない）', async () => {
    detailOverride = { qualifications: [{ id: 'q1', acquiredDate: '2024-04-01', lostDate: '2026-04-01', lostReason: 'retirement' }] };
    await reload();
    button('再加入を登録').click();
    fixture.detectChanges();
    input('input[name=reacquireDate]', '2026-09-01');
    input('input[name=reacquireHealth]', '280000');
    input('input[name=reacquirePension]', '280000');
    await submit();
    expect(calls).toEqual([['addQualification', 'e1', '2026-09-01', { healthStandard: 280_000, pensionStandard: 280_000 }]]);
    expect(el().textContent).toContain('2026年9月分からの標準報酬月額 健保 28万円／厚年 28万円');
  });

  it('資格取得日がまだ来ていない資格は「加入予定」と出し、退職・喪失・異動は出さない', async () => {
    detailOverride = { qualifications: [{ id: 'q1', acquiredDate: '2099-04-01', lostDate: null, lostReason: null }] };
    await reload();
    expect(el().textContent).toContain('加入予定（2099年4月1日から）');
    expect(button('退職を登録')).toBeUndefined();
    expect(button('異動を登録')).toBeUndefined();
  });

  it('ほかの従業員の社員番号を読めなかったら、社員番号の変更を保存しない', async () => {
    loadAllFail = true;
    button('社員番号を変更').click();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    input('input[name=newEmployeeNumber]', '0099');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('ほかの従業員の社員番号を読み込めなかったため');
  });

  it('確定済みの月を読めなかったら、履歴を削除しない', async () => {
    closedFail = true;
    rowButton('#card-family table', '山田 花子', '削除').click();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls.filter((c) => String(c[0]).startsWith('delete'))).toEqual([]);
    expect(el().textContent).toContain('確定済みの月を読み込めなかったため');
  });

  it('資格の期間を直すとき、ほかの資格の期間と重なる日は入れない', async () => {
    rowButton('table', '2024年4月1日', '直す').click();
    fixture.detectChanges();
    input('input[name=qualAcquired]', '2023-06-10');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('ほかの資格の期間（2023年6月5日〜2023年6月21日）と重なっています');
  });

  it('標準報酬月額の履歴を直せる（直している行の月は重なりとみなさない。ほかの行の月とは重ねない）', async () => {
    rowButton('#card-standard table', '資格取得時決定', '直す').click();
    fixture.detectChanges();
    expect(el().textContent).toContain('標準報酬月額を直す');
    const health = [...el().querySelectorAll('#card-standard form label')].find((l) => l.textContent?.includes('健康保険の標準報酬月額'))!.querySelector('input')!;
    health.value = '320000';
    health.dispatchEvent(new Event('input'));
    await submit();
    expect(calls[0].slice(0, 3)).toEqual(['updateStandard', 'e1', 's1']);
    expect(calls[0][3]).toMatchObject({ validFrom: '2024-04', reason: 'acquisition', healthStandard: 320_000, pensionStandard: 300_000 });

    calls = [];
    rowButton('#card-standard table', '資格取得時決定', '直す').click();
    fixture.detectChanges();
    input('#card-standard form input[type=month]', '2027-03');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('この月からの標準報酬月額はすでに登録されています');
  });

  it('直す入力を開くと、選ぶ欄にも登録してある値が選ばれている（決定の理由・支払区分など）', async () => {
    rowButton('#card-standard table', '随時改定', '直す').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const sel = el().querySelector('#card-standard form select') as HTMLSelectElement;
    expect(sel.options[sel.selectedIndex].text).toBe('随時改定');
  });

  it('標準報酬月額の履歴は、確かめてから削除する。資格がある人の最後の1件は削除しない', async () => {
    rowButton('#card-standard table', '随時改定', '削除').click();
    await answer(true);
    expect(calls).toEqual([['deleteStandard', 'e1', 's2']]);

    detailOverride = { standardHistory: [yamada().standardHistory[0]] };
    await reload();
    calls = [];
    rowButton('#card-standard table', '資格取得時決定', '削除').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(TestBed.inject(Confirm).current()).toBeNull();
    expect(el().textContent).toContain('資格がある人の標準報酬月額は、1件は残してください');
  });

  it('削除の確認で「やめる」を選んだら消さない', async () => {
    rowButton('table.dependents', '山田 花子', '削除').click();
    await answer(false);
    expect(calls).toEqual([]);
  });

  it('被扶養者の氏名・生年月日を直せる。扶養から外れた日を空にすると扶養中に戻る', async () => {
    rowButton('table.dependents', '山田 花子', '直す').click();
    fixture.detectChanges();
    input('input[name=dependentEditName]', '山田 華子');
    input('input[name=dependentEditBirth]', '1982-03-04');
    await submit();
    expect(calls).toEqual([['updateDependent', 'e1', 'd1', { name: '山田 華子', birthDate: '1982-03-04', certifiedDate: '2024-04-01', removedDate: null }]]);
  });

  it('休業は種類・開始日も直せる。ほかの休業と期間が重なる直し方は入れない', async () => {
    detailOverride = {
      leaves: [
        { id: 'l1', type: 'maternity', startDate: '2025-01-01', endDate: '2025-03-31', workedDays: null },
        { id: 'l2', type: 'childcare', startDate: '2025-04-01', endDate: '2025-09-30', workedDays: null },
      ],
    };
    await reload();
    rowButton('#card-leave table', '育児休業', '直す').click();
    fixture.detectChanges();
    input('input[name=leaveStart]', '2025-03-15');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('ほかの休業（産前産後休業 2025年1月1日〜2025年3月31日）と期間が重なっています');
    input('input[name=leaveStart]', '2025-04-02');
    await submit();
    expect(calls).toEqual([['updateLeave', 'e1', 'l2', { type: 'childcare', startDate: '2025-04-02', endDate: '2025-09-30', workedDays: null }]]);
  });

  it('休業を産前産後休業に切り替えたら、就業した日数を消す（欄が隠れてエラーが見えないまま保存できなくならないように）', async () => {
    button('休業を追加').click();
    fixture.detectChanges();
    input('input[name=leaveStart]', '2026-05-01');
    input('input[name=workedDays]', '3');
    const type = el().querySelector('select[name=leaveType]') as HTMLSelectElement;
    type.value = 'maternity';
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await submit();
    expect(calls).toEqual([['addLeave', 'e1', { type: 'maternity', startDate: '2026-05-01', endDate: '', workedDays: null }]]);
  });

  it('資格の期間の外の休業（年の打ち間違い）は登録しない', async () => {
    button('休業を追加').click();
    fixture.detectChanges();
    input('input[name=leaveStart]', '2023-01-01');
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('開始日が資格の期間（資格取得日〜資格喪失日の前日）の外です');
  });

  it('壊れた休業のデータは、計算に使っていないことを出し、削除できる', async () => {
    detailOverride = { brokenLeaves: [{ id: 'bad1', text: '種類：xxx・開始日：（なし）・終了日：（なし）・就業日数：（なし）' }] };
    await reload();
    const box = el().querySelector('.broken-leave')!;
    expect(box.textContent).toContain('壊れた休業のデータがあります（計算に使っていません）');
    expect(box.textContent).toContain('種類：xxx');
    (box.querySelector('button') as HTMLButtonElement).click();
    await answer(true);
    expect(calls).toContainEqual(['deleteLeave', 'e1', 'bad1']);
  });

  it('所属の履歴は全担当だけが直せる。1件だけの所属は削除しない', async () => {
    rowButton('#card-qual table:last-of-type', '本社', '削除').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('所属が1件だけのときは削除できません');

    detailOverride = { assignments: [{ id: 'a1', validFrom: '2020-04-01', officeId: 'honsha' }, { id: 'a2', validFrom: '2025-04-01', officeId: 'osaka' }] };
    await reload();
    rowButton('#card-qual table:last-of-type', '大阪支店', '削除').click();
    await answer(true);
    expect(calls).toEqual([['deleteAssignment', 'e1', 'a2', ['honsha']]]);
  });

  it('支払区分・被保険者区分の履歴を直せる（ほかの行と同じ日にはしない）', async () => {
    detailOverride = { payrollAssignments: [{ id: 'p1', validFrom: '2025-04-01', payrollGroupId: 'part' }] };
    await reload();
    rowButton('table.payroll-assignments', 'パート', '直す').click();
    fixture.detectChanges();
    input('input[name=payrollEditDate]', '2025-05-01');
    await submit();
    expect(calls).toEqual([['updatePayrollAssignment', 'e1', 'p1', { validFrom: '2025-05-01', payrollGroupId: 'part' }]]);

    calls = [];
    rowButton('table.insured-types', '2024年4月1日', '削除').click();
    await answer(true);
    expect(calls).toEqual([['deleteInsuredType', 'e1', 't1']]);
  });

  it('休職・適用除外も直す・削除ができる（適用除外は種類・該当年月日も直せる）', async () => {
    detailOverride = { exemptions: [{ id: 'x1', type: 'care', startDate: '2025-04-01', endDate: null }] };
    await reload();
    rowButton('table.exemptions', '2025年4月1日', '直す').click();
    fixture.detectChanges();
    input('input[name=exemptionEditStart]', '2025-05-01');
    await submit();
    expect(calls).toEqual([['updateExemption', 'e1', 'x1', { type: 'care', startDate: '2025-05-01', endDate: '' }]]);

    calls = [];
    rowButton('table.absences', '2023年1月10日', '削除').click();
    await answer(true);
    expect(calls).toEqual([['deleteAbsence', 'e1', 'ab1']]);
  });

  it('契約が変わったら加入対象の判定を入れ直せる。候補が今の状態と違えば、次に登録することを知らせる', async () => {
    button('契約の変更を登録').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const sel = el().querySelector('select[name=eligEmploymentType]') as HTMLSelectElement;
    sel.value = 'partTime';
    sel.dispatchEvent(new Event('change'));
    input('input[name=eligibilityDate]', '2026-10-01');
    input('input[name=eligWeeklyHours]', '15');
    input('input[name=eligMonthlyDays]', '12');
    fixture.detectChanges();
    expect(el().textContent).toContain('候補：加入しない');
    await submit();
    expect(calls[0][0]).toBe('updateEligibility');
    expect(calls[0][2]).toMatchObject({ employmentType: 'partTime', weeklyHours: 15, monthlyDays: 12, candidate: 'none', changedDate: '2026-10-01' });
    expect(el().textContent).toContain('「退職以外の資格喪失」（理由：加入の条件から外れた）を登録してください');
  });

  it('変更の記録：誰が・いつ・何をしたかを出し、直したときは直す前の値も残す', async () => {
    const log = el().querySelector('table.change-logs tbody tr')!.textContent!;
    expect(log).toContain('2026年11月5日 09:03');
    expect(log).toContain('tanto@example.com');
    expect(log).toContain('新規登録（資格取得日 2024年4月1日）');

    rowButton('#card-standard table', '資格取得時決定', '直す').click();
    fixture.detectChanges();
    const health = [...el().querySelectorAll('#card-standard form label')].find((l) => l.textContent?.includes('健康保険の標準報酬月額'))!.querySelector('input')!;
    health.value = '320000';
    health.dispatchEvent(new Event('input'));
    await submit();
    expect(logs[0]).toContain('標準報酬月額を直しました');
    expect(logs[0]).toContain('（直す前：2024年4月からの標準報酬月額（健保 30万円／厚年 30万円）／直したあと：2024年4月からの標準報酬月額（健保 32万円／厚年 30万円））');

    rowButton('table.dependents', '山田 花子', '削除').click();
    await answer(true);
    expect(logs[1]).toBe('被扶養者の山田 花子さん（生年月日 1982年3月3日・扶養に入った日 2024年4月1日）を削除');
  });

  it('変更の記録を残せなかったときは、保存したことと一緒に知らせる（黙って記録が欠けないように）', async () => {
    logWriteFails = true;
    rowButton('table.dependents', '山田 花子', '削除').click();
    await answer(true);
    expect(el().textContent).toContain('を削除しました。（ただし、変更の記録を残せませんでした。');
    expect(logs).toEqual([]);
  });

  it('変更の記録を読み込めなかったときは「記録はありません」ではなく、読み込めなかったことを出し、読み込み直せる', async () => {
    logLoadFails = true;
    await (fixture.componentInstance as unknown as { reloadChangeLogs(): Promise<void> }).reloadChangeLogs();
    fixture.detectChanges();
    const card = el().querySelector('#card-log')!;
    expect(card.textContent).toContain('変更の記録を読み込めませんでした（記録が消えたのではありません）');
    expect(card.textContent).not.toContain('記録はありません');
    logLoadFails = false;
    ([...card.querySelectorAll('button')].find((b) => b.textContent?.includes('読み込み直す')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(card.querySelector('table.change-logs tbody tr')!.textContent).toContain('tanto@example.com');
  });

  it('被扶養者は「保存して続けて追加」で、保存したあとも入力を開いたままにできる', async () => {
    button('被扶養者を追加').click();
    fixture.detectChanges();
    input('input[name=dependentName]', '山田 一郎');
    input('input[name=dependentBirth]', '2015-05-05');
    input('input[name=dependentCertified]', '2024-04-01');
    fixture.detectChanges();
    const again = button('保存して続けて追加');
    // 押すと、続けて追加する印を付けてからフォームを送信する
    again.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls[0][0]).toBe('addDependent');
    expect(el().querySelector('input[name=dependentName]')).not.toBeNull();
    expect((el().querySelector('input[name=dependentName]') as HTMLInputElement).value).toBe('');
    expect(el().textContent).toContain('続けて次の人を入れてください');
  });
});
