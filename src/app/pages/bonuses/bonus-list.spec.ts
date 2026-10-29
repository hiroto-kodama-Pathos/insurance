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
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS } },
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

  it('登録した賞与の保険料と、賞与支払届の期限を表示する', () => {
    const text = el().querySelector('table.persons tbody')!.textContent!;
    expect(text).toContain('山田 太郎');
    expect(text).toContain('24,625'); // 健康保険の本人負担
    expect(text).toContain('45,750'); // 厚生年金の本人負担
    expect(el().querySelector('table.reports')!.textContent).toContain('2026-12-15');
  });

  it('登録すると一覧に加わり、喪失月の賞与は保険料なしでも届出に数える', async () => {
    const sel = el().querySelector('select') as HTMLSelectElement;
    sel.value = 'e2';
    sel.dispatchEvent(new Event('change'));
    const [date, amount] = el().querySelectorAll('form input') as NodeListOf<HTMLInputElement>;
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
    fixture.componentRef.instance['onMonthChange']('2026-12');
    await settle();
    await settle();
    expect([...el().querySelectorAll('button')].some((b) => b.textContent?.trim() === '削除')).toBe(false);
    const sel = el().querySelector('select') as HTMLSelectElement;
    sel.value = 'e1';
    sel.dispatchEvent(new Event('change'));
    const [date, amount] = el().querySelectorAll('form input') as NodeListOf<HTMLInputElement>;
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
