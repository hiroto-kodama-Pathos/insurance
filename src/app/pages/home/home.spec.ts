import { legacyGroup } from '../../core/calc/payroll-group';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Masters } from '../../core/calc/employee-month';
import { DEFAULT_SETTINGS } from '../../core/calc/settings';
import { ClosingRepository } from '../../core/repository/closing-repository';
import { EmployeeRecord, EmployeeRepository } from '../../core/repository/employee-repository';
import { MasterRepository } from '../../core/repository/master-repository';
import { RevisionRepository } from '../../core/repository/revision-repository';
import { AdjustmentRepository } from '../../core/repository/adjustment-repository';
import { SalaryRepository } from '../../core/repository/salary-repository';
import { buildKyokaiGrades, buildKyokaiThresholds } from '../../core/calc/grade-suggest';
import { SettingsRepository } from '../../core/repository/settings-repository';
import { addMonths, Home } from './home';
import { BonusRepository } from '../../core/repository/bonus-repository';
import { FilingRepository } from '../../core/repository/filing-repository';

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
const person = (id: string, name: string, birthDate: string, std = true): EmployeeRecord => ({
  id,
  employeeNumber: id,
  name,
  birthDate,
  qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
  leaves: [],
  exemptions: [],
  assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
  standardHistory: std ? [{ validFrom: '2020-04', healthStandard: 300_000, pensionStandard: 300_000 }] : [],
});

