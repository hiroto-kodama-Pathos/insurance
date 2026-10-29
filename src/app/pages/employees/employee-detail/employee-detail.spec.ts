import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Masters } from '../../../core/calc/employee-month';
import { buildKyokaiGrades } from '../../../core/calc/grade-suggest';
import { EmployeeDetail as Detail, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SettingsRepository } from '../../../core/repository/settings-repository';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { EmployeeDetail } from './employee-detail';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
  ],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [],
  pensionRates: [],
};

function yamada(): Detail {
  return {
    id: 'e1',
    employeeNumber: '0001',
    name: '山田 太郎',
    birthDate: '1980-05-10',
    qualifications: [{ id: 'q1', acquiredDate: '2024-04-01', lostDate: null, lostReason: null }],
    leaves: [],
    exemptions: [],
    assignments: [{ id: 'a1', validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [
      { id: 's1', validFrom: '2024-04', reason: 'acquisition', healthStandard: 300_000, pensionStandard: 300_000, remuneration: null },
    ],
    insuredTypes: [{ id: 't1', validFrom: '2024-04-01', type: 'general' }],
    dependents: [{ id: 'd1', name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2024-04-01', removedDate: null }],
  };
}

describe('EmployeeDetail', () => {
  let fixture: ComponentFixture<EmployeeDetail>;
  let calls: unknown[][];

  beforeEach(async () => {
    calls = [];
    const record = (name: string) => async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
    await TestBed.configureTestingModule({
      imports: [EmployeeDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadDetail: async () => yamada(),
            closeQualification: record('closeQualification'),
            addQualification: record('addQualification'),
            addTransfer: record('addTransfer'),
            addStandard: record('addStandard'),
            addLeave: record('addLeave'),
            updateLeave: record('updateLeave'),
            addInsuredType: record('addInsuredType'),
            addExemption: record('addExemption'),
            addDependent: record('addDependent'),
            removeDependent: record('removeDependent'),
            updateExemptionEnd: record('updateExemptionEnd'),
          },
        },
        {
          provide: SettingsRepository,
          useValue: { loadSettings: async () => DEFAULT_SETTINGS },
        },
        {
          provide: MasterRepository,
          useValue: { loadMasters: async () => masters, loadGrades: async () => buildKyokaiGrades('2020-09') },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EmployeeDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const input = (selector: string, value: string) => {
    const i = el().querySelector(selector) as HTMLInputElement;
    i.value = value;
    i.dispatchEvent(new Event('input'));
  };
  async function submit() {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('基本情報と履歴を表示する', () => {
    expect(el().querySelector('h1')?.textContent).toContain('山田 太郎');
    expect(el().textContent).toContain('加入中');
    expect(el().textContent).toContain('資格取得時決定');
    expect(el().textContent).toContain('30万円');
    expect(el().textContent).toContain('直近12か月の保険料');
  });

  it('退職日を入れると、資格喪失日を翌日にして保存する', async () => {
    button('退職を登録').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-10-31');
    await submit();
    // 扶養中の被扶養者（d1）も、資格喪失日に扶養から外れる
    expect(calls).toEqual([['closeQualification', 'e1', 'q1', '2026-11-01', 'retirement', ['d1']]]);
    expect(el().textContent).toContain('被扶養者1人も同じ日に扶養から外れます。');
    expect(el().textContent).toContain('資格喪失日 2026-11-01');
  });

  it('退職日が空ならエラーを出して保存しない', async () => {
    button('退職を登録').click();
    fixture.detectChanges();
    await submit();
    expect(calls).toEqual([]);
    expect(el().textContent).toContain('退職日を正しく入力してください');
  });

  it('異動は、今の標準報酬月額を初期値にして保存する', async () => {
    button('異動を登録').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-11-01');
    const select = el().querySelector('select') as HTMLSelectElement;
    select.value = 'osaka';
    select.dispatchEvent(new Event('change'));
    await submit();
    expect(calls).toEqual([
      ['addTransfer', 'e1', '2026-11-01', 'osaka', { healthStandard: 300_000, pensionStandard: 300_000 }],
    ]);
  });

  it('報酬月額から標準報酬月額の提案を入れる', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2026-09');
    input('input[inputmode=numeric]', '700000');
    button('提案を入力').click();
    fixture.detectChanges();
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ validFrom: '2026-09', healthStandard: 710_000, pensionStandard: 650_000 });
    expect(calls[0][3]).toBe(700_000);
  });

  it('休業を追加する', async () => {
    button('休業を追加').click();
    fixture.detectChanges();
    input('input[type=date]', '2026-12-01');
    await submit();
    expect(calls).toEqual([
      ['addLeave', 'e1', { type: 'childcare', startDate: '2026-12-01', endDate: '', workedDays: null }],
    ]);
  });

  it('被保険者区分を変える（今と同じ区分は登録しない）', async () => {
    expect(fixture.nativeElement.querySelector('.page-header').textContent).toContain('一般被保険者');
    button('被保険者区分を変える').click();
    fixture.detectChanges();
    input('input[name=insuredTypeDate]', '2026-11-01');
    await submit();
    expect(calls).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('この日の区分と同じです');
    const select = fixture.nativeElement.querySelector('select[name=insuredType]') as HTMLSelectElement;
    select.value = 'shortTime';
    select.dispatchEvent(new Event('change'));
    await submit();
    expect(calls).toEqual([['addInsuredType', 'e1', { validFrom: '2026-11-01', type: 'shortTime' }]]);
  });

  it('適用除外を追加する（届け出ることと期限を出す）', async () => {
    button('適用除外を追加').click();
    fixture.detectChanges();
    input('input[name=exemptionStart]', '2026-11-02');
    await submit();
    expect(calls).toEqual([['addExemption', 'e1', { type: 'care', startDate: '2026-11-02', endDate: '' }]]);
    expect(fixture.nativeElement.textContent).toContain('介護保険適用除外等該当・非該当届：遅滞なく');
  });

  it('被扶養者を追加し、扶養から外す（被扶養者異動届の期限を出す）', async () => {
    button('被扶養者を追加').click();
    fixture.detectChanges();
    input('input[name=dependentName]', '山田 一郎');
    input('input[name=dependentBirth]', '2026-10-01');
    input('input[name=dependentCertified]', '2026-10-01');
    await submit();
    expect(calls).toEqual([['addDependent', 'e1', { name: '山田 一郎', birthDate: '2026-10-01', certifiedDate: '2026-10-01' }]]);
    expect(fixture.nativeElement.textContent).toContain('被扶養者異動届：2026-10-06まで（5日以内）');
    calls.length = 0;
    button('扶養から外す').click();
    fixture.detectChanges();
    input('input[name=dependentRemoved]', '2026-11-01');
    await submit();
    expect(calls).toEqual([['removeDependent', 'e1', 'd1', '2026-11-01']]);
  });

  it('二以上事業所勤務の人は、自社の報酬・合計の報酬・選んだ保険者を一緒に登録する', async () => {
    button('標準報酬月額を追加').click();
    fixture.detectChanges();
    input('input[type=month]', '2026-11');
    (el().querySelector('input[name=multiOffice]') as HTMLInputElement).click();
    fixture.detectChanges();
    input('input[name=ownRemuneration]', '200,000');
    input('input[name=totalRemuneration]', '300000');
    const sel = el().querySelector('select[name=selectedInsurer]') as HTMLSelectElement;
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change'));
    await submit();
    expect(calls[0][0]).toBe('addStandard');
    expect(calls[0][2]).toMatchObject({ validFrom: '2026-11', ownRemuneration: 200_000, totalRemuneration: 300_000, selectedInsurerId: sel.options[1].value });
  });
});
