import { SalaryRepository } from '../../../core/repository/salary-repository';
import { AdjustmentRepository } from '../../../core/repository/adjustment-repository';
import { SalaryRecord } from '../../../core/calc/salary';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Masters } from '../../../core/calc/employee-month';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { signal } from '@angular/core';
import { Auth } from '../../../core/auth/auth';
import { OfficeClosing } from '../../../core/calc/closing';
import { BonusRepository } from '../../../core/repository/bonus-repository';
import { ClosingRepository } from '../../../core/repository/closing-repository';
import { MonthlyList } from './monthly-list';

// Firestore につながず、固定のデータを返す
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

const employees: EmployeeRecord[] = [
  {
    id: 'e1',
    employeeNumber: '0001',
    name: '山田 太郎',
    birthDate: '1980-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [],
    exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
  },
  {
    id: 'e2',
    employeeNumber: '0002',
    name: '退職 済子',
    birthDate: '1990-01-01',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: '2026-04-01' }],
    leaves: [],
    exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 200_000, pensionStandard: 200_000 }],
  },
];

describe('MonthlyList', () => {
  let fixture: ComponentFixture<MonthlyList>;
  let saved: OfficeClosing[];
  let bonuses: { id: string; employeeId: string; paidDate: string; amount: number }[];
  let scope: string;
  let salaries: SalaryRecord[];

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [MonthlyList],
      providers: [
        { provide: EmployeeRepository, useValue: { loadAll: async () => employees } },
        {
          provide: SettingsRepository,
          useValue: { loadSettings: async () => DEFAULT_SETTINGS },
        },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        {
          provide: ClosingRepository,
          useValue: {
            loadMonth: async (ym: string) => saved.filter((c) => c.yearMonth === ym),
            close: async (c: OfficeClosing) => {
              saved.push({ ...c, closedAt: '2026-10-25T01:00:00.000Z' });
            },
            reopen: async (ym: string, officeId: string) => {
              saved = saved.filter((c) => !(c.yearMonth === ym && c.officeId === officeId));
            },
          },
        },
        { provide: BonusRepository, useValue: { loadFiscalYear: async () => bonuses } },
        { provide: SalaryRepository, useValue: { loadRange: async () => salaries } },
        { provide: AdjustmentRepository, useValue: { loadSettlements: async () => [] } },
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'staff', siScope: scope }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthlyList);
    fixture.componentRef.instance['yearMonth'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    saved = [];
    bonuses = [];
    scope = 'all';
    salaries = [];
    await setup();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
  async function click(text: string) {
    button(text)!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('確定すると結果を保存し、後から標準報酬月額を直しても確定した金額のまま表示する', async () => {
    expect(el().textContent).toContain('一部未確定');
    await click('確定');
    expect(saved).toHaveLength(1);
    expect(saved[0].officeId).toBe('honsha');
    expect(saved[0].rows[0].premiums.health?.employeeYen).toBe(14775);
    expect(el().textContent).toContain('すべて確定済み');

    // 確定後に標準報酬月額を 50万円に直した
    employees[0].standardHistory = [{ validFrom: '2024-04', healthStandard: 500_000, pensionStandard: 500_000 }];
    TestBed.resetTestingModule();
    await setup();
    expect(el().querySelector('table.persons tbody tr.closed')).toBeTruthy();
    expect(el().textContent).toContain('14,775');
    employees[0].standardHistory = [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }];
  });

  it('その月の賞与も一緒に確定する', async () => {
    bonuses = [{ id: 'b1', employeeId: 'e1', paidDate: '2026-10-15', amount: 500_000 }];
    TestBed.resetTestingModule();
    await setup();
    expect(el().textContent).toContain('賞与 1件を含む');
    await click('確定');
    expect(saved[0].bonusRows).toHaveLength(1);
    expect(saved[0].bonusRows[0].premiums?.health?.employeeYen).toBe(24625);
    expect(saved[0].bonusTotals.pension.employeeTotal).toBe(45750);
  });

  it('確定を解除すると、計算し直した金額に戻る', async () => {
    await click('確定');
    await click('確定を解除');
    expect(saved).toHaveLength(0);
    expect(el().textContent).toContain('一部未確定');
  });

  it('担当範囲の外の事業所には確定ボタンを出さない', async () => {
    TestBed.resetTestingModule();
    scope = 'osaka';
    await setup();
    expect(button('確定')).toBeUndefined();
  });

  it('資格のある人だけを、保険ごとの本人負担・会社負担つきで表示する', () => {
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('table.persons tbody tr');
    const text = rows[0].textContent ?? '';
    expect(rows.length).toBeGreaterThan(0);
    expect(text).toContain('山田 太郎');
    expect(text).toContain('14,775'); // 健康保険の本人負担
    expect(text).toContain('27,450'); // 厚生年金の本人負担
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('退職 済子');
  });

  it('控除する給与の月と、給与で本人負担を控除しきれるかを出す', async () => {
    const text = () => (el().querySelector('table.persons tbody tr') as HTMLElement).textContent ?? '';
    expect(el().textContent).toContain('10月分保険料（11月支給給与から控除）');
    expect(text()).toContain('11月支給');
    expect(text()).toContain('給与未入力');
    const pay = (fixed: number): SalaryRecord => ({
      id: 'e1_2026-11-25', employeeId: 'e1', paidDate: '2026-11-25', fixedWages: fixed, nonFixedWages: 0,
      paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
    });
    salaries = [pay(0)];
    await fixture.componentInstance['loadClosings']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toMatch(/控除不足 4\d,\d{3}円/);
    salaries = [pay(60_000)];
    await fixture.componentInstance['loadClosings']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('注意（給与の60%超）');
  });

  it('適用事業所別の小計を表示する', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('適用事業所別の小計');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('本社');
  });
});
