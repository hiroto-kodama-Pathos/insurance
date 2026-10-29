import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Masters } from '../../core/calc/employee-month';
import { CompanySettings, DEFAULT_SETTINGS } from '../../core/calc/settings';
import { MasterRepository } from '../../core/repository/master-repository';
import { RateRecord, SettingsRepository } from '../../core/repository/settings-repository';
import { Settings } from './settings';

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
  pensionRates: [],
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
        { provide: MasterRepository, useValue: { loadMasters: async () => masters } },
        {
          provide: SettingsRepository,
          useValue: {
            loadSettings: async (): Promise<CompanySettings> => DEFAULT_SETTINGS,
            loadRates: async () => rates,
            saveSettings: record('saveSettings'),
            saveOffice: record('saveOffice'),
            saveKumiai: record('saveKumiai'),
            saveRate: record('saveRate'),
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

  it('事業所・組合健保の料率・協会けんぽの料率（事業所の都道府県の分だけ）を表示する', () => {
    const text = el().textContent!;
    expect(text).toContain('大阪支店');
    expect(text).toContain('〇〇健康保険組合');
    expect(text).toContain('本人 45%');
    expect(text).toContain('9.85%');
    expect(text).not.toContain('10.28%'); // 北海道の事業所はない
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
