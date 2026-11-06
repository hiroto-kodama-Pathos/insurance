import { provideRouter } from '@angular/router';
import { Confirm, ConfirmRequest } from '../../core/ui/confirm';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth } from '../../core/auth/auth';
import { Masters } from '../../core/calc/employee-month';
import { legacyGroup } from '../../core/calc/payroll-group';
import { DeductionLines, LineAmounts } from '../../core/calc/reconcile';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { ReconcileRepository } from '../../core/repository/reconcile-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { ReconcilePage } from './reconcile-page';

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

const person = (id: string, no: string, office: string, history = [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }]): EmployeeRecord => ({
  id, employeeNumber: no, name: `社員${no}`, birthDate: '1990-01-01',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }], leaves: [], exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: office }],
  standardHistory: history,
});


/** 確認ダイアログ：出した確認を記録し、「実行する」を押したことにする */
const asked: ConfirmRequest[] = [];
const confirmStub = { provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => { asked.push(r); return true; } } };
describe('ReconcilePage', () => {
  let fixture: ComponentFixture<ReconcilePage>;
  let scope: string;
  let notices: Map<string, LineAmounts>;
  let deductions: Map<string, DeductionLines>;
  let saved: { employeeId: string; officeId: string; amounts: DeductionLines }[];

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [ReconcilePage],
      providers: [
        confirmStub,
        provideRouter([]),
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: '', siRole: 'staff', siScope: scope }), isAdmin: signal(false) } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              person('e1', '0001', 'honsha'),
              // 10月に標準報酬月額の改定
              person('e2', '0002', 'honsha', [
                { validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 },
                { validFrom: '2026-10', healthStandard: 360_000, pensionStandard: 360_000 },
              ]),
              person('e3', '0003', 'osaka'),
            ],
          },
        },
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        {
          provide: SettingsRepository,
          useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] },
        },
        { provide: AdjustmentRepository, useValue: { loadSettlements: async () => [] } },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [] } },
        { provide: BonusRepository, useValue: { loadFiscalYear: async () => [] } },
        {
          provide: ReconcileRepository,
          useValue: {
            loadNotices: async () => notices,
            loadDeductions: async () => deductions,
            saveNotice: async (_ym: string, officeId: string, lines: LineAmounts) => { notices.set(officeId, lines); },
            removeNotice: async () => undefined,
            saveDeductions: async (_ym: string, list: { employeeId: string; officeId: string; amounts: DeductionLines }[]) => { saved.push(...list); },
            removeDeduction: async () => undefined,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReconcilePage);
    fixture.componentRef.instance['yearMonth'].set('2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    scope = 'all';
    // 本社：e1（30万円）＋ e2（36万円）。健保 29,550＋35,460＝65,010、支援金 690＋828＝1,518、厚年 54,900＋65,880＝120,780
    notices = new Map([['honsha', { healthCare: 65_110, childSupport: 1_518, pension: 120_780 }]]);
    deductions = new Map([
      ['e1', { health: 14_775, childSupport: 345, pension: 27_450 }],
      // 給与ソフトが改定前の額のまま
      ['e2', { health: 14_775, childSupport: 345, pension: 27_450 }],
    ]);
    saved = [];
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const office = (id: string) => el().querySelector(`[data-office=${id}]`) as HTMLElement;

  type Unsaved = { unsavedCount(): number };
  const unsaved = () => (fixture.componentInstance as unknown as Unsaved).unsavedCount();

  it('納付書の金額を変えたまま画面を移ろうとしたら確かめる。「やめる」・別の事業所の入力を開くときも、破棄してよいかを確かめる', async () => {
    await setup();
    const c = fixture.componentInstance as unknown as {
      editNotice(id: string): void | Promise<void>; setDraft(k: string, v: string): void; cancelEdit(): void | Promise<void>; editingOffice(): string | null;
    };
    asked.length = 0;
    c.editNotice('honsha');
    expect(unsaved()).toBe(0);
    // 変えていなければ、確かめずに閉じる
    await c.cancelEdit();
    expect(asked).toHaveLength(0);
    expect(c.editingOffice()).toBeNull();
    c.editNotice('honsha');
    c.setDraft('pension', '123456');
    expect(unsaved()).toBe(1);
    // 別の事業所の入力を開こうとすると確かめる（「破棄して閉じる」なら開く）
    await c.editNotice('osaka');
    expect(asked.map((a) => a.ok)).toEqual(['破棄して閉じる']);
    expect(c.editingOffice()).toBe('osaka');
    expect(unsaved()).toBe(0);
  });

  it('納付書との差と、原因の候補（前月から変わった人）を出す', async () => {
    await setup();
    const honsha = office('honsha').textContent!;
    expect(honsha).toContain('差あり');
    expect(honsha).toContain('+100');
    expect(honsha).toContain('0002 社員0002：標準報酬月額の改定');
    expect(honsha).not.toContain('0001 社員0001');
    expect(office('osaka').textContent).toContain('未入力');
  });

  it('納付書の金額を入力して保存すると、差が計算し直される', async () => {
    await setup();
    const button = [...office('osaka').querySelectorAll('button')].find((b) => b.textContent!.includes('入力'))!;
    button.click();
    fixture.detectChanges();
    const set = (name: string, v: string) => {
      const input = office('osaka').querySelector(`input[name=${name}]`) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    // 「保存」は塗りつぶし、「やめる」は枠だけ（同じ強さで並べない）
    const cancel = [...office('osaka').querySelectorAll('button')].find((b) => b.textContent!.trim() === 'やめる')!;
    expect(cancel.classList).toContain('secondary');
    set('notice_healthCare', '29,550');
    set('notice_childSupport', '690');
    set('notice_pension', '54900');
    fixture.componentRef.instance['saveNotice']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(notices.get('osaka')).toEqual({ healthCare: 29_550, childSupport: 690, pension: 54_900 });
    expect(office('osaka').textContent).toContain('一致');
  });

  it('給与の控除額との差がある人だけに、原因の候補を出す', async () => {
    await setup();
    const rows = el().querySelector('table.deductions')!.textContent!;
    expect(el().textContent).toContain('一致 1人 ／ 差あり 1人 ／ 未入力 1人');
    expect(rows).toContain('前月から変わった：標準報酬月額の改定');
    // 翌月控除なので、10月分は11月の給与で控除する
    expect(el().querySelector('table.deductions [data-employee]')!.textContent).toContain('2026年11月');
  });

  it('最初は「差あり」の人だけを出し、「未入力も表示」で未入力の人を、「一致した人を隠す」を外すと全員を出す', async () => {
    await setup();
    const shown = () => el().querySelectorAll('table.deductions [data-employee]').length;
    const check = (name: string, checked: boolean) => {
      const box = el().querySelector(`input[name=${name}]`) as HTMLInputElement;
      box.checked = checked;
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    expect(shown()).toBe(1); // 差あり 1人
    check('showNotEntered', true);
    expect(shown()).toBe(2); // ＋未入力 1人
    check('onlyDiff', false);
    expect(shown()).toBe(3); // 一致・差あり・未入力の全員
    expect(el().querySelector('input[name=showNotEntered]')).toBeNull(); // 全員を出すときは、未入力のチェックは要らない
  });

  it('控除額のCSVを取り込む', async () => {
    await setup();
    const page = fixture.componentRef.instance;
    page['loadCsv']('控除.csv', '社員番号,健康保険,介護保険,支援金,厚生年金\r\n3,14775,0,345,27450\r\n9,1,0,1,1\r\n');
    fixture.detectChanges();
    expect(el().querySelector('.preview')!.textContent).toContain('取り込める行 1件 ／ エラー 1件');
    await page['importPreview']();
    fixture.detectChanges();
    expect(saved).toEqual([{ employeeId: 'e3', officeId: 'osaka', amounts: { health: 14_775, childSupport: 345, pension: 27_450 } }]);
    expect(el().textContent).toContain('一致 2人');
  });

  it('特定の事業所の担当者は、その事業所の分だけ', async () => {
    scope = 'osaka';
    await setup();
    expect(office('honsha')).toBeNull();
    // 大阪支店の人だけ（最初は差ありだけを出すので、「一致した人を隠す」を外して全員を見る）
    const box = el().querySelector('input[name=onlyDiff]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el().querySelectorAll('table.deductions [data-employee]')).toHaveLength(1);
  });
});
