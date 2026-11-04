import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth } from '../../core/auth/auth';
import { Masters } from '../../core/calc/employee-month';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { fiscalStart, PeriodTotals } from './period-totals';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '東京都', insurerId: 'kyokai' },
  ],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};
const person = (id: string, office: string): EmployeeRecord => ({
  id, employeeNumber: id, name: id, birthDate: '1990-01-01',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }], leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: office }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
});

describe('PeriodTotals', () => {
  let fixture: ComponentFixture<PeriodTotals>;
  let scope: string;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [PeriodTotals],
      providers: [
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'staff', siScope: scope }), isAdmin: signal(false) } },
        { provide: EmployeeRepository, useValue: { loadAll: async () => [person('e1', 'honsha'), person('e2', 'osaka')] } },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS } },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [] } },
        {
          provide: BonusRepository,
          useValue: { loadFiscalYear: async () => [{ id: 'b1', employeeId: 'e1', paidDate: '2026-10-10', amount: 500_000 }] },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PeriodTotals);
    fixture.componentRef.instance['from'].set('2026-09');
    fixture.componentRef.instance['to'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => (scope = 'all'));
  const el = () => fixture.nativeElement as HTMLElement;

  it('年度の初めの月', () => {
    expect(fiscalStart('2026-10')).toBe('2026-04');
    expect(fiscalStart('2027-02')).toBe('2026-04');
  });

  it('月別に月額・賞与・計を出し、未確定を含むことを示す', async () => {
    await setup();
    const t = el().querySelector('table.totals')!.textContent!;
    // 標準報酬月額30万円：健保14,775・支援金345・厚年27,450（会社負担も同額）× 2人
    expect(t).toContain('29,550');
    expect(t).toContain('85,140');
    // 10月の賞与50万円（e1）：健保24,625・支援金575・厚年45,750
    expect(t).toContain('70,950');
    expect(el().textContent).toContain('未確定の月を含みます');
    expect(el().querySelector('tfoot')!.textContent).toContain(String((85_140 * 2 + 70_950).toLocaleString('ja-JP')));
  });

  it('特定の事業所の担当者は、その事業所の分だけ', async () => {
    scope = 'osaka';
    await setup();
    expect(el().querySelector('tfoot')!.textContent).toContain((42_570 * 2).toLocaleString('ja-JP'));
    expect(el().querySelectorAll('select[name=office] option')).toHaveLength(1);
  });
});
