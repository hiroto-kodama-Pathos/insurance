import { provideRouter } from '@angular/router';
import { Confirm, ConfirmRequest } from '../../core/ui/confirm';
import { FilingRepository } from '../../core/repository/filing-repository';
const filed = new Set<string>();
import { legacyGroup } from '../../core/calc/payroll-group';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BonusRecord } from '../../core/calc/bonus-premium';
import { Masters } from '../../core/calc/employee-month';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { OfficeClosing } from '../../core/calc/closing';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { BonusList } from './bonus-list';

const masters: Masters = {
  offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

const person = (id: string, no: string, name: string, lostDate: string | null = null): EmployeeRecord => ({
  id,
  employeeNumber: no,
  name,
  birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate }],
  leaves: [],
  exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
});


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('BonusList', () => {
  let fixture: ComponentFixture<BonusList>;
  let store: BonusRecord[];
  let closings: OfficeClosing[];

  beforeEach(async () => {
    store = [{ id: 'b1', employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000 }];
    closings = [];
    await TestBed.configureTestingModule({
      imports: [BonusList],
      providers: [
        confirmStub,
        provideRouter([]),
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              person('e1', '0001', '山田 太郎'),
              person('e2', '0002', '退職 予定', '2026-12-31'),
              // 二以上事業所勤務の役員（自社20万円／合計30万円）
              {
                ...person('e3', '0003', '兼務 役員'),
                standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000, ownRemuneration: 200_000, totalRemuneration: 300_000, selectedInsurerId: 'kyokai' }],
              },
            ],
          },
        },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        {
          provide: SettingsRepository,
          useValue: {
            loadSettings: async () => DEFAULT_SETTINGS,
            loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)],
            loadBonusTypes: async () => [{ id: 'q', name: '四半期賞与', isRemuneration: true, validFrom: '2026-04' }],
          },
        },
        { provide: FilingRepository, useValue: { loadFiledIds: async () => filed } },
        { provide: ClosingRepository, useValue: { loadMonth: async (ym: string) => closings.filter((c) => c.yearMonth === ym) } },
        {
          provide: BonusRepository,
          useValue: {
            loadFiscalYear: async () => [...store],
            add: async (b: Omit<BonusRecord, 'id'>, _officeId: string) => {
              store.push({ ...b, id: `b${store.length + 1}` });
            },
            remove: async (id: string) => {
              store = store.filter((b) => b.id !== id);
            },
            setTotalAmount: async (id: string, totalAmount: number | null) => {
              store = store.map((b) => (b.id === id ? { ...b, totalAmount } : b));
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BonusList);
    fixture.componentRef.instance['yearMonth'].set('2026-12');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  type Unsaved = { unsavedCount(): number };
  const unsaved = () => (fixture.componentInstance as unknown as Unsaved).unsavedCount();

  it('登録欄に従業員・支給額を入れたまま画面を移ろうとしたら確かめる', () => {
    expect(unsaved()).toBe(0);
    (fixture.componentInstance as unknown as { setForm(k: string, v: string): void }).setForm('amount', '500000');
    expect(unsaved()).toBe(1);
  });

  it('登録した賞与の保険料と、賞与支払届の期限を表示する', () => {
    const text = el().querySelector('table.persons tbody')!.textContent!;
    expect(text).toContain('山田 太郎');
    expect(text).toContain('24,625'); // 健康保険の本人負担
    expect(text).toContain('45,750'); // 厚生年金の本人負担
    expect(el().querySelector('table.reports')!.textContent).toContain('2026年12月15日');
  });

  it('氏名・社員番号で検索して表示する賞与を絞り込める', () => {
    const q = el().querySelector('input[name="bonusQuery"]') as HTMLInputElement;
    q.value = '山田太郎';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el().querySelector('table.persons tbody')!.textContent).toContain('山田 太郎');
    q.value = 'いない人';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el().querySelector('table.persons tbody')!.textContent).toContain('条件に合う賞与はありません');
  });

  it('登録欄で従業員を氏名で探すと選択肢が絞られ、1人に絞れたらその人を選ぶ', () => {
    const q = el().querySelector('input[name="employeeQuery"]') as HTMLInputElement;
    q.value = '山田太郎';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent!.trim())).toEqual(['選んでください', '0001 山田 太郎']);
    expect(sel.value).toBe('e1');
  });

  it('登録すると一覧に加わり、喪失月の賞与は保険料なしでも届出に数える', async () => {
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e2';
    sel.dispatchEvent(new Event('change'));
    const [date, amount] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]')] as HTMLInputElement[];
    date.value = '2026-12-10';
    date.dispatchEvent(new Event('input'));
    amount.value = '300,000';
    amount.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(store).toHaveLength(2);
    expect(store[1]).toMatchObject({ employeeId: 'e2', paidDate: '2026-12-10', amount: 300_000 });
    expect(el().textContent).toContain('資格喪失月（保険料なし・累計に含める）');
    expect(el().querySelector('table.reports tbody tr')!.textContent).toContain('2人');
  });

  it('同じ月の2回目の賞与は届け出る額に合算し、うち現物を分けて出す。登録すると期限と届け出る額を知らせる', async () => {
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date, amount, inKind] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]'), el().querySelector('form input[name=inKindAmount]')] as HTMLInputElement[];
    date.value = '2026-12-25';
    date.dispatchEvent(new Event('input'));
    amount.value = '100,500';
    amount.dispatchEvent(new Event('input'));
    inKind.value = '30000';
    inKind.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(store[1]).toMatchObject({ employeeId: 'e1', amount: 100_500, inKindAmount: 30_000 });
    const row = [...el().querySelectorAll('table.report-amounts tbody tr')].find((tr) => tr.textContent!.includes('山田 太郎'))!.textContent!;
    expect(row).toContain('2026年12月10日・2026年12月25日');
    expect(row).toContain('600,000');
    expect(row).toContain('30,000');
    expect(row).toContain('同じ月に2回の支給を合算');
    expect(el().querySelector('.notice')!.textContent).toContain('賞与支払届は2026年12月30日までに届け出ます');
  });

  it('年4回以上支給の種類を選ぶと報酬扱いで登録し、賞与の保険料をかけず、届出にも含めない', async () => {
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date, amount] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]')] as HTMLInputElement[];
    date.value = '2026-12-20';
    date.dispatchEvent(new Event('input'));
    amount.value = '100000';
    amount.dispatchEvent(new Event('input'));
    const type = el().querySelector('select[name=bonusType]') as HTMLSelectElement;
    type.value = 'q';
    type.dispatchEvent(new Event('change'));
    await settle();
    expect(el().querySelector('form')!.textContent).toContain('報酬扱い（賞与の保険料なし）');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(store[1]).toMatchObject({ bonusTypeId: 'q', isRemuneration: true });
    expect(el().textContent).toContain('報酬扱い（年4回以上支給の賞与');
    expect(el().querySelector('table.reports tbody tr')!.textContent).toContain('1人');
  });

  it('種類を選ばずに同じ年度で4回目の賞与を登録しようとすると警告する', async () => {
    store.push(
      { id: 'b2', employeeId: 'e1', paidDate: '2026-06-10', amount: 100_000 },
      { id: 'b3', employeeId: 'e1', paidDate: '2026-09-10', amount: 100_000 },
    );
    fixture.componentRef.instance['fyBonuses'].set([...store]);
    await settle();
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]')] as HTMLInputElement[];
    date.value = '2027-03-10';
    date.dispatchEvent(new Event('input'));
    await settle();
    expect(el().querySelector('p.warn')!.textContent).toContain('同じ年度で4回目の賞与です');
  });

  it('対象月と支給日の年度が違っても、支給日の年度の賞与で4回目を数える', async () => {
    store.push(
      { id: 'b2', employeeId: 'e1', paidDate: '2026-06-10', amount: 100_000 },
      { id: 'b3', employeeId: 'e1', paidDate: '2026-09-10', amount: 100_000 },
    );
    fixture.componentRef.instance['onMonthChange']('2027-04');
    await settle();
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]')] as HTMLInputElement[];
    date.value = '2027-03-10';
    date.dispatchEvent(new Event('input'));
    await settle();
    await settle();
    expect(el().querySelector('p.warn')!.textContent).toContain('同じ年度で4回目の賞与です');
  });

  it('入力が足りなければ登録しない', async () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(store).toHaveLength(1);
    expect(el().textContent).toContain('従業員を選んでください');
  });

  it('確定済みの月には登録できず、確定した賞与は削除ボタンを出さない', async () => {
    closings = [
      {
        yearMonth: '2026-12', officeId: 'honsha', closedBy: 'u', closedAt: null, rows: [],
        totals: {} as OfficeClosing['totals'], bonusTotals: {} as OfficeClosing['totals'],
        bonusRows: [{
          bonusId: 'b1', employeeId: 'e1', employeeNumber: '0001', name: '山田 太郎', paidDate: '2026-12-10', amount: 500_000,
          insurerId: 'kyokai', target: 'charged', standardBonus: 500_000, base: { health: 500_000, pension: 500_000 },
          capped: { health: false, pension: false }, exemption: 'none', rates: null, careLabel: 'second', exempt: false,
          premiums: { health: { fullSen: 4925000, employeeYen: 24625, employerSen: 2462500 }, care: null, childSupport: null, pension: null },
        }],
      },
    ];
    // 開き直す
    fixture.componentRef.instance['onMonthChange']('2026-11');
    fixture.componentRef.instance['fyBonuses'].set([...store]);
    await settle();
    await settle();
    expect([...el().querySelectorAll('button')].some((b) => b.textContent?.trim() === '削除')).toBe(false);
    const sel = el().querySelector('select[name=employeeId]') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date, amount] = [el().querySelector('form input[name=paidDate]'), el().querySelector('form input[name=amount]')] as HTMLInputElement[];
    date.value = '2026-12-20';
    date.dispatchEvent(new Event('input'));
    amount.value = '100000';
    amount.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(store).toHaveLength(1);
    expect(el().textContent).toContain('この月は確定済みです');
  });

  it('削除できる', async () => {
    const del = [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === '削除') as HTMLButtonElement;
    del.click();
    await settle();
    expect(store).toHaveLength(0);
    expect(el().textContent).toContain('この月に支給する賞与は登録されていません。');
  });

  it('二以上事業所勤務の人は、全事業所の賞与額の合計を登録すると、決定後の過不足を出す', async () => {
    store.push({ id: 'b9', employeeId: 'e3', paidDate: '2026-12-10', amount: 1_000_000 });
    fixture.componentInstance['onMonthChange']('2026-12');
    await fixture.componentInstance['loadBonuses'](true);
    await settle();
    const row = () => [...el().querySelectorAll('table.persons tbody tr')].find((tr) => tr.textContent!.includes('兼務 役員')) as HTMLElement;
    ([...row().querySelectorAll('button')].find((b) => b.textContent!.includes('全事業所の合計を登録')) as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = row().querySelector('input[name=totalAmount]') as HTMLInputElement;
    input.value = '2,000,000';
    input.dispatchEvent(new Event('input'));
    ([...row().querySelectorAll('button')].find((b) => b.textContent!.trim() === '保存') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(store.find((b) => b.id === 'b9')!.totalAmount).toBe(2_000_000);
    expect(row().textContent).toContain('決定後の過不足 -22,875円（返金）');
  });
});