describe('Home', () => {
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              person('0001', '四十 なる', '1986-11-10'),
              person('0002', '来月 七十', '1956-12-10'),
              person('0003', '未登録 さん', '1990-01-01', false),
              { ...person('0004', '未加入 パート', '2000-01-01', false), qualifications: [] },
              // 10月5日入社・10月20日退職（同月得喪）
              { ...person('0005', '同月 さん', '1995-01-01'), qualifications: [{ acquiredDate: '2026-10-05', lostDate: '2026-10-21' }] },
            ],
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => masters,
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadGradeThresholds: async () => buildKyokaiThresholds('2020-09'),
            loadEligibilityRules: async () => [
              { validFrom: '2024-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 51, contractMonths: 2, studentExcluded: true },
              { validFrom: '2027-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 3, contractMonths: 2, studentExcluded: true },
            ],
          },
        },
        { provide: RevisionRepository, useValue: { loadStatuses: async () => [] } },
        { provide: AdjustmentRepository, useValue: { loadSettlements: async () => [] } },
        {
          provide: SalaryRepository,
          useValue: {
            // 0001 は8月に昇給（30万→36万）。8〜10月の平均36万円で、11月分から改定の見込み
            loadRange: async () =>
              [
                ...['2026-07', '2026-08', '2026-09', '2026-10'].map((ym, i) => ({
                  id: ym, employeeId: '0001', paidDate: `${ym}-25`, fixedWages: i === 0 ? 300_000 : 360_000,
                  nonFixedWages: 0, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
                })),
                // 0004（未加入）は9・10月に月100時間（週23.1時間）。月末締め・翌月払いなので、10月・11月に払う給与に入れる
                ...['2026-10', '2026-11'].map((ym) => ({
                  id: `p${ym}`, employeeId: '0004', paidDate: `${ym}-25`, fixedWages: 110_000,
                  nonFixedWages: 0, paymentBaseDays: 20, retroactiveDiff: null, inKindWages: null, workingHours: 100,
                })),
              ],
          },
        },
        { provide: SettingsRepository, useValue: { loadSettings: async () => ({ ...DEFAULT_SETTINGS }), loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] } },
        { provide: BonusRepository, useValue: { loadRange: async () => [] } },
        { provide: FilingRepository, useValue: { loadFiledIds: async () => new Set<string>() } },
        { provide: ClosingRepository, useValue: { loadMonth: async () => [], loadRecent: async () => [] } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Home);
    fixture.componentRef.instance['thisMonth'].set('2026-11');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('同月得喪で還付待ちの人を出す', () => {
    expect(el().textContent).toContain('同月得喪の還付待ち 1人');
    const row = el().querySelector('table.same-month tbody tr')!;
    expect(row.textContent).toContain('0005');
    expect(row.textContent).toContain('同月 さん');
    expect(row.textContent).toContain('2026年10月分');
  });

  it('今月・来月に年齢で切り替わる人を出す', () => {
    expect(el().querySelector('table.age-this')!.textContent).toContain('四十 なる');
    expect(el().querySelector('table.age-this')!.textContent).toContain('介護保険料がかかります');
    expect(el().querySelector('table.age-next')!.textContent).toContain('来月 七十');
  });

  it('年齢による切り替えのチップは、欄と同じく今月と来月の人を数える（来月の人だけでも0件にしない）', async () => {
    const inst = fixture.componentRef.instance;
    const chip = () => [...el().querySelectorAll('.chip')].find((c) => c.textContent!.includes('年齢による切り替え')) as HTMLElement;
    expect(chip().textContent).toMatch(/今月 \d+件（来月 \d+件）/);
    // 来月70歳になる人だけにする
    inst['employees'].set(inst['employees']().filter((e: { name: string }) => e.name === '来月 七十'));
    fixture.detectChanges();
    expect(chip().textContent!.trim()).toBe('年齢による切り替え 今月 0件（来月 1件）');
    expect(chip().classList).not.toContain('zero');
    expect(inst['total']()).toBeGreaterThan(0);
  });

  it('来月70歳になる人に、70歳到達届の要否を出す（給与がなく報酬月額も未登録なら要確認）', () => {
    expect(el().querySelector('table.age-next')!.textContent).toContain('70歳到達届：要確認');
  });

  it('保険料を計算できない人と、前月の未確定を出す', () => {
    expect(el().querySelector('table.problems')!.textContent).toContain('標準報酬月額が未登録');
    expect(el().querySelector('.unclosed')!.textContent).toContain('本社');
    expect(el().textContent).toContain('2026年10月分の未確定 1件');
  });

  it('未加入で、実際の労働時間が2か月続けて週20時間以上の人を「加入の可能性」に出す', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('加入の可能性 1人');
    const t = el().querySelector('table.enrollment')!.textContent!;
    expect(t).toContain('未加入 パート');
    expect(t).toContain('2026年9月・2026年10月');
    expect(t).toContain('23.1時間・23.1時間（基準 週20時間）');
    expect(t).toContain('2026年11月から');
  });

  it('企業規模の基準の見込みは出さない（特定適用事業所での使用を前提にする）', () => {
    expect(el().textContent).not.toContain('短時間労働者の加入が始まる見込み');
  });

  it('遡及差額を入れていない、遡及昇給のような動きがなければ「遡及の可能性」は0件', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('遡及の可能性 0件');
  });

  it('随時改定の候補の件数を出す', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('改定の候補 1件');
  });

  it('7〜9月以外は、定時決定のチップを出さない', () => {
    expect(el().querySelector('.chips')!.textContent).not.toContain('定時決定');
  });

  it('今月の給与で控除しきれない人の件数を出す（給与のない人は判定しない）', () => {
    expect(el().querySelector('.chips')!.textContent).toContain('今月の給与で控除不足 0人');
    expect(el().querySelector('table.deductions')!.textContent).toContain('いません');
  });

  it('確かめることがある欄を上に出し、ない欄は下にたたむ。チップは件数のあるものが先', () => {
    const clear = el().querySelector('details.clear')!;
    expect(clear.querySelector('table.problems')).toBeNull();
    expect(el().querySelector('table.problems')).not.toBeNull();
    expect(clear.querySelector('table.deductions')).not.toBeNull();
    expect(clear.querySelector('summary')!.textContent).toContain('今月の給与で控除しきれない人');
    const chip = [...el().querySelectorAll('.chip')].find((c) => c.textContent!.includes('控除不足')) as HTMLElement;
    expect(chip.classList).toContain('zero');
    expect(chip.classList).not.toContain('urgent'); // 0人なら赤にしない
    expect(chip.style.order).toBe('1');
  });

  it('欄とチップは、頻度が高く重要度も高い順に並ぶ（前月の未確定 → 計算できない人 → …）', () => {
    // 欄の見出し（折りたたみの summary）
    const headings = [...el().querySelectorAll('.section-summary')].map((h) => h.textContent!.trim());
    // 件数のある欄：前月の未確定（1件）が、計算できない人（1件）より上
    expect(headings).toContain('2026年10月分で確定していない適用事業所');
    expect(headings.indexOf('2026年10月分で確定していない適用事業所')).toBeLessThan(headings.indexOf('今月の保険料を計算できない人'));
    const chips = [...el().querySelectorAll('.chip')].map((c) => c.textContent!.trim());
    expect(chips[0]).toContain('2026年10月分の未確定');
    expect(chips[1]).toContain('保険料を計算できない人');
  });

  it('給与計算・納付の前に必ず対応するもの（前月の未確定・計算できない人）は、赤のチップにして先頭に出す', () => {
    const chip = (text: string) => [...el().querySelectorAll('.chip')].find((c) => c.textContent!.includes(text)) as HTMLElement;
    expect(chip('分の未確定').classList).toContain('urgent');
    expect(chip('分の未確定').style.order).toBe('-1');
    expect(chip('保険料を計算できない人').classList).toContain('urgent');
    expect(chip('通知書待ち').classList).not.toContain('urgent');
    expect(chip('標準報酬月額が変わる人')).toBeTruthy(); // 欄の見出し「今月から標準報酬月額が変わる人」と同じ言葉
  });

  it('通知書待ちの標準報酬月額は、ほかの欄と同じく表で出す', () => {
    const t = el().querySelector('table.provisional');
    expect(t).not.toBeNull();
    expect([...t!.querySelectorAll('th')].map((th) => th.textContent!.trim())).toEqual(['社員番号', '氏名', '適用開始月', '健康保険（見込み）', '厚生年金（見込み）']);
  });

  it('月の足し引き', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});
