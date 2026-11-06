import { provideRouter } from '@angular/router';
import { Confirm, ConfirmRequest } from '../../../core/ui/confirm';
import { FilingRepository } from '../../../core/repository/filing-repository';
let filed = new Set<string>();
import { legacyGroup } from '../../../core/calc/payroll-group';
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


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('MonthlyList', () => {
  let fixture: ComponentFixture<MonthlyList>;
  let saved: OfficeClosing[];
  let bonuses: { id: string; employeeId: string; paidDate: string; amount: number }[];
  let scope: string;
  let salaries: SalaryRecord[];

  async function setup(openPersons = true) {
    await TestBed.configureTestingModule({
      imports: [MonthlyList],
      providers: [
        confirmStub,
        provideRouter([]),
        { provide: FilingRepository, useValue: { loadFiledIds: async () => filed } },
        { provide: EmployeeRepository, useValue: { loadAll: async () => employees, clearCache: () => {} } },
        {
          provide: SettingsRepository,
          useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] },
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
    if (openPersons) {
      // 1人ずつの表は最初は閉じているので、「全員を表示」で開く
      ([...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.trim() === '全員を表示') as HTMLButtonElement).click();
      fixture.detectChanges();
    }
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

  it('確定できない理由は、社員番号・氏名・理由の表で出し、氏名は従業員の詳細へのリンクにする', async () => {
    employees.push({
      id: 'e3', employeeNumber: '0003', name: '未登録 花子', birthDate: '1990-01-01',
      qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }], leaves: [], exemptions: [],
      assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }], standardHistory: [],
    });
    try {
      TestBed.resetTestingModule();
      await setup();
      const card = el().querySelector('.office-card[data-office="honsha"]')!;
      expect(card.querySelector('.status')!.textContent).toContain('確定できません');
      const rows = [...card.querySelectorAll('table.blockers tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent!.trim()));
      expect(rows).toEqual([['0003', '未登録 花子', '標準報酬月額が未登録']]);
      expect(card.querySelector('table.blockers a')!.getAttribute('href')).toBe('/employees/e3');
      expect(card.querySelector('.blocker-count')!.textContent).toContain('確定できない理由（1件）');
    } finally {
      employees.pop();
    }
  });

  it('育休で免除の月は「育休免除（申出待ち）」、取得者申出書を届出済みにすると「育休免除」', async () => {
    const original = employees[0].leaves;
    employees[0].leaves = [{ type: 'childcare', startDate: '2026-09-01', endDate: null, workedDays: null }];
    TestBed.resetTestingModule();
    await setup();
    expect(el().querySelector('table.persons')!.textContent).toContain('育休免除（申出待ち）');
    filed = new Set(['e1_leave_2026-09-01']);
    TestBed.resetTestingModule();
    await setup();
    const t = el().querySelector('table.persons')!.textContent!;
    expect(t).toContain('育休免除');
    expect(t).not.toContain('申出待ち');
    employees[0].leaves = original;
    filed = new Set();
  });

  it('氏名から従業員の詳細を開ける', () => {
    const link = el().querySelector('table.persons tbody a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/employees/e1');
  });

  it('確定すると結果を保存し、後から標準報酬月額を直しても確定した金額のまま表示する', async () => {
    expect(el().textContent).toContain('一部未確定');
    await click('確定');
    expect(asked.at(-1)!.message).toContain('確定すると、その月の給与・賞与は変更できなくなります');
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

  it('開いたときは、会社合計と事業所別の小計を先に出し、1人ずつの表は閉じておく', async () => {
    TestBed.resetTestingModule();
    await setup(false);
    const text = el().textContent!;
    expect(text.indexOf('会社合計')).toBeLessThan(text.indexOf('適用事業所別の小計と確定'));
    expect(text.indexOf('適用事業所別の小計と確定')).toBeLessThan(text.indexOf('1人ずつの保険料'));
    expect(el().querySelector('table.persons')).toBeNull();
    expect(text).toContain('前月から保険料が変わった人を見る');
  });

  it('「この事業所の人を見る」で、その事業所の人だけの表を開く', async () => {
    TestBed.resetTestingModule();
    await setup(false);
    const b = [...el().querySelectorAll('button')].find((x) => x.textContent?.includes('この事業所の人を見る')) as HTMLButtonElement;
    b.click();
    fixture.detectChanges();
    expect(el().querySelector('table.persons')).not.toBeNull();
    expect((el().querySelector('select[name=office]') as HTMLSelectElement).value).toBe('honsha');
  });

  it('適用事業所別の小計を表示する', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('適用事業所別の小計');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('本社');
  });
});

describe('MonthlyList 並び替え・絞り込み', () => {
  it('氏名で検索し、前月から変わった人・入社した人で絞り込み、本人負担の大きい順に並べる', async () => {
    const p = (id: string, no: string, name: string, std: number, acquired = '2024-04-01', history = [{ validFrom: '2024-04', healthStandard: std, pensionStandard: std }]): EmployeeRecord => ({
      id, employeeNumber: no, name, birthDate: '1980-05-10',
      qualifications: [{ acquiredDate: acquired, lostDate: null }], leaves: [], exemptions: [],
      assignments: [{ validFrom: acquired, officeId: 'honsha' }], standardHistory: history,
    });
    const list = [
      p('a', '0001', '山田 太郎', 300_000),
      p('b', '0002', '佐藤 花子', 260_000, '2024-04-01', [{ validFrom: '2024-04', healthStandard: 260_000, pensionStandard: 260_000 }, { validFrom: '2026-10', healthStandard: 410_000, pensionStandard: 410_000 }]),
      p('c', '0003', '木村 拓也', 240_000, '2026-10-26', [{ validFrom: '2026-10', healthStandard: 240_000, pensionStandard: 240_000 }]),
    ];
    await TestBed.configureTestingModule({
      imports: [MonthlyList],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'admin', siScope: 'all' }), isAdmin: signal(true) } },
        { provide: FilingRepository, useValue: { loadFiledIds: async () => filed } },
        { provide: EmployeeRepository, useValue: { loadAll: async () => list, clearCache: () => {} } },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] } },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [] } },
        { provide: BonusRepository, useValue: { loadFiscalYear: async () => [] } },
        { provide: SalaryRepository, useValue: { loadRange: async () => [] } },
        { provide: AdjustmentRepository, useValue: { loadSettlements: async () => [] } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MonthlyList);
    fixture.componentRef.instance['yearMonth'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    ([...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === '全員を表示') as HTMLButtonElement).click();
    fixture.detectChanges();
    const names = () => [...el.querySelectorAll('table.persons tbody tr')].map((tr) => tr.children[1].textContent);
    const set = (name: string, value: string) => {
      const x = el.querySelector(`[name=${name}]`) as HTMLInputElement | HTMLSelectElement;
      x.value = value;
      x.dispatchEvent(new Event(x.tagName === 'SELECT' ? 'change' : 'input'));
      fixture.detectChanges();
    };

    expect(names()).toEqual(['山田 太郎', '佐藤 花子', '木村 拓也']);
    expect(el.textContent).toContain('前月から +');
    expect(el.textContent).toContain('標準報酬月額の改定');
    // 入社した人は前月の保険料がないので、差額ではなく「今月から加入」と出す（「前月から （入社…）」と途切れない）
    const kimura = [...el.querySelectorAll('table.persons tbody tr')].find((tr) => tr.textContent?.includes('木村 拓也'))!;
    expect(kimura.textContent).toContain('今月から加入（入社・資格取得）');
    expect(kimura.textContent).not.toContain('前月から');

    set('query', '佐藤花子');
    expect(names()).toEqual(['佐藤 花子']);
    set('query', '');

    set('extra', 'changed');
    expect(names()).toEqual(['佐藤 花子', '木村 拓也']);
    set('extra', 'joined');
    expect(names()).toEqual(['木村 拓也']);
    set('extra', '');

    set('sort', 'employeeTotal');
    const desc = el.querySelector('[name=desc]') as HTMLInputElement;
    desc.checked = true;
    desc.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(names()).toEqual(['佐藤 花子', '山田 太郎', '木村 拓也']);
    expect(el.textContent).toContain('3 / 3人');
  });
});
