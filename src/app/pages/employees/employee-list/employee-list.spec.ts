import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Masters } from '../../../core/calc/employee-month';
import { buildKyokaiGrades } from '../../../core/calc/grade-suggest';
import { NewEmployeeInput } from '../../../core/calc/new-employee';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { EmployeeList } from './employee-list';

const masters: Masters = {
  offices: [{ id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' }],
  insurers: [],
  insurerRates: [],
  pensionRates: [],
};

const yamada: EmployeeRecord = {
  id: 'e1',
  employeeNumber: '0001',
  name: '山田 太郎',
  birthDate: '1980-05-10',
  qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
  leaves: [],
  exemptions: [],
  assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
};

describe('EmployeeList', () => {
  let fixture: ComponentFixture<EmployeeList>;
  let created: NewEmployeeInput[];

  beforeEach(async () => {
    created = [];
    await TestBed.configureTestingModule({
      imports: [EmployeeList],
      providers: [
        provideRouter([]),
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [yamada],
            create: async (input: NewEmployeeInput) => {
              created.push(input);
              return 'new-id';
            },
          },
        },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => masters,
            loadGrades: async () => buildKyokaiGrades('2020-09'),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EmployeeList);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('従業員と、今の所属事業所・標準報酬月額を表示する', () => {
    const text = el().querySelector('table.list tbody')?.textContent ?? '';
    expect(text).toContain('山田 太郎');
    expect(text).toContain('本社');
    expect(text).toContain('30万円');
  });

  it('入力に誤りがあると登録せず、エラーを表示する', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(0);
    expect(el().querySelectorAll('.err').length).toBeGreaterThan(0);
  });

  it('事業所が1つだけなら、初めから選んである', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    expect((el().querySelector('select') as HTMLSelectElement).value).toBe('honsha');
  });

  it('報酬月額から「提案を入力」で標準報酬月額を入れ、登録する', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setAmount(k: string, v: string): void;
      suggest(): void;
    };
    c.setText('employeeNumber', '0002');
    c.setText('name', '田中 次郎');
    c.setText('birthDate', '1990-04-01');
    c.setText('acquiredDate', '2026-10-01');
    c.setAmount('remuneration', '700,000');
    c.suggest();
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
    expect(created[0].officeId).toBe('honsha');
    expect(created[0].healthStandard).toBe(710_000);
    expect(created[0].pensionStandard).toBe(650_000);
    expect(el().querySelector('.notice')?.textContent).toContain('田中 次郎さんを登録しました');
  });

  it('加入しない人は、報酬月額なしで登録できる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setInsured(v: boolean): void;
    };
    c.setText('employeeNumber', '0003');
    c.setText('name', '短時間 パート');
    c.setText('birthDate', '1985-01-01');
    c.setInsured(false);
    await settle();
    expect(el().textContent).not.toContain('報酬月額（見込み）');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
    expect(created[0].insured).toBe(false);
  });
  it('状態・検索・事業所で絞り込める', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll('button.tab')].find((b) => b.textContent?.includes('未加入')) as HTMLButtonElement;
    tab.click();
    fixture.detectChanges();
    expect(el.querySelector('table.list tbody')!.textContent).toContain('条件に合う従業員はいません。');
    const all = [...el.querySelectorAll('button.tab')].find((b) => b.textContent?.includes('すべて')) as HTMLButtonElement;
    all.click();
    const search = el.querySelector('#employee-search') as HTMLInputElement;
    search.value = '山田';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('table.list tbody')!.textContent).toContain('山田 太郎');
    search.value = '佐藤';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('table.list tbody')!.textContent).not.toContain('山田 太郎');
  });
});
