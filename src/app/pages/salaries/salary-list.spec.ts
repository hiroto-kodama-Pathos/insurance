import { Confirm, ConfirmRequest } from '../../core/ui/confirm';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth, AuthUser } from '../../core/auth/auth';
import { provideRouter } from '@angular/router';
import { OfficeClosing } from '../../core/calc/closing';
import { Masters } from '../../core/calc/employee-month';
import { ManualWageChange, SalaryRecord } from '../../core/calc/salary';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { salaryDocId, SalaryRepository } from '../../core/repository/salary-repository';
import { SalaryList } from './salary-list';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { legacyGroup } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';

const masters: Masters = {
  offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
  insurers: [],
  insurerRates: [],
  pensionRates: [],
};
const person = (id: string, no: string, name: string): EmployeeRecord => ({
  id, employeeNumber: no, name, birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
});
const sal = (employeeId: string, paidDate: string, fixed: number): SalaryRecord => ({
  id: salaryDocId(employeeId, paidDate), employeeId, paidDate, fixedWages: fixed, nonFixedWages: 0,
  paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
});


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('SalaryList', () => {
  let fixture: ComponentFixture<SalaryList>;
  let store: SalaryRecord[];
  let closings: OfficeClosing[];
  let manual: ManualWageChange[];
  const user = signal<AuthUser | null>(null);

  beforeEach(async () => {
    user.set({ uid: 'u1', email: '', siRole: 'staff', siScope: 'all' });
    store = [sal('e1', '2026-09-25', 300_000)];
    closings = [];
    manual = [];
    await TestBed.configureTestingModule({
      imports: [SalaryList],
      providers: [
        confirmStub,
        provideRouter([]),
        { provide: Auth, useValue: { user } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              { ...person('e1', '0001', '山田 太郎'), fixedWageChanges: manual },
              // 10月から当月払いの区分に変わる（10月は9月分と10月分の2か月分）
              { ...person('e2', '0002', '佐藤 花子'), payrollAssignments: [{ validFrom: '2026-10-01', payrollGroupId: 'same' }] },
              { ...person('e3', '0003', '未加入 パート'), qualifications: [], standardHistory: [] },
            ],
            setFixedWageChange: async (_id: string, c: ManualWageChange) => {
              manual = [...manual, c];
            },
            removeFixedWageChange: async (_id: string, ym: string) => {
              manual = manual.filter((x) => x.yearMonth !== ym);
            },
          },
        },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        {
          provide: SettingsRepository,
          useValue: {
            loadPayrollGroups: async () => [
              legacyGroup(DEFAULT_SETTINGS),
              { id: 'same', name: '当月払い', cutoffDay: 'end', paidIn: 'sameMonth', deductionTiming: 'nextMonth', payDay: 'end' },
            ],
          },
        },
        { provide: ClosingRepository, useValue: { loadMonth: async (ym: string) => closings.filter((c) => c.yearMonth === ym) } },
        {
          provide: SalaryRepository,
          useValue: {
            loadRange: async (from: string, to: string) =>
              store.filter((s) => s.paidDate.slice(0, 7) >= from && s.paidDate.slice(0, 7) <= to),
            save: async (s: Omit<SalaryRecord, 'id'>) => {
              const id = salaryDocId(s.employeeId, s.paidDate);
              store = [...store.filter((x) => x.id !== id), { ...s, id }];
            },
            remove: async (id: string) => {
              store = store.filter((x) => x.id !== id);
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SalaryList);
    fixture.componentRef.instance['yearMonth'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const row = (name: string) =>
    [...el().querySelectorAll('table.salaries tbody tr')].find((tr) => tr.textContent!.includes(name)) as HTMLElement;
  function type(tr: HTMLElement, name: string, value: string) {
    const input = tr.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('適用事業所の選択肢：その月に対象の人がいる事業所だけを件数つきで出す。特定の事業所の担当者には担当事業所だけ（随時改定と同じ）', async () => {
    const page = fixture.componentRef.instance as unknown as {
      masters: { set(v: Masters): void };
      employees: { update(f: (l: EmployeeRecord[]) => EmployeeRecord[]): void };
    };
    page.masters.set({
      ...masters,
      offices: [
        ...masters.offices,
        { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
        { id: 'nagoya', name: '名古屋支店', prefecture: '愛知県', insurerId: 'kyokai' }, // 対象の人がいない
      ],
    });
    page.employees.update((l) => l.map((e) => (e.id === 'e2' ? { ...e, assignments: [{ validFrom: '2024-04-01', officeId: 'osaka' }] } : e)));
    fixture.detectChanges();
    const options = () => [...(el().querySelector('select[name=office]') as HTMLSelectElement).options].map((o) => o.textContent!.trim());
    expect(options()).toEqual(['すべて（3件）', '本社（2件）', '大阪支店（1件）']);
    // 件数は、ほかの絞り込み（検索）に合わせる
    const q = el().querySelector('input[name=query]') as HTMLInputElement;
    q.value = '佐藤';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(options()).toEqual(['すべて（1件）', '大阪支店（1件）']);
    // 大阪支店の担当者には、大阪支店だけ
    q.value = '';
    q.dispatchEvent(new Event('input'));
    user.set({ uid: 'u2', email: '', siRole: 'staff', siScope: 'osaka' });
    fixture.detectChanges();
    expect(options().slice(1)).toEqual(['大阪支店（1件）']);
  });

  it('保存していない行に印を付け、件数とまとめて保存のボタンを出す。入力を戻すと印が消える', async () => {
    expect(el().querySelector('.unsaved-bar')).toBeNull();
    type(row('山田 太郎'), 'fixedWages', '340000');
    await settle();
    expect(row('山田 太郎').classList).toContain('unsaved');
    expect(row('山田 太郎').textContent).toContain('未保存');
    expect(el().querySelector('.unsaved-bar')!.textContent).toContain('保存していない入力が 1人分');
    expect(fixture.componentRef.instance.unsavedCount()).toBe(1);
    // 元の値に打ち直したら、未保存ではない
    type(row('山田 太郎'), 'fixedWages', '');
    await settle();
    expect(fixture.componentRef.instance.unsavedCount()).toBe(0);
    type(row('山田 太郎'), 'fixedWages', '340000');
    await settle();
    ([...row('山田 太郎').querySelectorAll('button')].find((b) => b.textContent!.includes('入力を戻す')) as HTMLButtonElement).click();
    await settle();
    expect(fixture.componentRef.instance.unsavedCount()).toBe(0);
    expect((row('山田 太郎').querySelector('input[name="fixedWages"]') as HTMLInputElement).value).toBe('');
  });

  it('1行を保存しても、ほかの行の保存していない入力は消えない', async () => {
    type(row('山田 太郎'), 'fixedWages', '340000');
    type(row('山田 太郎'), 'paymentBaseDays', '31');
    type(row('佐藤 花子'), 'fixedWages', '250000');
    await settle();
    (row('山田 太郎').querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.some((s) => s.employeeId === 'e1' && s.paidDate === '2026-10-25')).toBe(true);
    expect((row('佐藤 花子').querySelector('input[name="fixedWages"]') as HTMLInputElement).value).toBe('250000');
    expect(row('佐藤 花子').classList).toContain('unsaved');
    expect(row('山田 太郎').classList).not.toContain('unsaved');
  });

  it('まとめて保存：入力の正しい行だけを保存し、誤りのある行はエラーを出して残す', async () => {
    type(row('山田 太郎'), 'fixedWages', '340000');
    type(row('山田 太郎'), 'paymentBaseDays', '31');
    type(row('未加入 パート'), 'fixedWages', '80000'); // 支払基礎日数がない
    await settle();
    (el().querySelector('.unsaved-bar button') as HTMLButtonElement).click();
    await settle();
    expect(store.filter((s) => s.paidDate.startsWith('2026-10')).map((s) => s.employeeId)).toEqual(['e1']);
    expect(el().textContent).toContain('1人の給与を保存しました。入力に誤りがある1人は保存していません');
    expect(row('未加入 パート').classList).toContain('unsaved');
    expect([...row('未加入 パート').querySelectorAll('.err')].some((e) => e.textContent!.trim() !== '')).toBe(true);
    expect(fixture.componentRef.instance.unsavedCount()).toBe(1);
  });

  it('保存していない入力があるまま支払月を変えるときは確認し、やめたら月を戻す', async () => {
    type(row('山田 太郎'), 'fixedWages', '340000');
    await settle();
    const month = el().querySelector('input[type=month]') as HTMLInputElement;
    const confirm = TestBed.inject(Confirm) as unknown as { ask: (r: ConfirmRequest) => Promise<boolean> };
    const original = confirm.ask;
    confirm.ask = async (r) => {
      asked.push(r);
      return false;
    };
    month.value = '2026-11';
    month.dispatchEvent(new Event('change'));
    await settle();
    expect(asked.at(-1)!.title).toBe('保存していない入力があります');
    expect(month.value).toBe('2026-10');
    expect(fixture.componentRef.instance['yearMonth']()).toBe('2026-10');
    expect((row('山田 太郎').querySelector('input[name="fixedWages"]') as HTMLInputElement).value).toBe('340000');
    confirm.ask = original;
  });

  it('支払基礎日数：正社員・役員と、前月が暦日数だった人には、計算期間の暦日数を初期値に入れる。パート・未加入の人には入れない', async () => {
    const inst = fixture.componentRef.instance;
    inst['employees'].set([
      { ...person('e1', '0001', '山田 太郎'), eligibility: { employmentType: 'regular' } as never },
      { ...person('e4', '0004', '前月 暦日'), },
      { ...person('e5', '0005', '時給 パート'), eligibility: { employmentType: 'partTime' } as never },
      { ...person('e3', '0003', '未加入 パート'), qualifications: [], standardHistory: [] },
    ]);
    // e4 は雇用区分がないが、前月（9月支払＝8月分）の支払基礎日数が8月の暦日数（31日）
    store = [{ ...sal('e4', '2026-09-25', 250_000), paymentBaseDays: 31 }];
    await inst['onMonthChange'](Object.assign(document.createElement('input'), { value: '2026-10' }));
    await settle();
    const days = (name: string) => (row(name).querySelector('input[name="paymentBaseDays"]') as HTMLInputElement).value;
    expect(days('山田 太郎')).toBe('30'); // 末締め翌月払いの10月支払は、9月の30日
    expect(row('山田 太郎').textContent).toContain('暦日数（自動）');
    expect(days('前月 暦日')).toBe('30');
    expect(days('時給 パート')).toBe('');
    expect(days('未加入 パート')).toBe('');
    // 初期値は「未保存」にしない（入れただけで、まだ何も変えていない）
    expect(inst.unsavedCount()).toBe(0);
    // 欠勤控除で直したら、「自動」の添え書きは消える
    type(row('山田 太郎'), 'paymentBaseDays', '19');
    await settle();
    expect(row('山田 太郎').textContent).not.toContain('暦日数（自動）');
  });

  it('画面の使い方の説明は畳んでおく。状態の列は、対応が要るものを先に、情報だけのもの（入力済みなど）を後に出す', async () => {
    const howto = el().querySelector('details.howto') as HTMLDetailsElement;
    expect(howto.open).toBe(false);
    expect(howto.textContent).toContain('給与計算が終わったら');
    type(row('山田 太郎'), 'fixedWages', '340000');
    await settle();
    const badges = [...row('山田 太郎').querySelectorAll('td.status .badge')].map((b) => b.textContent!.trim());
    expect(badges[0]).toBe('未保存');
    const info = row('未加入 パート').querySelector('.badge.info');
    expect(info!.textContent).toContain('未加入');
  });

  it('資格のある人を並べ、前月の固定的賃金を出す', () => {
    expect(row('山田 太郎').textContent).toContain('300,000');
    expect(el().textContent).toContain('入力済み 0 / 3人');
  });

  it('入力して保存すると、前月から変わった人に「変動あり」が付く', async () => {
    const tr = row('山田 太郎');
    type(tr, 'fixedWages', '340,000');
    type(tr, 'nonFixedWages', '20000');
    type(tr, 'paymentBaseDays', '31');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.find((s) => s.paidDate === '2026-10-25')?.fixedWages).toBe(340_000);
    expect(row('山田 太郎').textContent).toContain('変動あり（上がった）');
    expect(el().textContent).toContain('山田 太郎さんの給与（2026年10月25日支払）を保存しました。');
  });

  it('支払月・締め日の変更月は、どの扱いかを出し、算定から除く額を一緒に保存する', async () => {
    const tr = row('佐藤 花子');
    expect(tr.textContent).toContain('10月は支払月の変更（翌月払い→当月払い）で2か月分を払った月');
    expect(row('山田 太郎').querySelector('input[name="excludedAmount"]')).toBeNull();
    type(tr, 'fixedWages', '520000');
    type(tr, 'paymentBaseDays', '31');
    type(tr, 'excludedAmount', '260,000');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.find((x) => x.employeeId === 'e2')?.excludedAmount).toBe(260_000);
    expect(row('佐藤 花子').textContent).toContain('変更前の給与260,000円を除いて平均');
  });

  it('未加入の人も並べ、労働時間を一緒に保存する', async () => {
    const tr = row('未加入 パート');
    expect(tr.textContent).toContain('未加入');
    type(tr, 'fixedWages', '110000');
    type(tr, 'paymentBaseDays', '20');
    type(tr, 'workingHours', '86.5');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.find((s) => s.employeeId === 'e3')?.workingHours).toBe(86.5);
  });

  it('額から分からない変動を「固定的賃金の変動として登録」し、取り消せる', async () => {
    const button = (tr: HTMLElement, text: string) => [...tr.querySelectorAll('button')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;
    button(row('佐藤 花子'), '変動として登録').click();
    await settle();
    const form = el().querySelector('tr.manual-form') as HTMLElement;
    button(form, '登録').click();
    await settle();
    expect(form.textContent).toContain('内容を入力してください');
    const note = form.querySelector('input[name=manualNote]') as HTMLInputElement;
    note.value = '所定労働時間の延長';
    note.dispatchEvent(new Event('input'));
    const dir = form.querySelector('select[name=manualDirection]') as HTMLSelectElement;
    dir.value = 'down';
    dir.dispatchEvent(new Event('change'));
    button(form, '登録').click();
    await settle();
    expect(manual).toEqual([{ yearMonth: '2026-10', direction: 'down', note: '所定労働時間の延長' }]);
  });

  it('前月・今月の登録済みの変動と遡及の可能性を表示する', async () => {
    manual = [{ yearMonth: '2026-10', direction: 'up', note: '手当の新設' }];
    store = [sal('e1', '2026-08-25', 280_000), sal('e1', '2026-09-25', 430_000), sal('e1', '2026-10-25', 330_000)];
    await fixture.componentRef.instance['onMonthChange'](Object.assign(document.createElement('input'), { value: '2026-10' }));
    fixture.componentRef.instance['employees'].set([{ ...person('e1', '0001', '山田 太郎'), fixedWageChanges: manual }]);
    await settle();
    const t = row('山田 太郎').textContent!;
    expect(t).toContain('変動として登録（上がった）');
    expect(t).toContain('登録した内容：手当の新設');
    expect(t).toContain('遡及の可能性あり（2026年9月：280,000→430,000→330,000円');
    expect(t).toContain('変動の登録を取り消す');
  });

  it('氏名で検索し、未入力の人に絞り込める', () => {
    const shown = () => [...el().querySelectorAll('table.salaries tbody tr td:first-child')].map((td) => td.textContent!.trim());
    const all = shown();
    expect(all.length).toBeGreaterThan(1);
    const q = el().querySelector('input[name="query"]') as HTMLInputElement;
    q.value = all[0];
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(shown()).toEqual([all[0]]);
    q.value = 'いない人';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el().querySelector('table.salaries tbody')!.textContent).toContain('条件に合う人はいません');
  });

  it('入力に誤りがあれば保存しない', async () => {
    const tr = row('佐藤 花子');
    type(tr, 'fixedWages', '');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.length).toBe(1);
    expect(row('佐藤 花子').textContent).toContain('固定的賃金を0円以上の円で入力してください');
  });

  it('確定済みの月は入力できない', async () => {
    closings = [{ yearMonth: '2026-10', officeId: 'honsha' } as OfficeClosing];
    await fixture.componentRef.instance['loadMonth']();
    await settle();
    expect(row('山田 太郎').textContent).toContain('確定');
    expect(row('山田 太郎').querySelector('button')).toBeNull();
  });
});
