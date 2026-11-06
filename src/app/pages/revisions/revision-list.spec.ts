import { legacyGroup } from '../../core/calc/payroll-group';
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
            // 本物は、登録と変更の記録を同じ書き込みで残す
            withLog: async (_id: string, _text: string, action: () => Promise<unknown>) => { await action(); return true; },
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
            loadMasters: async () => ({
              offices: [
                { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
                { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
              ],
              insurers: [], insurerRates: [], pensionRates: [],
            }),
          },
        },
        { provide: SettingsRepository, useValue: { loadSettings: async () => DEFAULT_SETTINGS, loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)] } },
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
    expect(text).toContain('2026年8月（昇給）');
    expect(text).toContain('360,000');
    expect(text).toContain('22等級 300,000 → 25等級 360,000（+3）');
    expect(text).toContain('2026年11月分から');
  });

  it('「見込みどおり登録」で標準報酬月額の履歴を足し、一覧から消える', async () => {
    ([...el().querySelectorAll('table.candidates button')].find((b) => b.textContent!.includes('見込みどおり登録')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(added).toEqual([
      { validFrom: '2026-11', reason: 'revision', healthStandard: 360_000, pensionStandard: 360_000, provisional: false, remuneration: 360_000 },
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

  it('「通知書待ちで登録」では、通知書待ちとして登録する', async () => {
    button('通知書待ちで登録').click();
    await settle();
    expect(added[0]).toMatchObject({ validFrom: '2026-11', provisional: true });
    expect(el().textContent).toContain('通知書待ちとして登録しました');
  });

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

  it('適用事業所・変動月で絞り込める（選択肢には件数を出し、もう一方の絞り込みに合わせる）', async () => {
    const inst = fixture.componentRef.instance;
    // 大阪支店の人：6月 30万円 → 7〜9月 36万円（変動月は7月）
    const osaka: EmployeeRecord = { ...employee, id: 'e2', employeeNumber: '0002', name: '大阪 花子', assignments: [{ validFrom: '2024-04-01', officeId: 'osaka' }] };
    const osakaPay: SalaryRecord[] = ['2026-06', '2026-07', '2026-08', '2026-09'].map((ym, i) => ({
      id: `o${ym}`, employeeId: 'e2', paidDate: `${ym}-25`, fixedWages: i === 0 ? 300_000 : 340_000,
      nonFixedWages: i === 0 ? 0 : 20_000, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
    }));
    inst['employees'].set([employee, osaka]);
    inst['salaries'].set([...salaries, ...osakaPay]);
    fixture.detectChanges();
    const select = (name: string) => el().querySelector(`select[name=${name}]`) as HTMLSelectElement;
    const options = (name: string) => [...select(name).options].map((o) => o.textContent!.trim());
    const pick = (name: string, v: string) => {
      select(name).value = v;
      select(name).dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const names = () => [...el().querySelectorAll('table.candidates tbody tr')].map((r) => r.querySelectorAll('td')[1]?.textContent!.trim());

    expect(options('office')).toEqual(['すべて（2件）', '本社（1件）', '大阪支店（1件）']);
    expect(options('month')).toEqual(['すべて（2件）', '2026年8月（1件）', '2026年7月（1件）']); // 新しい月から
    pick('office', 'osaka');
    expect(names()).toEqual(['大阪 花子']);
    expect(options('month')).toEqual(['すべて（1件）', '2026年7月（1件）']); // 大阪支店の分だけ
    pick('office', '');
    pick('month', '2026-08');
    expect(names()).toEqual(['山田 太郎']);
    expect(el().querySelector('.filters .count')!.textContent).toContain('1件を表示');
    // 大阪支店を選んでタブを切り替えると、変動月は「すべて」に戻り、事業所はそのまま
    pick('month', '');
    pick('office', 'osaka');
    pick('month', '2026-07');
    ([...el().querySelectorAll('button.tab')].find((b) => b.textContent!.includes('登録済み')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(inst['monthFilter']()).toBe('');
    expect(inst['officeFilter']()).toBe('osaka');
    // 登録済みに大阪支店の候補はない：選んだ事業所は0件でも選択肢に残し、その旨を出す
    expect(options('office')).toContain('大阪支店（0件）');
    expect(select('office').value).toBe('osaka');
    expect(el().querySelector('table.candidates tbody')!.textContent).toContain('条件に合う候補はいません。');
  });
});
