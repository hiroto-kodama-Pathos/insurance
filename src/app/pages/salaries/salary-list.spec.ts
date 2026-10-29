import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OfficeClosing } from '../../core/calc/closing';
import { Masters } from '../../core/calc/employee-month';
import { SalaryRecord } from '../../core/calc/salary';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { salaryDocId, SalaryRepository } from '../../core/repository/salary-repository';
import { SalaryList } from './salary-list';

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

describe('SalaryList', () => {
  let fixture: ComponentFixture<SalaryList>;
  let store: SalaryRecord[];
  let closings: OfficeClosing[];

  beforeEach(async () => {
    store = [sal('e1', '2026-09-25', 300_000)];
    closings = [];
    await TestBed.configureTestingModule({
      imports: [SalaryList],
      providers: [
        provideRouter([]),
        { provide: EmployeeRepository, useValue: { loadAll: async () => [person('e1', '0001', '山田 太郎'), person('e2', '0002', '佐藤 花子')] } },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
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

  it('資格のある人を並べ、前月の固定的賃金を出す', () => {
    expect(row('山田 太郎').textContent).toContain('300,000');
    expect(el().textContent).toContain('入力済み 0 / 2人');
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
    expect(el().textContent).toContain('山田 太郎さんの給与（2026-10-25支払）を保存しました。');
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
