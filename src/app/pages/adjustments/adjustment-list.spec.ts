import { Confirm, ConfirmRequest } from '../../core/ui/confirm';
import { legacyGroup } from '../../core/calc/payroll-group';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettlementRecord } from '../../core/calc/adjustment';
import { buildOfficeClosing } from '../../core/calc/closing';
import { calcEmployeeMonth, Masters } from '../../core/calc/employee-month';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { AdjustmentList } from './adjustment-list';

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
const yamada = (): EmployeeRecord => ({
  id: 'e1', employeeNumber: '0001', name: '山田 太郎', birthDate: '1995-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 280_000, pensionStandard: 280_000 }],
});


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('AdjustmentList', () => {
  let fixture: ComponentFixture<AdjustmentList>;
  let settlements: SettlementRecord[];

  beforeEach(async () => {
    settlements = [];
    // 7月分を28万円で確定したあと、7月分から34万円とする決定通知が届いた
    const before = yamada();
    const closing = { ...buildOfficeClosing('2026-07', 'honsha', [{ employee: before, result: calcEmployeeMonth(before, masters, '2026-07') }], 'u1'), closedAt: null };
    const after = yamada();
    after.standardHistory.push({ validFrom: '2026-07', healthStandard: 340_000, pensionStandard: 340_000 });
    await TestBed.configureTestingModule({
      imports: [AdjustmentList],
      providers: [
        confirmStub,
        provideRouter([]),
        { provide: EmployeeRepository, useValue: { loadAll: async () => [after] } },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] } },
        { provide: ClosingRepository, useValue: { loadRecent: async () => [closing] } },
        {
          provide: AdjustmentRepository,
          useValue: {
            loadSettlements: async () => settlements,
            settle: async (a: { id: string; remaining: SettlementRecord['entries'][0]['diffs'] }, month: string) => {
              settlements = [{ id: a.id, entries: [{ settledMonth: month, diffs: a.remaining }] }];
            },
            unsettle: async (id: string) => {
              settlements = settlements.filter((s) => s.id !== id);
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdjustmentList);
    fixture.componentRef.instance['thisMonth'].set('2026-08');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('確定済みの月の差額を、理由・確定時と今の標準報酬月額・保険ごとの本人負担の差額つきで出す', () => {
    const text = el().querySelector('table.adjustments tbody')!.textContent!;
    expect(text).toContain('2026年7月');
    expect(text).toContain('標準報酬月額のさかのぼる改定');
    expect(text).toContain('28万円 → 34万円');
    expect(text).toContain('+2,955');
    expect(text).toContain('+5,490');
    expect(text).toContain('+8,514');
    expect(el().textContent).toContain('未精算（1）');
  });

  it('精算する給与の月を記録すると、精算済みに移る', async () => {
    (el().querySelector('table.adjustments button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(settlements[0].entries[0].settledMonth).toBe('2026-09');
    expect(el().textContent).toContain('未精算（0）');
    expect(el().textContent).toContain('2026年9月の給与で精算済みにしました。');
  });

  it('精算済みにした差額を、未精算に戻せる（精算した給与の月の誤りなど）', async () => {
    (el().querySelector('table.adjustments button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('精算済み（1）'))!.click();
    fixture.detectChanges();
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === '未精算に戻す')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(settlements).toEqual([]);
    expect(el().textContent).toContain('未精算（1）');
    expect(el().textContent).toContain('未精算に戻しました');
  });
});
