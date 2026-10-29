import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Masters } from '../../core/calc/employee-month';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { addMonths, Home } from './home';

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
const person = (id: string, name: string, birthDate: string, std = true): EmployeeRecord => ({
  id,
  employeeNumber: id,
  name,
  birthDate,
  qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
  leaves: [],
  exemptions: [],
  assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
  standardHistory: std ? [{ validFrom: '2020-04', healthStandard: 300_000, pensionStandard: 300_000 }] : [],
});

describe('Home', () => {
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              person('0001', '四十 なる', '1986-11-10'),
              person('0002', '来月 七十', '1956-12-10'),
              person('0003', '未登録 さん', '1990-01-01', false),
            ],
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => masters,
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadGradeThresholds: async () => buildKyokaiThresholds('2020-09'),
          },
        },
        { provide: RevisionRepository, useValue: { loadStatuses: async () => [] } },
        { provide: AdjustmentRepository, useValue: { loadSettlements: async () => [] } },
        {
          provide: SalaryRepository,
          useValue: {
            // 0001 は8月に昇給（30万→36万）。8〜10月の平均36万円で、11月分から改定の見込み
            loadRange: async () =>
              ['2026-07', '2026-08', '2026-09', '2026-10'].map((ym, i) => ({
                id: ym, employeeId: '0001', paidDate: `${ym}-25`, fixedWages: i === 0 ? 300_000 : 360_000,
                nonFixedWages: 0, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
              })),
          },
        },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS } },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [], loadRecent: async () => [] } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Home);
    fixture.componentRef.instance['thisMonth'].set('2026-11');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('今月・来月に年齢で切り替わる人を出す', () => {
    expect(el().querySelector('table.age-this')!.textContent).toContain('四十 なる');
    expect(el().querySelector('table.age-this')!.textContent).toContain('介護保険料がかかります');
    expect(el().querySelector('table.age-next')!.textContent).toContain('来月 七十');
  });

  it('保険料を計算できない人と、前月の未確定を出す', () => {
    expect(el().querySelector('table.problems')!.textContent).toContain('標準報酬月額が未登録');
    expect(el().querySelector('.unclosed')!.textContent).toContain('本社');
    expect(el().textContent).toContain('2026-10分の未確定 1件');
  });

  it('随時改定の候補の件数を出す', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('改定の候補 1件');
  });

  it('7〜9月以外は、定時決定のチップを出さない', () => {
    expect(el().querySelector('.chips')!.textContent).not.toContain('定時決定');
  });

  it('今月の給与で控除しきれない人の件数を出す（給与のない人は判定しない）', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('今月の給与で控除不足 0人');
    expect(el().querySelector('table.deductions')!.textContent).toContain('いません');
  });

  it('月の足し引き', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});
