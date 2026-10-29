import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { SalaryRecord } from '../../core/calc/salary';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { RevisionList } from './revision-list';

describe('RevisionList', () => {
  let fixture: ComponentFixture<RevisionList>;
  let employee: EmployeeRecord;
  let added: unknown[];
  let saved: { id: string; status: string }[];

  const salaries: SalaryRecord[] = ['2026-07', '2026-08', '2026-09', '2026-10'].map((ym, i) => ({
    id: ym, employeeId: 'e1', paidDate: `${ym}-25`, fixedWages: i === 0 ? 300_000 : 340_000,
    nonFixedWages: i === 0 ? 0 : 20_000, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
  }));

  beforeEach(async () => {
    added = [];
    saved = [];
    employee = {
      id: 'e1', employeeNumber: '0001', name: '山田 太郎', birthDate: '1980-05-10',
      qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
      leaves: [], exemptions: [],
      assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
      standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
    };
    await TestBed.configureTestingModule({
      imports: [RevisionList],
      providers: [
        provideRouter([]),
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [employee],
            addStandard: async (_id: string, input: { validFrom: string; healthStandard: number; pensionStandard: number }, rem: number) => {
              added.push({ ...input, remuneration: rem });
              employee = { ...employee, standardHistory: [...employee.standardHistory, input] };
            },
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadGradeThresholds: async () => buildKyokaiThresholds('2020-09'),
          },
        },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS } },
        { provide: SalaryRepository, useValue: { loadRange: async () => salaries } },
        {
          provide: RevisionRepository,
          useValue: {
            loadStatuses: async () => saved,
            setStatus: async (c: { id: string }, status: string) => {
              saved = [...saved.filter((x) => x.id !== c.id), { id: c.id, status }];
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RevisionList);
    fixture.componentRef.instance['thisMonth'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('3か月の報酬・平均・見込みの等級・適用見込み月を出す', () => {
    const text = el().querySelector('table.candidates tbody')!.textContent!;
    expect(text).toContain('山田 太郎');
    expect(text).toContain('2026-08（昇給）');
    expect(text).toContain('360,000');
    expect(text).toContain('22等級 300,000 → 25等級 360,000（+3）');
    expect(text).toContain('2026-11分から');
  });

  it('「見込みどおり登録」で標準報酬月額の履歴を足し、一覧から消える', async () => {
    ([...el().querySelectorAll('table.candidates button')].find((b) => b.textContent!.includes('見込みどおり登録')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(added).toEqual([
      { validFrom: '2026-11', reason: 'revision', healthStandard: 360_000, pensionStandard: 360_000, remuneration: 360_000 },
    ]);
    expect(el().querySelector('table.candidates tbody')!.textContent).toContain('対応が必要な随時改定の候補はいません。');
    expect(el().textContent).toContain('登録済み（1）');
  });

  const button = (label: string) =>
    [...el().querySelectorAll('table.candidates button')].find((b) => b.textContent!.includes(label)) as HTMLButtonElement;
  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('「届出済みにする」で状態を保存し、対応中のまま届出済みになる', async () => {
    button('届出済みにする').click();
    await settle();
    expect(saved).toEqual([{ id: 'e1_2026-08_revision', status: 'filed' }]);
    expect(el().querySelector('table.candidates tbody')!.textContent).toContain('届出済み');
    expect(el().textContent).toContain('未対応 0・届出済み 1');
  });

  it('「確認済みにする」で対応中から消え、確認済みのタブで「未対応に戻す」ができる', async () => {
    button('確認済みにする').click();
    await settle();
    expect(el().querySelector('table.candidates tbody')!.textContent).toContain('対応が必要な随時改定の候補はいません。');
    ([...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes('確認済み')) as HTMLButtonElement).click();
    await settle();
    button('未対応に戻す').click();
    await settle();
    expect(saved).toEqual([{ id: 'e1_2026-08_revision', status: 'open' }]);
  });
});
