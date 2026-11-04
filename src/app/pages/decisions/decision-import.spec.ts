import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { DECISION_TEMPLATE_HEADERS, DecisionMapping, DecisionToSave } from '../../core/calc/decision-import';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { legacyGroup } from '../../core/calc/payroll-group';
import { SalaryRecord } from '../../core/calc/salary';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { DecisionImport } from './decision-import';

const person = (id: string, no: string, name: string, std: number, extra: Partial<EmployeeRecord> = {}): EmployeeRecord => ({
  id, employeeNumber: no, name, birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: std, pensionStandard: std }],
  ...extra,
});
// 山田さんは8月に昇給（30万→34万＋残業2万）：11月分から36万円の見込み
const salaries: SalaryRecord[] = ['2026-07', '2026-08', '2026-09', '2026-10'].map((ym, i) => ({
  id: ym, employeeId: 'e1', paidDate: `${ym}-25`, fixedWages: i === 0 ? 300_000 : 340_000, nonFixedWages: i === 0 ? 0 : 20_000,
  paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
}));

describe('DecisionImport', () => {
  let fixture: ComponentFixture<DecisionImport>;
  let saved: DecisionToSave[];
  let savedMapping: DecisionMapping | null;

  beforeEach(async () => {
    saved = [];
    savedMapping = null;
    await TestBed.configureTestingModule({
      imports: [DecisionImport],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'admin', siScope: 'all' }), isAdmin: signal(true) } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              person('e1', '0001', '山田 太郎', 300_000),
              person('e2', '0002', '佐藤 花子', 260_000, {
                standardHistory: [
                  { validFrom: '2024-04', healthStandard: 260_000, pensionStandard: 260_000 },
                  { id: 'p1', validFrom: '2026-11', healthStandard: 280_000, pensionStandard: 280_000, provisional: true },
                ],
              }),
            ],
            saveDecisions: async (items: DecisionToSave[]) => {
              saved.push(...items);
            },
          },
        },
        { provide: MasterRepository, useValue: { loadGrades: async () => buildKyokaiGrades('2020-09'), loadGradeThresholds: async () => buildKyokaiThresholds('2020-09') } },
        { provide: SalaryRepository, useValue: { loadRange: async () => salaries } },
        {
          provide: SettingsRepository,
          useValue: {
            loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)],
            loadDecisionMapping: async () => savedMapping,
            saveDecisionMapping: async (m: DecisionMapping) => {
              savedMapping = m;
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DecisionImport);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  async function load(text: string) {
    await fixture.componentInstance.loadText('通知書.csv', text);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('見込みどおりの人は隠し、見込みと違う人・見込みのない人だけを出して、まとめて登録する', async () => {
    await load([DECISION_TEMPLATE_HEADERS.join(','), '0001,山田 太郎,1980-05-10,2026-11,360,360', '0002,佐藤 花子,1980-05-10,2026-11,300,300'].join('\n'));
    expect(el().querySelector('.counts')!.textContent).toContain('新しく登録 1件・通知書待ちを確定 1件');
    expect(el().querySelector('.counts')!.textContent).toContain('見込みと違う人 1人');
    const body = el().querySelector('table.preview tbody')!.textContent!;
    expect(body).not.toContain('山田 太郎');
    expect(body).toContain('佐藤 花子');
    expect(body).toContain('見込みと違う');
    // すべて表示に切り替えると、山田さんも出る
    const only = el().querySelector('input[name=onlyDiffers]') as HTMLInputElement;
    only.checked = false;
    only.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el().querySelector('table.preview tbody')!.textContent).toContain('山田 太郎');

    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('件を登録する')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saved).toEqual([
      { employeeId: 'e1', validFrom: '2026-11', reason: 'revision', healthStandard: 360_000, pensionStandard: 360_000, provisionalId: null },
      { employeeId: 'e2', validFrom: '2026-11', reason: 'revision', healthStandard: 300_000, pensionStandard: 300_000, provisionalId: 'p1' },
    ]);
    expect(el().querySelector('.notice')!.textContent).toContain('2件の標準報酬月額を登録しました（うち通知書待ちの確定 1件）');
  });

  it('テンプレートと違う形式は、列を対応づけてから取り込む（管理者は対応づけを保存できる）', async () => {
    await load(['被保険者整理番号,社員No,適用年月日,健保標準報酬,厚年標準報酬', '12,0001,R8.11.1,360,360'].join('\n'));
    expect(el().textContent).toContain('列の対応づけを設定してください');
    const pick = (name: string, value: string) => {
      const s = el().querySelector(`select[name=${name}]`) as HTMLSelectElement;
      s.value = value;
      s.dispatchEvent(new Event('change'));
    };
    pick('employeeNumber', '社員No');
    pick('validFrom', '適用年月日');
    pick('healthStandard', '健保標準報酬');
    pick('pensionStandard', '厚年標準報酬');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('.counts')!.textContent).toContain('新しく登録 1件');
    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('この対応づけを保存')) as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(savedMapping).toMatchObject({ employeeNumber: '社員No', validFrom: '適用年月日', healthStandard: '健保標準報酬' });
  });
});
