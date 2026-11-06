import { BonusRepository } from '../../core/repository/bonus-repository';
import { Confirm } from '../../core/ui/confirm';
import { legacyGroup } from '../../core/calc/payroll-group';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { SalaryRecord } from '../../core/calc/salary';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { defaultRegularYear, RegularList } from './regular-list';

const person = (id: string, no: string, name: string, acquired = '2024-04-01'): EmployeeRecord => ({
  id, employeeNumber: no, name, birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: acquired, lostDate: null }],
  leaves: [], exemptions: [],
  assignments: [{ validFrom: acquired, officeId: 'honsha' }],
  standardHistory: [{ validFrom: acquired.slice(0, 7), healthStandard: 300_000, pensionStandard: 300_000 }],
});
const pay = (employeeId: string, ym: string, fixed: number, nonFixed: number, days = 30): SalaryRecord => ({
  id: `${employeeId}_${ym}`, employeeId, paidDate: `${ym}-25`, fixedWages: fixed, nonFixedWages: nonFixed,
  paymentBaseDays: days, retroactiveDiff: null, inKindWages: null,
});

describe('RegularList', () => {
  let fixture: ComponentFixture<RegularList>;
  let employees: EmployeeRecord[];
  let added: { id: string; validFrom: string; healthStandard: number }[];
  let removed: { employeeId: string; standardId: string; log: string }[] = [];

  beforeEach(async () => {
    added = [];
    removed = [];
    employees = [person('e1', '0001', '山田 太郎'), person('e2', '0002', '佐藤 花子'), person('e3', '0003', '六月 入社', '2026-06-10')];
    const salaries = [
      pay('e1', '2026-04', 300_000, 20_000), pay('e1', '2026-05', 300_000, 30_000), pay('e1', '2026-06', 300_000, 40_000),
      pay('e2', '2026-04', 300_000, 0), pay('e2', '2026-05', 150_000, 0, 10), pay('e2', '2026-06', 300_000, 0),
    ];
    await TestBed.configureTestingModule({
      imports: [RegularList],
      providers: [
        provideRouter([]),
        { provide: Confirm, useValue: { ask: async () => true } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => employees,
            addStandard: async (id: string, input: { validFrom: string; healthStandard: number; pensionStandard: number }) => {
              added.push({ id, validFrom: input.validFrom, healthStandard: input.healthStandard });
              employees = employees.map((e) => (e.id === id ? { ...e, standardHistory: [...e.standardHistory, { ...input, id: `s-${id}` }] } : e));
            },
            deleteStandards: async (list: { employeeId: string; standardId: string; log: string }[]) => {
              removed.push(...list);
              employees = employees.map((e) => ({ ...e, standardHistory: e.standardHistory.filter((h) => !list.some((x) => x.employeeId === e.id && x.standardId === (h as { id?: string }).id)) }));
            },
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadGradeThresholds: async () => buildKyokaiThresholds('2020-09'),
            loadMasters: async () => ({ offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }], insurers: [], insurerRates: [], pensionRates: [] }),
          },
        },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] } },
        { provide: SalaryRepository, useValue: { loadRange: async () => salaries } },
        { provide: BonusRepository, useValue: { loadRange: async () => [] } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RegularList);
    fixture.componentRef.instance['year'].set(2026);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const row = (name: string) => [...el().querySelectorAll('table.regular tbody tr')].find((tr) => tr.textContent!.includes(name)) as HTMLElement;

  it('7月以降はその年、1〜6月は前の年の定時決定を出す', () => {
    expect(defaultRegularYear('2026-07-01')).toBe(2026);
    expect(defaultRegularYear('2026-06-30')).toBe(2025);
  });

  it('4〜6月の報酬・平均・見込みの等級と、平均から除いた月の理由を出す。6月以降の入社者は出さない', () => {
    expect(row('山田 太郎').textContent).toContain('330,000');
    expect(row('山田 太郎').textContent).toContain('22等級 300,000 → 24等級 340,000');
    expect(row('佐藤 花子').textContent).toContain('除く：支払基礎日数が17日未満');
    expect(el().querySelector('table.regular')!.textContent).not.toContain('六月 入社');
    expect(el().textContent).toContain('対象外のため出していません');
  });

  it('一括登録で、全員の9月分からの標準報酬月額を登録する', async () => {
    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('一括登録')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(added).toEqual([
      { id: 'e1', validFrom: '2026-09', healthStandard: 340_000 },
      { id: 'e2', validFrom: '2026-09', healthStandard: 300_000 },
    ]);
    expect(row('山田 太郎').textContent).toContain('登録済み');
    expect(el().textContent).toContain('2人の2026年9月分からの標準報酬月額を登録しました。');
  });

  it('見込みどおり登録した人は、確かめてから登録を取り消せる（1人・表示中をまとめて）', async () => {
    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('一括登録')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    ([...row('山田 太郎').querySelectorAll('button')].find((b) => b.textContent!.includes('登録を取り消す')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(removed.map((x) => x.employeeId)).toEqual(['e1']);
    expect(removed[0].log).toContain('定時決定の登録を取り消しました（2026年9月からの標準報酬月額 健保 34万円');
    expect(row('山田 太郎').textContent).not.toContain('登録済み');
    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('人の登録を取り消す')) as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(removed.map((x) => x.employeeId)).toEqual(['e1', 'e2']);
  });
});
