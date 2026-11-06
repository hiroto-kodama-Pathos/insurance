import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { buildKyokaiGrades } from '../../core/calc/grade-suggest';
import { legacyGroup } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeNumberTakenError, EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { MasterImportPage } from './master-import-page';

const yamada: EmployeeRecord = {
  id: 'e1', employeeNumber: '0001', name: '山田 太郎', birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }], leaves: [], exemptions: [],
  assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }], standardHistory: [],
};

describe('MasterImportPage', () => {
  let fixture: ComponentFixture<MasterImportPage>;
  let calls: unknown[][];
  let employees: EmployeeRecord[];
  let mappings: Record<string, Record<string, string> | null>;

  beforeEach(async () => {
    calls = [];
    employees = [yamada];
    mappings = { employee: null, standard: null, bonus: null };
    await TestBed.configureTestingModule({
      imports: [MasterImportPage],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'admin', siScope: 'all' }), isAdmin: signal(true) } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => employees,
            importEmployees: async (list: { employeeNumber: string }[]) => {
              // 担当外の事業所の人・ほかの担当者が先に使った番号（画面の一覧にはない）
              if (list.some((x) => x.employeeNumber === '0099')) throw new EmployeeNumberTakenError(['0099']);
              calls.push(['importEmployees', list]);
            },
            saveDecisions: async (list: unknown[]) => { calls.push(['saveDecisions', list]); },
            importDependents: async (list: unknown[]) => { calls.push(['importDependents', list]); },
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => ({ offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }], insurers: [], insurerRates: [], pensionRates: [] }),
            loadGrades: async () => buildKyokaiGrades('2020-09'),
          },
        },
        {
          provide: SettingsRepository,
          useValue: {
            loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)],
            loadBonusTypes: async () => [],
            loadCsvMapping: async (kind: string) => mappings[kind],
            saveCsvMapping: async (kind: string, m: Record<string, string>) => { calls.push(['saveCsvMapping', kind, m]); },
          },
        },
        {
          provide: BonusRepository,
          useValue: {
            loadRange: async () => [{ id: 'b1', employeeId: 'e1', paidDate: '2026-07-10', amount: 1 }],
            importMany: async (list: unknown[]) => { calls.push(['importMany', list]); },
          },
        },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [] } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MasterImportPage);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const page = () => fixture.componentRef.instance;
  const tab = (label: string) => [...el().querySelectorAll('button.tab')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  async function load(text: string) {
    await page().loadText('a.csv', text);
    fixture.detectChanges();
  }
  const importButton = () => el().querySelector('button.primary') as HTMLButtonElement;

  it('従業員：テンプレートのCSVなら対応づけなしでプレビューを出し、登録する', async () => {
    await load('社員番号,氏名,生年月日,適用事業所,入社日,資格取得日,被保険者区分,支払区分\r\n0101,青木 健,1985-04-01,本社,,2020-04-01,,\r\n0001,山田 太郎,1980-05-10,本社,,2020-04-01,,\r\n');
    expect(el().textContent).toContain('テンプレートの形式のため');
    expect(el().querySelector('.counts')!.textContent).toContain('新しく登録 1件・登録済み 1件・エラー 0件');
    importButton().click();
    await fixture.whenStable();
    expect(calls[0][0]).toBe('importEmployees');
    expect((calls[0][1] as { employeeNumber: string }[]).map((x) => x.employeeNumber)).toEqual(['0101']);
  });

  it('従業員：保存のときに使われていると分かった社員番号があれば、何も登録せず、その番号を知らせる', async () => {
    await load('社員番号,氏名,生年月日,適用事業所,入社日,資格取得日,被保険者区分,支払区分\r\n0101,青木 健,1985-04-01,本社,,2020-04-01,,\r\n0099,重複 番号,1985-04-01,本社,,2020-04-01,,\r\n');
    importButton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('社員番号 0099 はすでに登録されているため、取り込んでいません');
  });

  it('エラー・確定済み・担当範囲外の行だけを表示できる（登録する件数は変わらない）', async () => {
    await load('社員番号,氏名,生年月日,適用事業所,入社日,資格取得日,被保険者区分,支払区分\r\n0101,青木 健,1985-04-01,本社,,2020-04-01,,\r\n0102,,x,名古屋,,,,\r\n');
    const lines = () => [...el().querySelectorAll('table.preview tbody tr')].length;
    expect(lines()).toBe(2);
    const box = el().querySelector('input[name="onlyIssues"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(lines()).toBe(1);
    expect(el().querySelector('table.preview tbody')!.textContent).toContain('名古屋');
    expect(importButton().textContent).toContain('1件を登録する');
  });

  it('列の名前が違うCSVは、対応づけを選んでから取り込み、管理者は対応づけを保存できる', async () => {
    tab('標準報酬月額').click();
    fixture.detectChanges();
    await load('従業員番号,適用,健保,厚年\r\n1,2026-09,360,\r\n');
    expect(el().textContent).toContain('列の対応づけを設定してください');
    page()['setField']('employeeNumber', '従業員番号');
    page()['setField']('validFrom', '適用');
    page()['setField']('healthStandard', '健保');
    fixture.detectChanges();
    expect(el().querySelector('table.preview')!.textContent).toContain('2026年9月から 健康保険 360,000円・厚生年金 360,000円');
    await page()['saveMapping']();
    expect(calls[0]).toEqual(['saveCsvMapping', 'standard', { employeeNumber: '従業員番号', validFrom: '適用', healthStandard: '健保', pensionStandard: '' }]);
    importButton().click();
    await fixture.whenStable();
    expect(calls[1][0]).toBe('saveDecisions');
  });

  it('被扶養者：テンプレートのCSVで、本人の社員番号ごとに登録する', async () => {
    tab('被扶養者').click();
    fixture.detectChanges();
    await load('社員番号,被扶養者の氏名,被扶養者の生年月日,扶養に入った日,扶養から外れた日\r\n0001,山田 花子,1982-03-03,2024-04-01,\r\n');
    expect(el().querySelector('.counts')!.textContent).toContain('新しく登録 1件');
    importButton().click();
    await fixture.whenStable();
    expect(calls[0]).toEqual(['importDependents', [
      { employeeId: 'e1', name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2024-04-01', removedDate: null },
    ]]);
  });

  it('賞与：登録済みの支給日は取り込まない', async () => {
    tab('賞与').click();
    fixture.detectChanges();
    await load('社員番号,支給日,賞与額,うち現物,賞与の種類\r\n0001,2026-07-10,500000,,\r\n0001,2026-12-10,500000,,\r\n');
    expect(el().querySelector('.counts')!.textContent).toContain('新しく登録 1件・登録済み 1件');
    importButton().click();
    await fixture.whenStable();
    expect(calls[0]).toEqual(['importMany', [
      { employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000, inKindAmount: null, bonusTypeId: null, isRemuneration: false, officeId: 'honsha' },
    ]]);
  });
});
