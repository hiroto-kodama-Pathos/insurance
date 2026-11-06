import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { OfficeClosing } from '../../core/calc/closing';
import { SalaryMapping, templateCsv } from '../../core/calc/salary-import';
import { SalaryRecord } from '../../core/calc/salary';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { SalaryImport } from './salary-import';

const person = (id: string, no: string, name: string): EmployeeRecord => ({
  id, employeeNumber: no, name, birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [],
});

describe('SalaryImport', () => {
  let fixture: ComponentFixture<SalaryImport>;
  let saved: { salary: Omit<SalaryRecord, 'id'>; officeId: string; overwrite: boolean }[];
  /** 支払区分を読めない */
  let groupsFail: boolean;
  /** CSVの書き込みの結果（ほかの担当者が先に登録した行・途中で失敗した件数） */
  let saveResult: { conflicts: number; failed: number };
  let savedMapping: SalaryMapping | null;
  let existing: SalaryRecord[];
  let closings: OfficeClosing[];
  let isAdmin: boolean;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [SalaryImport],
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: { user: signal({ uid: 'u1', email: '', siRole: isAdmin ? 'admin' : 'staff', siScope: 'all' }), isAdmin: signal(isAdmin) },
        },
        { provide: EmployeeRepository, useValue: { loadAll: async () => [person('e1', '0001', '山田 太郎'), person('e2', '0002', '佐藤 花子')] } },
        {
          provide: MasterRepository,
          useValue: { loadMasters: async () => ({ offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }], insurers: [], insurerRates: [], pensionRates: [] }) },
        },
        {
          provide: SettingsRepository,
          useValue: {
            loadSalaryMapping: async () => savedMapping,
            loadPayrollGroups: async () => {
              if (groupsFail) throw new Error('permission-denied');
              return [{ id: 'g1', name: '月給', cutoffDay: 'end', paidIn: 'nextMonth', deductionTiming: 'nextMonth', payDay: 25, isDefault: true }];
            },
            saveSalaryMapping: async (m: SalaryMapping) => {
              savedMapping = m;
            },
          },
        },
        { provide: ClosingRepository, useValue: { loadMonth: async (ym: string) => closings.filter((c) => c.yearMonth === ym) } },
        {
          provide: SalaryRepository,
          useValue: {
            loadRange: async () => existing,
            saveMany: async (items: typeof saved) => {
              const ok = items.slice(0, items.length - saveResult.failed);
              const conflicts = ok.slice(0, saveResult.conflicts).map((x) => x.salary);
              saved.push(...ok.slice(saveResult.conflicts));
              return { saved: ok.length - conflicts.length, conflicts, failed: saveResult.failed, error: saveResult.failed ? new Error('x') : null };
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SalaryImport);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    groupsFail = false;
    saveResult = { conflicts: 0, failed: 0 };
    saved = [];
    savedMapping = null;
    existing = [];
    closings = [];
    isAdmin = false;
  });

  const el = () => fixture.nativeElement as HTMLElement;
  async function load(text: string) {
    await fixture.componentInstance.loadText('test.csv', text);
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const importButton = () => [...el().querySelectorAll('button')].find((b) => b.textContent!.includes('件を取り込む')) as HTMLButtonElement;

  it('テンプレートの形式は対応づけなしでプレビューし、取り込める', async () => {
    await setup();
    await load(templateCsv() + '2,2026/10/25,30,"260,000",10000,,\r\n0009,2026-10-25,30,1,0,,\r\n');
    expect(el().textContent).toContain('テンプレートの形式のため、列の対応づけは不要です');
    expect(el().textContent).toContain('新規 2件・上書き 0件・エラー 1件');
    expect(el().querySelector('table.preview')!.textContent).toContain('登録されていない社員番号です（0009）');
    expect(importButton().textContent).toContain('2件を取り込む');
    importButton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saved.map((s) => s.salary.employeeId)).toEqual(['e1', 'e2']);
    expect(saved[1].salary.fixedWages).toBe(260_000);
    expect(el().textContent).toContain('2件の給与を取り込みました。取り込まなかった行は1件です。');
  });

  it('登録済みの給与は、上書きを選んだときだけ取り込む', async () => {
    existing = [{ id: 'e1_2026-10-25', employeeId: 'e1', paidDate: '2026-10-25', fixedWages: 1, nonFixedWages: 0, paymentBaseDays: 31, retroactiveDiff: null, inKindWages: null }];
    await setup();
    await load(templateCsv());
    expect(el().textContent).toContain('上書き 1件');
    expect(importButton().disabled).toBe(true);
    (el().querySelector('input[name="overwrite"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(importButton().textContent).toContain('1件を取り込む');
  });

  it('確定済みの月の行は取り込まない', async () => {
    closings = [{ yearMonth: '2026-10', officeId: 'honsha' } as OfficeClosing];
    await setup();
    await load(templateCsv());
    expect(el().textContent).toContain('確定済み 1件');
    expect(importButton().disabled).toBe(true);
  });

  it('給与ソフトの形式は、管理者が列を対応づけて保存すると、次から使える', async () => {
    isAdmin = true;
    await setup();
    const csv = '従業員コード,支給日,出勤日数,基本給,通勤手当,残業手当\r\n1,2026/10/25,31,300000,15000,20000\r\n';
    await load(csv);
    expect(el().textContent).toContain('列の対応づけを設定してください');
    const select = (name: string, value: string) => {
      const s = el().querySelector(`select[name="${name}"]`) as HTMLSelectElement;
      s.value = value;
      s.dispatchEvent(new Event('change'));
    };
    const check = (name: string) => (el().querySelector(`input[name="${name}"]`) as HTMLInputElement).click();
    select('employeeNumber', '従業員コード');
    select('paidDate', '支給日');
    select('paymentBaseDays', '出勤日数');
    check('fixedWages:基本給');
    check('fixedWages:通勤手当');
    check('nonFixedWages:残業手当');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('新規 1件');
    expect(el().querySelector('table.preview')!.textContent).toContain('315,000');
    ([...el().querySelectorAll('button')].find((b) => b.textContent!.includes('この対応づけを保存')) as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(savedMapping!.fixedWages).toEqual(['基本給', '通勤手当']);
  });

  it('支払区分を読めないときは、算定から除く額のチェックを飛ばして取り込まず、画面を止める', async () => {
    groupsFail = true;
    await setup();
    expect(el().textContent).toContain('読み込めませんでした');
    expect(importButton()).toBeUndefined();
  });

  it('同じ列を固定的賃金と非固定的賃金の両方に選ぶと、取り込まない（二重に数えるため）', async () => {
    isAdmin = true;
    savedMapping = {
      employeeNumber: '従業員コード', paidDate: '支給日', paymentBaseDays: '出勤日数',
      fixedWages: ['基本給'], nonFixedWages: ['基本給'], retroactiveDiff: '', inKindWages: '',
    };
    await setup();
    await load('従業員コード,支給日,出勤日数,基本給\r\n1,2026/10/25,31,300000\r\n');
    expect(el().textContent).toContain('「基本給」の列を、固定的賃金と非固定的賃金の両方に選んでいます');
    expect(el().querySelector('table.preview')).toBeNull();
    const save = [...el().querySelectorAll('button')].find((b) => b.textContent!.includes('この対応づけを保存')) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('確認のあとにほかの担当者が登録した行は上書きせず、途中で書けなかった件数も出す（ファイルは残す）', async () => {
    saveResult = { conflicts: 1, failed: 1 };
    await setup();
    await load(templateCsv() + '2,2026/10/25,30,260000,10000,,\r\n0001,2026-10-26,30,1,0,,\r\n');
    importButton().click();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    const text = el().textContent!;
    expect(text).toContain('1件の給与を取り込みました。');
    expect(text).toContain('1件は、確認のあとにほかの担当者が同じ支払日の給与を登録したため、上書きせずに取り込んでいません（山田 太郎さん 2026年10月25日）');
    expect(text).toContain('1件は、途中で書き込めなかったため取り込めていません');
    expect(el().querySelector('table.preview')).not.toBeNull();
    expect(saved.map((x) => x.overwrite)).toEqual([false]);
  });
});
