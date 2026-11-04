import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Masters } from '../../core/calc/employee-month';
import { CompanySettings, DEFAULT_SETTINGS } from '../../core/calc/settings';
import { MasterRepository } from '../../core/repository/master-repository';
import { RateRecord, SettingsRepository } from '../../core/repository/settings-repository';
import { Settings } from './settings';
import { EmployeeRepository } from '../../core/repository/employee-repository';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai', isDefault: true },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
  ],
  insurers: [
    { id: 'kyokai', type: 'kyokai', name: '全国健康保険協会' },
    { id: 'k1', type: 'kumiai', name: '〇〇健康保険組合' },
  ],
  insurerRates: [],
  pensionRates: [
    { validFrom: '2017-09', rate: 18300, employeeShare: 500 },
  ],
};

const rates: RateRecord[] = [
  { id: 'r1', insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
  { id: 'r2', insurerId: 'kyokai', rateType: 'health', prefecture: '北海道', validFrom: '2026-03', rate: 10280, employeeShare: 500 },
  { id: 'r3', insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 10000, employeeShare: 450 },
];

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let calls: unknown[][];

  beforeEach(async () => {
    calls = [];
    const record = (name: string) => async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([]),
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => masters,
            loadEligibilityRules: async () => [
              { validFrom: '2024-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 51, contractMonths: 2, studentExcluded: true },
              { validFrom: '2027-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 36, contractMonths: 2, studentExcluded: true },
            ],
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () =>
              Array.from({ length: 40 }, (_, i) => ({
                id: `e${i}`, employeeNumber: `${i}`, name: '', birthDate: '1990-01-01',
                qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }], leaves: [], exemptions: [], assignments: [], standardHistory: [],
              })),
          },
        },
        {
          provide: SettingsRepository,
          useValue: {
            loadSettings: async (): Promise<CompanySettings> => DEFAULT_SETTINGS,
            loadRates: async () => rates,
            saveSettings: record('saveSettings'),
            saveOffice: record('saveOffice'),
            saveKumiai: record('saveKumiai'),
            saveRate: record('saveRate'),
            loadPayrollGroupRecords: async () => [],
            loadBonusTypes: async () => [],
            saveBonusType: record('saveBonusType'),
            savePayrollGroup: record('savePayrollGroup'),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const form = () => [...el().querySelectorAll('form')].at(-1)!;
  function type(label: string, value: string) {
    const l = [...form().querySelectorAll('label')].find((x) => x.textContent?.includes(label))!;
    const i = l.querySelector('input, select') as HTMLInputElement;
    i.value = value;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input'));
  }
  async function submit(f: HTMLFormElement) {
    f.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  type Unsaved = { unsavedCount(): number };
  const unsaved = () => (fixture.componentInstance as unknown as Unsaved).unsavedCount();

  it('会社の設定を変えたまま画面を移ろうとしたら確かめる。元に戻せば確かめない', () => {
    const c = fixture.componentInstance as unknown as { setRounding(v: string): void; settings(): { childSupportRounding: string } };
    expect(unsaved()).toBe(0);
    const before = c.settings().childSupportRounding;
    c.setRounding(before === 'combined' ? 'separate' : 'combined');
    expect(unsaved()).toBe(1);
    c.setRounding(before);
    expect(unsaved()).toBe(0);
  });

  it('画面の上に欄へのジャンプのリンクを並べ、それぞれの見出しに移れる', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll('nav.sections button')].map((b) => b.textContent!.trim());
    expect(buttons).toEqual(['会社の設定', '給与の支払区分', '賞与の種類', '適用事業所', '健康保険組合と料率', '協会けんぽ・厚生年金の料率']);
    for (const id of ['company', 'groups', 'bonus', 'offices', 'kumiai', 'rates']) expect(el.querySelector(`#settings-${id}`)).not.toBeNull();
    // 表は横にスクロールできる枠に入れる
    expect([...el.querySelectorAll('table.list')].every((t) => t.parentElement!.classList.contains('table-wrap'))).toBe(true);
  });

  it('事業所・組合健保の料率・協会けんぽの料率（事業所の都道府県の分だけ）を表示する', () => {
    const text = el().textContent!;
    expect(text).toContain('大阪支店');
    expect(text).toContain('〇〇健康保険組合');
    expect(text).toContain('本人 45%');
    expect(text).toContain('9.85%');
    expect(text).not.toContain('10.28%'); // 北海道の事業所はない
  });

  it('参照用の料率の表に、厚生年金の料率（全国一律）も出す', () => {
    const rows = [...el().querySelectorAll('table.reference-rates tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => td.textContent!.trim()).join('|'),
    );
    expect(rows).toContain('厚生年金|全国一律|2017年9月|18.3%|折半');
  });

  it('支払区分を追加する（最初の区分は既定にする）', async () => {
    expect(el().querySelector('.payroll-groups')!.textContent).toContain('登録されていません');
    button('支払区分を追加').click();
    fixture.detectChanges();
    await submit(form());
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('区分の名前を入力してください');
    type('区分の名前', 'パート');
    type('締め日', '15');
    type('支払月', 'sameMonth');
    await submit(form());
    expect(calls[0][0]).toBe('savePayrollGroup');
    expect(calls[0][1]).toBeNull();
    expect(calls[0][2]).toMatchObject({ name: 'パート', cutoffDay: 15, paidIn: 'sameMonth', payDay: 25, isDefault: true });
  });

  it('企業規模の基準は出さない（特定適用事業所での使用を前提にする）', () => {
    expect(el().querySelector('.company-size')).toBeNull();
    expect(el().querySelector('input[name=specificApplicable]')).toBeNull();
    expect(el().textContent).toContain('特定適用事業所（任意特定適用事業所を含む）での使用を前提');
  });

  it('通常の労働者の所定労働時間・日数を保存する', async () => {
    const h = el().querySelector('input[name=fullTimeWeeklyHours]') as HTMLInputElement;
    h.value = '37.5';
    h.dispatchEvent(new Event('input'));
    await submit(el().querySelector('form')!);
    expect(calls[0][0]).toBe('saveSettings');
    expect(calls[0][1]).toMatchObject({ fullTimeWeeklyHours: 37.5, fullTimeMonthlyDays: 20 });
  });

  it('所定労働時間が空なら保存しない', async () => {
    const h = el().querySelector('input[name=fullTimeWeeklyHours]') as HTMLInputElement;
    h.value = '';
    h.dispatchEvent(new Event('input'));
    await submit(el().querySelector('form')!);
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('週の所定労働時間を1〜60時間');
  });

  it('賞与の種類を、年4回以上支給として追加する', async () => {
    button('賞与の種類を追加').click();
    fixture.detectChanges();
    type('種類の名前', '四半期賞与');
    const c = form().querySelector('input[name=isRemuneration]') as HTMLInputElement;
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    type('適用開始月', '2026-04');
    await submit(form());
    expect(calls[0]).toEqual(['saveBonusType', null, { name: '四半期賞与', isRemuneration: true, validFrom: '2026-04' }]);
  });

  it('支援金の端数処理を変えて保存する', async () => {
    const radio = el().querySelector('input[value=separate]') as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await submit(el().querySelector('form')!);
    expect(calls[0][0]).toBe('saveSettings');
    expect(calls[0][1]).toMatchObject({ childSupportRounding: 'separate' });
  });

  it('協会けんぽの事業所は都道府県がないと保存しない', async () => {
    button('適用事業所を追加').click();
    fixture.detectChanges();
    type('事業所名', '名古屋営業所');
    type('加入する保険者', 'kyokai');
    await submit(form());
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('都道府県を選んでください');

    type('都道府県', '愛知県');
    await submit(form());
    expect(calls[0]).toEqual([
      'saveOffice',
      null,
      { name: '名古屋営業所', prefecture: '愛知県', insurerId: 'kyokai', isDefault: false },
      masters.offices,
    ]);
  });

  it('組合健保の料率を%で入れると、10万分率と千分率で保存する', async () => {
    button('料率を追加').click();
    fixture.detectChanges();
    type('保険', 'care');
    type('適用開始月', '2026-03');
    type('料率（会社と本人の合計', '1.8');
    await submit(form());
    expect(calls[0]).toEqual([
      'saveRate',
      null,
      { insurerId: 'k1', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1800, employeeShare: 500 },
    ]);
  });

  it('料率の変更では、今の値を%で入れておく', () => {
    const edit = [...el().querySelectorAll('button')].filter((b) => b.textContent?.trim() === '変更').at(-1)!;
    edit.click();
    fixture.detectChanges();
    const inputs = form().querySelectorAll('input[inputmode=decimal]') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe('10');
    expect(inputs[1].value).toBe('4.5');
  });
});
