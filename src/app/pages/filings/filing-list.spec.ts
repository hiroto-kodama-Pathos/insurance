import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../core/auth/auth';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { legacyGroup } from '../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { FilingRepository } from '../../core/repository/filing-repository';
import { Confirm } from '../../core/ui/confirm';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { FilingList } from './filing-list';

const person = (id: string, no: string, name: string, acquired: string, office: string): EmployeeRecord => ({
  id, employeeNumber: no, name, birthDate: '1990-01-01',
  qualifications: [{ acquiredDate: acquired, lostDate: null }],
  leaves: [], exemptions: [], dependents: [],
  assignments: [{ validFrom: acquired, officeId: office }],
  standardHistory: [{ validFrom: acquired.slice(0, 7), healthStandard: 300_000, pensionStandard: 300_000 }],
});

describe('FilingList', () => {
  let fixture: ComponentFixture<FilingList>;
  let filed: Set<string>;
  let notNeeded: Set<string>;
  let scope: string;
  let confirmAnswer: boolean;
  let batches: string[][];
  let startDate: string | null;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [FilingList],
      providers: [
        provideRouter([]),
        { provide: Confirm, useValue: { ask: async () => confirmAnswer } },
        { provide: Auth, useValue: { user: signal({ uid: 'u1', email: 'staff@example.com', siRole: 'staff', siScope: scope }), isAdmin: signal(false) } },
        {
          provide: EmployeeRepository,
          useValue: { loadAll: async () => [person('e1', '0001', '山田 太郎', '2026-10-01', 'honsha'), person('e2', '0002', '高橋 美咲', '2026-10-27', 'osaka')] },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => ({ offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }, { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' }], insurers: [], insurerRates: [], pensionRates: [] }),
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadGradeThresholds: async () => buildKyokaiThresholds('2020-09'),
          },
        },
        { provide: BonusRepository, useValue: { loadRange: async () => [] } },
        { provide: SalaryRepository, useValue: { loadRange: async () => [] } },
        { provide: RevisionRepository, useValue: { loadStatuses: async () => [] } },
        { provide: SettingsRepository, useValue: { loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)], loadSettings: async () => ({ ...DEFAULT_SETTINGS, startDate }) } },
        {
          provide: FilingRepository,
          useValue: {
            loadFiledIds: async () => filed,
            loadResolutions: async () => new Map([...filed].map((id) => [id, notNeeded.has(id) ? 'notNeeded' : 'filed'])),
            setFiled: async (f: { id: string }) => { filed.add(f.id); },
            setNotNeeded: async (f: { id: string }) => { filed.add(f.id); notNeeded.add(f.id); },
            unsetFiled: async (id: string) => { filed.delete(id); notNeeded.delete(id); },
            setFiledMany: async (list: { id: string }[]) => {
              batches.push(list.map((f) => f.id));
              list.forEach((f) => filed.add(f.id));
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FilingList);
    fixture.componentRef.instance['today'].set('2026-10-29');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    filed = new Set();
    notNeeded = new Set();
    scope = 'all';
    confirmAnswer = true;
    batches = [];
    startDate = null;
  });

  const el = () => fixture.nativeElement as HTMLElement;
  // 届出の行だけ（期限の月の見出しの行は除く）
  const rows = () => [...el().querySelectorAll('table.filings tbody tr:not(.month-head)')] as HTMLElement[];
  const heads = () => [...el().querySelectorAll('table.filings tr.month-head')].map((h) => h.textContent!.trim());

  it('利用開始日より前に期限が来た届出は、導入前に届け出たものとして出さない。未設定なら設定を案内する', async () => {
    await setup();
    expect(el().querySelector('.start-date')?.textContent).toContain('「利用開始日」');
    TestBed.resetTestingModule();
    startDate = '2026-10-10';
    await setup();
    // 山田さんの資格取得届（期限 10月6日）は導入前なので出さない。高橋さん（期限 11月1日）は出す
    expect(rows().map((r) => r.textContent?.includes('高橋 美咲'))).toEqual([true]);
    expect(el().querySelector('.start-date')?.textContent).toContain('利用開始日（2026年10月10日）より前に期限が来た届出は');
  });

  it('資格取得届を期限つきで並べ、期限切れ・3日以内を強調する', async () => {
    await setup();
    expect(rows().map((r) => r.className)).toEqual(['overdue', 'soon']);
    expect(rows()[0].textContent).toContain('2026年10月6日（5日以内）');
    expect(rows()[0].textContent).toContain('資格取得届');
    expect(rows()[1].textContent).toContain('高橋 美咲');
    expect(el().textContent).toContain('未対応（2：期限切れ 1・3日以内 1）');
  });

  it('期限の月ごとに見出しを付けて並べ、「期限の月」で1か月分だけに絞り込める', async () => {
    await setup();
    // 山田：資格取得日 10/1 → 期限 10/6、高橋：資格取得日 10/27 → 期限 11/1
    expect(heads()).toEqual(['2026年10月が期限（1件）', '2026年11月が期限（1件）']);
    const month = el().querySelector('select[name=month]') as HTMLSelectElement;
    expect([...month.options].map((o) => o.textContent!.trim())).toEqual(['すべての月（2件）', '2026年10月（1件）', '2026年11月（1件）']);
    month.value = '2026-11';
    month.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(heads()).toEqual(['2026年11月が期限（1件）']);
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('高橋 美咲')]);
    expect(el().querySelector('.toolbar .count')!.textContent).toContain('1件を表示');
    // タブを切り替えると、月の絞り込みは「すべての月」に戻る
    ([...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes('届出済み')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentRef.instance['monthFilter']()).toBe('');
  });

  it('「届出の種類」で絞り込める。月と一緒に使え、それぞれの選択肢の件数はもう一方の絞り込みに合わせる', async () => {
    await setup();
    const kind = () => el().querySelector('select[name=kind]') as HTMLSelectElement;
    const month = () => el().querySelector('select[name=month]') as HTMLSelectElement;
    const pick = (s: HTMLSelectElement, v: string) => {
      s.value = v;
      s.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent!.trim());
    // 2人とも資格取得届（10月期限・11月期限）
    expect(options(kind())).toEqual(['すべての種類（2件）', '資格取得届（2件）']);
    pick(kind(), 'acquisition');
    expect(rows()).toHaveLength(2);
    expect(rows().every((r) => r.textContent!.includes('資格取得届'))).toBe(true);
    // 月を選ぶと、種類の件数はその月の分になる
    pick(month(), '2026-10');
    expect(options(kind())).toEqual(['すべての種類（1件）', '資格取得届（1件）']);
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('山田 太郎')]);
    // タブを切り替えると、種類も「すべて」に戻る
    ([...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes('届出済み')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentRef.instance['kindFilter']()).toBe('');
  });

  it('「届出済みにする」で未対応から消え、届出済みのタブに移る。未対応に戻せる', async () => {
    await setup();
    (rows()[0].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(filed.has('e1_acquisition_2026-10-01')).toBe(true);
    expect(rows()).toHaveLength(1);
    const tab = (text: string) => [...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;
    expect(tab('未対応').getAttribute('aria-selected')).toBe('true');
    tab('届出済み').click();
    fixture.detectChanges();
    // 選んでいるタブを読み上げソフトにも伝える
    expect(tab('届出済み').getAttribute('aria-selected')).toBe('true');
    expect(tab('未対応').getAttribute('aria-selected')).toBe('false');
    expect(rows()[0].textContent).toContain('山田 太郎');
    (rows()[0].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(filed.size).toBe(0);
  });

  it('届け出なくてよいものは「対応不要」にでき、届出済みのタブに「対応不要」と出る。未対応に戻せる', async () => {
    await setup();
    const btn = [...rows()[0].querySelectorAll('button')].find((b) => b.textContent?.trim() === '対応不要') as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(notNeeded.has('e1_acquisition_2026-10-01')).toBe(true);
    expect(rows()).toHaveLength(1);
    const tab = (text: string) => [...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes(text)) as HTMLButtonElement;
    tab('届出済み・対応不要').click();
    fixture.detectChanges();
    expect(rows()[0].textContent).toContain('対応不要');
    (rows()[0].querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(filed.size).toBe(0);
    expect(notNeeded.size).toBe(0);
  });

  it('届出をチェックで選び、まとめて届出済みにする（見出しのチェックで表示中をすべて選ぶ。絞り込みで見えないものは対象にしない）', async () => {
    await setup();
    const bulk = () => el().querySelector('.bulk button') as HTMLButtonElement;
    const pick = (i: number) => rows()[i].querySelector('input.pick') as HTMLInputElement;
    const click = async (x: HTMLElement) => {
      x.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    expect(bulk().textContent!.trim()).toBe('選択した0件を届出済みにする');
    expect(bulk().disabled).toBe(true);
    await click(pick(0));
    expect(bulk().textContent!.trim()).toBe('選択した1件を届出済みにする');
    expect(rows()[0].classList.contains('picked')).toBe(true);
    // 見出しのチェック：表示している2件をすべて選ぶ
    await click(el().querySelector('thead input.pick') as HTMLInputElement);
    expect(bulk().textContent!.trim()).toBe('選択した2件を届出済みにする');
    // 事業所で絞ると、見えている1件だけが対象
    const office = el().querySelector('select[name=office]') as HTMLSelectElement;
    office.value = 'honsha';
    office.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(bulk().textContent!.trim()).toBe('選択した1件を届出済みにする');
    office.value = '';
    office.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    // 確認で「やめる」なら何もしない
    confirmAnswer = false;
    await click(bulk());
    expect(batches).toEqual([]);
    confirmAnswer = true;
    await click(bulk());
    expect(batches).toEqual([['e1_acquisition_2026-10-01', 'e2_acquisition_2026-10-27']]);
    expect(rows().map((r) => r.textContent!.trim())).toEqual(['未対応の届出はありません。']);
    expect(el().querySelector('app-notice .text')!.textContent).toBe('2件を届出済みにしました。');
    expect(el().querySelector('.bulk')).toBeNull();
  });

  it('特定の事業所の担当者には、その事業所の分だけを出す。適用事業所の選択肢も担当事業所だけ（随時改定と同じ）', async () => {
    scope = 'osaka';
    await setup();
    expect(rows().map((r) => r.textContent!.includes('高橋 美咲'))).toEqual([true]);
    const office = el().querySelector('select[name=office]') as HTMLSelectElement;
    expect([...office.options].map((o) => o.textContent!.trim())).toEqual(['すべて（1件）', '大阪支店（1件）']);
  });

  it('適用事業所の選択肢：届出がある事業所だけを件数つきで出し、件数は期限の月に合わせる。選んでいる事業所は0件でも残す', async () => {
    await setup();
    const office = () => el().querySelector('select[name=office]') as HTMLSelectElement;
    const month = () => el().querySelector('select[name=month]') as HTMLSelectElement;
    const pick = (s: HTMLSelectElement, v: string) => {
      s.value = v;
      s.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent!.trim());
    expect(options(office())).toEqual(['すべて（2件）', '本社（1件）', '大阪支店（1件）']);
    // 11月が期限なのは大阪支店（高橋）だけ
    pick(month(), '2026-11');
    expect(options(office())).toEqual(['すべて（1件）', '大阪支店（1件）']);
    pick(month(), '');
    pick(office(), 'honsha');
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('山田 太郎')]);
    // 届出済みのタブに移っても事業所はそのまま。届出がなくても（0件でも）選んでいる事業所は残す
    ([...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes('届出済み')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(options(office())).toEqual(['すべて（0件）', '本社（0件）']);
    expect(office().value).toBe('honsha');
    expect(el().querySelector('.toolbar .count')!.textContent).toContain('0件を表示');
  });
});

describe('期限の月', () => {
  it('期限の日がある届出はその月、ない届出（速やかに など）は空', async () => {
    const { deadlineMonth, deadlineMonthLabel } = await import('./filing-list');
    expect(deadlineMonth({ deadline: '2026-11-01' })).toBe('2026-11');
    expect(deadlineMonth({ deadline: null })).toBe('');
    expect(deadlineMonthLabel('2026-11')).toBe('2026年11月が期限');
    expect(deadlineMonthLabel('')).toBe('期限の日付なし（速やかに・遅滞なくなど）');
  });
});
