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
import { salaryDocId, SalaryExistsError, SalaryRepository } from '../../core/repository/salary-repository';
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
  /** 山田さんの異動（月の途中の異動を確かめるテストだけ足す） */
  let moves: { validFrom: string; officeId: string }[];
  /** 保存した給与の所属事業所（給与のID → 事業所ID） */
  let savedOffice: Record<string, string>;
  const user = signal<AuthUser | null>(null);

  beforeEach(async () => {
    user.set({ uid: 'u1', email: '', siRole: 'staff', siScope: 'all' });
    store = [sal('e1', '2026-09-25', 300_000)];
    closings = [];
    manual = [];
    moves = [];
    savedOffice = {};
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
              { ...person('e1', '0001', '山田 太郎'), fixedWageChanges: manual, assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, ...moves] },
              // 10月から当月払いの区分に変わる（10月は9月分と10月分の2か月分）
              { ...person('e2', '0002', '佐藤 花子'), payrollAssignments: [{ validFrom: '2026-10-01', payrollGroupId: 'same' }] },
              { ...person('e3', '0003', '未加入 パート'), qualifications: [], standardHistory: [] },
            ],
            withLog: async (_id: string, _text: string, action: () => Promise<unknown>) => { await action(); return true; },
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
            // 本物と同じく、新しい支払日に給与があれば上書きせずに止め、支払日を変えたら前の給与を消す
            put: async (before: { id: string } | null, s: Omit<SalaryRecord, 'id'>, officeId: string) => {
              const id = salaryDocId(s.employeeId, s.paidDate);
              savedOffice[id] = officeId;
              if (before?.id !== id && store.some((x) => x.id === id)) throw new SalaryExistsError(s.paidDate);
              store = [...store.filter((x) => x.id !== id && x.id !== before?.id), { ...s, id }];
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

  it('算定から除く額が要る月は、空のままでは保存しない（除く額がなければ 0 で保存できる）', async () => {
    const tr = row('佐藤 花子');
    type(tr, 'fixedWages', '520000');
    type(tr, 'paymentBaseDays', '31');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.find((x) => x.employeeId === 'e2')).toBeUndefined();
    expect(row('佐藤 花子').textContent).toContain('この月は算定から除く額が必要です');
    type(row('佐藤 花子'), 'excludedAmount', '0');
    (row('佐藤 花子').querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.find((x) => x.employeeId === 'e2')?.excludedAmount).toBe(0);
  });

  it('CSVで取り込んだ（算定から除く額が空の）給与は、未入力として知らせ、その人だけを表示できる', async () => {
    store = [...store, { ...sal('e2', '2026-10-31', 520_000), excludedAmount: null }];
    await (fixture.componentInstance as unknown as { loadMonth(): Promise<void> }).loadMonth();
    await settle();
    expect(el().querySelector('.exclusion-missing')!.textContent).toContain('算定から除く額が未入力の人が1人');
    expect(row('佐藤 花子').textContent).toContain('算定から除く額が未入力');
    (el().querySelector('.exclusion-missing button') as HTMLButtonElement).click();
    await settle();
    expect([...el().querySelectorAll('table.salaries tbody tr')].map((r) => r.children[1]?.textContent?.trim())).toEqual(['佐藤 花子']);
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

  it('「変動として登録」の入力欄：内容を書いたまま画面を移る・「やめる」と確かめる（書いていなければ確かめない）', async () => {
    const button = (tr: HTMLElement, text: string) => [...tr.querySelectorAll('button')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;
    const unsaved = () => (fixture.componentInstance as unknown as { unsavedCount(): number }).unsavedCount();
    asked.length = 0;
    button(row('佐藤 花子'), '変動として登録').click();
    await settle();
    expect(unsaved()).toBe(0);
    button(el().querySelector('tr.manual-form') as HTMLElement, 'やめる').click();
    await settle();
    expect(asked).toHaveLength(0);
    expect(el().querySelector('tr.manual-form')).toBeNull();

    button(row('佐藤 花子'), '変動として登録').click();
    await settle();
    const note = el().querySelector('tr.manual-form input[name=manualNote]') as HTMLInputElement;
    note.value = '所定労働時間の延長';
    note.dispatchEvent(new Event('input'));
    expect(unsaved()).toBe(1); // 画面を移るときの確認の対象
    button(el().querySelector('tr.manual-form') as HTMLElement, 'やめる').click();
    await settle();
    expect(asked.map((a) => a.ok)).toEqual(['破棄して閉じる']);
    expect(el().querySelector('tr.manual-form')).toBeNull();
    expect(unsaved()).toBe(0);
  });

  describe('同じ月に複数回払った給与', () => {
    const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;
    const panel = () => el().querySelector('tr.payments-panel') as HTMLElement;
    const fill = (name: string, value: string) => {
      const i = panel().querySelector(`input[name="${name}"]`) as HTMLInputElement;
      i.value = value;
      i.dispatchEvent(new Event('input'));
    };
    const payments = () => store.filter((s) => s.employeeId === 'e1' && s.paidDate.startsWith('2026-10')).map((s) => [s.paidDate, s.fixedWages]).sort();

    beforeEach(async () => {
      store = [...store, sal('e1', '2026-10-15', 200_000)];
      fixture.componentRef.instance['yearMonth'].set('2026-10');
      await (fixture.componentInstance as unknown as { loadMonth(): Promise<void> }).loadMonth();
      await settle();
      asked.length = 0;
    });

    it('2回目の支払いを追加すると、行に回数を出し、支払日ごとの一覧に並ぶ', async () => {
      button(row('山田 太郎'), '支払いの一覧・追加（1回）').click();
      await settle();
      button(panel(), '支払いを追加（同じ月の2回目）').click();
      await settle();
      fill('paymentPaidDate', '2026-10-31');
      fill('payment-fixedWages', '50000');
      fill('payment-paymentBaseDays', '16');
      button(panel(), '保存').click();
      await settle();
      expect(payments()).toEqual([['2026-10-15', 200_000], ['2026-10-31', 50_000]]);
      expect(row('山田 太郎').textContent).toContain('この月は2回払い（合算。この行は1回目）');
      expect(panel().querySelectorAll('table.payments tbody tr')).toHaveLength(2);
      expect(el().textContent).toContain('2026年10月の支払いは2回で、随時改定・定時決定では合算します');
    });

    it('2回目だけを直す・削除できる（1回目はそのまま）', async () => {
      store = [...store, sal('e1', '2026-10-31', 50_000)];
      await (fixture.componentInstance as unknown as { loadMonth(): Promise<void> }).loadMonth();
      await settle();
      button(row('山田 太郎'), '支払いの一覧・追加（2回）').click();
      await settle();
      const second = () => panel().querySelectorAll('table.payments tbody tr')[1] as HTMLElement;
      button(second(), '直す').click();
      await settle();
      fill('payment-fixedWages', '55000');
      button(panel(), '保存').click();
      await settle();
      expect(payments()).toEqual([['2026-10-15', 200_000], ['2026-10-31', 55_000]]);
      button(second(), '削除').click();
      await settle();
      expect(asked.at(-1)?.message).toContain('同じ月のほかの支払い（1回）は残ります');
      expect(payments()).toEqual([['2026-10-15', 200_000]]);
    });

    it('2回目以降の支払いは、一覧を開かなくてもその人の行の下に出し、この月の合計も出す。その行から直せる', async () => {
      store = [...store, { ...sal('e1', '2026-10-31', 50_000), nonFixedWages: 3_000, paymentBaseDays: 16 }];
      await (fixture.componentInstance as unknown as { loadMonth(): Promise<void> }).loadMonth();
      await settle();
      expect(panel()).toBeNull();
      const extra = el().querySelector('tr.extra-payment') as HTMLElement;
      expect(extra.textContent).toContain('2回目');
      expect(extra.textContent).toContain('2026年10月31日');
      expect(extra.textContent).toContain('50,000');
      const total = [...el().querySelectorAll('tr.payments-total td')].map((td) => td.textContent!.trim());
      expect(total.slice(1, 6)).toEqual(['この月の合計', '2回', '250,000', '3,000', '46']);
      button(extra, '直す').click();
      await settle();
      expect((panel().querySelector('input[name="payment-fixedWages"]') as HTMLInputElement).value).toBe('50000');
      expect(el().querySelector('tr.extra-payment')!.classList.contains('editing')).toBe(true);
    });

    it('支払日を、ほかの支払いと同じ日に変えようとすると、上書きせずにエラー（一覧の行・支払日ごとの欄のどちらも）', async () => {
      store = [...store, sal('e1', '2026-10-31', 50_000)];
      await (fixture.componentInstance as unknown as { loadMonth(): Promise<void> }).loadMonth();
      await settle();
      // 一覧の行（1回目）の支払日を、2回目と同じ日に
      type(row('山田 太郎'), 'fixedWages', '210000');
      const date = row('山田 太郎').querySelector('input[type=date]') as HTMLInputElement;
      date.value = '2026-10-31';
      date.dispatchEvent(new Event('input'));
      button(row('山田 太郎'), '保存').click();
      await settle();
      expect(row('山田 太郎').textContent).toContain('2026年10月31日の支払いはすでに登録されています');
      expect(payments()).toEqual([['2026-10-15', 200_000], ['2026-10-31', 50_000]]);
      button(row('山田 太郎'), '入力を戻す').click();
      await settle();
      // 支払日ごとの欄で、2回目の支払日を1回目と同じ日に
      button(row('山田 太郎'), '支払いの一覧・追加').click();
      await settle();
      button(panel().querySelectorAll('table.payments tbody tr')[1] as HTMLElement, '直す').click();
      await settle();
      fill('paymentPaidDate', '2026-10-15');
      button(panel(), '保存').click();
      await settle();
      expect(panel().textContent).toContain('2026年10月15日の支払いはすでに登録されています');
      expect(payments()).toEqual([['2026-10-15', 200_000], ['2026-10-31', 50_000]]);
    });

    it('支払日の変更は、前の支払日の給与と入れ替える（2件にならない）。ほかの担当者が先に登録していたら止める', async () => {
      button(row('山田 太郎'), '支払いの一覧・追加').click();
      await settle();
      button(panel().querySelector('table.payments tbody tr') as HTMLElement, '直す').click();
      await settle();
      fill('paymentPaidDate', '2026-10-20');
      button(panel(), '保存').click();
      await settle();
      expect(payments()).toEqual([['2026-10-20', 200_000]]);
      // 画面に出ていない給与（ほかの担当者が登録した）と同じ支払日を追加しようとすると、上書きしない
      store = [...store, sal('e1', '2026-10-31', 70_000)];
      button(panel(), '支払いを追加').click();
      await settle();
      fill('paymentPaidDate', '2026-10-31');
      fill('payment-fixedWages', '50000');
      fill('payment-paymentBaseDays', '16');
      button(panel(), '保存').click();
      await settle();
      expect(panel().textContent).toContain('ほかの担当者が登録した可能性があります');
      expect(payments()).toEqual([['2026-10-20', 200_000], ['2026-10-31', 70_000]]);
    });

    it('支払いの入力欄を書きかけで「やめる」と確かめ、画面を移るときの確認にも数える', async () => {
      const unsaved = () => (fixture.componentInstance as unknown as { unsavedCount(): number }).unsavedCount();
      button(row('山田 太郎'), '支払いの一覧・追加').click();
      await settle();
      button(panel(), '支払いを追加').click();
      await settle();
      expect(unsaved()).toBe(0);
      fill('payment-fixedWages', '50000');
      expect(unsaved()).toBe(1);
      button(panel(), 'やめる').click();
      await settle();
      expect(asked.map((a) => a.ok)).toEqual(['破棄して閉じる']);
      expect(panel().querySelector('form')).toBeNull();
      expect(unsaved()).toBe(0);
    });
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

  it('月の途中で異動した人の給与は、支払日に所属している事業所で保存する（CSVの取り込みと同じ）', async () => {
    moves = [{ validFrom: '2026-10-15', officeId: 'osaka' }];
    fixture = TestBed.createComponent(SalaryList);
    fixture.componentRef.instance['yearMonth'].set('2026-10');
    await settle();
    (fixture.componentRef.instance as unknown as { masters: { set(v: Masters): void } }).masters.set({
      ...masters,
      offices: [...masters.offices, { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' }],
    });
    await settle();
    const tr = row('山田 太郎');
    const date = tr.querySelector('input[type=date]') as HTMLInputElement;
    date.value = '2026-10-10';
    date.dispatchEvent(new Event('input'));
    type(tr, 'fixedWages', '300000');
    type(tr, 'paymentBaseDays', '31');
    ([...tr.querySelectorAll('button')].find((b) => b.textContent!.trim() === '保存') as HTMLButtonElement).click();
    await settle();
    expect(savedOffice['e1_2026-10-10']).toBe('honsha');
    // 異動のあとの支払日（10月25日）なら大阪支店
    const tr2 = row('山田 太郎');
    const date2 = tr2.querySelector('input[type=date]') as HTMLInputElement;
    date2.value = '2026-10-25';
    date2.dispatchEvent(new Event('input'));
    ([...tr2.querySelectorAll('button')].find((b) => b.textContent!.trim() === '保存') as HTMLButtonElement).click();
    await settle();
    expect(savedOffice['e1_2026-10-25']).toBe('osaka');
  });

  it('入力に誤りがあれば保存しない', async () => {
    const tr = row('佐藤 花子');
    type(tr, 'fixedWages', '');
    (tr.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(store.length).toBe(1);
    expect(row('佐藤 花子').textContent).toContain('固定的賃金を入力してください（固定的賃金がない月は0）');
  });

  it('確定済みの月は入力できない', async () => {
    closings = [{ yearMonth: '2026-10', officeId: 'honsha' } as OfficeClosing];
    await fixture.componentRef.instance['loadMonth']();
    await settle();
    expect(row('山田 太郎').textContent).toContain('確定');
    expect(row('山田 太郎').querySelector('button')).toBeNull();
  });
});
