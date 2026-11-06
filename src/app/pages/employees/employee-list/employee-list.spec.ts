import { SettingsRepository } from '../../../core/repository/settings-repository';
import { legacyGroup } from '../../../core/calc/payroll-group';
import { DEFAULT_SETTINGS } from '../../../core/calc/settings';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth, AuthUser } from '../../../core/auth/auth';
import { provideRouter } from '@angular/router';
import { Masters } from '../../../core/calc/employee-month';
import { buildKyokaiGrades } from '../../../core/calc/grade-suggest';
import { NewEmployeeInput } from '../../../core/calc/new-employee';
import { EmployeeRecord, EmployeeRepository } from '../../../core/repository/employee-repository';
import { MasterRepository } from '../../../core/repository/master-repository';
import { SalaryRepository } from '../../../core/repository/salary-repository';
import { EmployeeList } from './employee-list';
import { Confirm } from '../../../core/ui/confirm';

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
  let salaryRanges: string[];
  const user = signal<AuthUser | null>(null);
  let failCreate = false;

  beforeEach(async () => {
    failCreate = false;
    user.set({ uid: 'u1', email: '', siRole: 'staff', siScope: 'all' });
    created = [];
    salaryRanges = [];
    await TestBed.configureTestingModule({
      imports: [EmployeeList],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: { user } },
        {
          provide: EmployeeRepository,
          useValue: {
            loadAll: async () => [
              yamada,
              { ...yamada, id: 'r1', employeeNumber: '0090', name: '退職 済子', qualifications: [{ acquiredDate: '2020-04-01', lostDate: '2025-04-01', lostReason: 'retirement' }] },
              // 労働時間が減って加入の条件から外れた人は、在籍しているので「未加入」
              { ...yamada, id: 'c1', employeeNumber: '0091', name: '条件 外子', qualifications: [{ acquiredDate: '2020-04-01', lostDate: '2025-04-01', lostReason: 'conditions' }] },
            ],
            create: async (input: NewEmployeeInput) => {
              if (failCreate) throw new Error('permission-denied');
              created.push(input);
              return 'new-id';
            },
          },
        },
        {
          provide: SalaryRepository,
          useValue: {
            loadRange: async (from: string) => {
              salaryRanges.push(from);
              return [{ employeeId: 'e1', paidDate: `${from}-25`, fixedWages: 210_000, nonFixedWages: 15_000, retroactiveDiff: null }];
            },
          },
        },
        { provide: SettingsRepository, useValue: { loadPayrollGroups: async () => [legacyGroup(DEFAULT_SETTINGS)], loadSettings: async () => ({ ...DEFAULT_SETTINGS }) } },
        {
          provide: MasterRepository,
          useValue: {
            loadMasters: async () => masters,
            loadGrades: async () => buildKyokaiGrades('2020-09'),
            loadEligibilityRules: async () => [
              { validFrom: '2024-10-01', fullTimeRatio: 750, weeklyHours: 20, companySize: 51, contractMonths: 2, studentExcluded: true },
            ],
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

  it('検索：全角の社員番号・半角カタカナでも見つかる', () => {
    const search = (q: string) => {
      const i = el().querySelector('#employee-search') as HTMLInputElement;
      i.value = q;
      i.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return el().querySelector('table.list tbody')?.textContent ?? '';
    };
    // 検索欄・事業所の欄には、ほかの画面と同じく見出し（label）がある
    const labels = [...el().querySelectorAll('.filters label')].map((l) => l.firstChild!.textContent!.trim());
    expect(labels).toEqual(['検索', '適用事業所']);
    expect(search('０００１')).toContain('山田 太郎');
    expect(search('山田　太郎')).toContain('山田 太郎');
    expect(search('０００２')).not.toContain('山田 太郎');
  });

  it('在籍中・退職済み・未加入を切り替えて一覧にする', () => {
    const tabs = [...el().querySelectorAll('.tabs .tab')].map((b) => b.textContent!.trim());
    expect(tabs).toEqual(['すべて（3）', '在籍中（1）', '退職済み（1）', '未加入（1）']);
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

  it('新規登録：特定の事業所の担当者は、自分の担当事業所しか選べない（初めから選んである）。全担当の人はすべて選べる', async () => {
    const page = fixture.componentInstance as unknown as { offices: { set(v: unknown): void } };
    page.offices.set([
      { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai', isDefault: true },
      { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
    ]);
    const open = async () => {
      (el().querySelector('.page-header button') as HTMLButtonElement).click();
      await settle();
      const select = el().querySelector('form select') as HTMLSelectElement;
      return { options: [...select.options].map((o) => o.textContent!.trim()), value: select.value };
    };
    // 全担当：すべての事業所。デフォルトの事業所（本社）を選んである
    expect(await open()).toEqual({ options: ['選んでください', '本社', '大阪支店'], value: 'honsha' });
    expect(el().querySelector('.office-scope')).toBeNull();
    // 大阪支店の担当者：大阪支店だけ。本社（デフォルト）ではなく大阪支店を選んである
    user.set({ uid: 'u2', email: '', siRole: 'staff', siScope: 'osaka' });
    [...el().querySelectorAll('form button')].find((b) => b.textContent!.trim() === 'やめる')!.dispatchEvent(new Event('click')); // いったん閉じる
    await settle();
    expect(await open()).toEqual({ options: ['大阪支店'], value: 'osaka' });
    expect(el().querySelector('.office-scope')?.textContent).toContain('担当している事業所の従業員だけを登録できます');
  });

  it('新規登録：適用事業所が1つもなければ、選ぶ欄の下に登録を促す（管理者は設定へのリンク、担当者は依頼の案内）', async () => {
    const page = fixture.componentInstance as unknown as { offices: { set(v: unknown): void } };
    page.offices.set([]);
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelector('.no-office')?.textContent).toContain('管理者に登録を依頼してください');
    user.set({ uid: 'u1', email: '', siRole: 'admin', siScope: 'all' });
    await settle();
    expect(el().querySelector('.no-office')?.textContent).toContain('「適用事業所」で登録してください');
    expect(el().querySelector('.no-office a')?.getAttribute('href')).toBe('/settings');
  });

  type Unsaved = { unsavedCount(): number };
  const unsaved = () => (fixture.componentInstance as unknown as Unsaved).unsavedCount();

  it('新規登録：必須の欄に「必須」の印を付ける。パートの所定労働時間・日数と、加入しない人の欄は状況に合わせる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as { setEmploymentType(v: string): void; setInsured(v: boolean): void };
    // 印の付いた欄の見出し（印の文字は除く）
    const marked = () =>
      [...el().querySelectorAll('form label')]
        .filter((l) => l.querySelector(':scope > span > .req'))
        .map((l) => l.querySelector(':scope > span')!.textContent!.replace('必須', '').trim());
    const regular = ['社員番号', '氏名', '生年月日', '所属する適用事業所', '資格取得日（入社日）', '基本給', '標準報酬月額（健康保険）', '標準報酬月額（厚生年金）'];
    expect(marked()).toEqual(regular);
    expect(el().querySelector('.req-note')?.textContent).toContain('必須');
    // パート：週の所定労働時間・月の所定労働日数も必須
    c.setEmploymentType('part');
    await settle();
    expect(marked()).toEqual([...regular.slice(0, 5), '週の所定労働時間', '月の所定労働日数', ...regular.slice(5)]);
    expect((el().querySelector('input[name=weeklyHours]') as HTMLInputElement).getAttribute('aria-required')).toBe('true');
    // 加入しない人：報酬月額・標準報酬月額の欄はない。入社日は必須
    c.setInsured(false);
    await settle();
    expect(marked()).toEqual(['社員番号', '氏名', '生年月日', '所属する適用事業所', '入社日', '週の所定労働時間', '月の所定労働日数']);
  });

  it('新規登録のフォームで入力を変えたまま画面を移ろうとしたら確かめる（開いただけ・やめたあとは確かめない）', async () => {
    expect(unsaved()).toBe(0);
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    expect(unsaved()).toBe(0);
    (fixture.componentInstance as unknown as { setText(k: string, v: string): void }).setText('name', '田中 次郎');
    expect(unsaved()).toBe(1);
    [...el().querySelectorAll('form button')].find((b) => b.textContent!.trim() === 'やめる')!.dispatchEvent(new Event('click'));
    await settle();
    expect(unsaved()).toBe(0);
  });

  it('報酬月額から「提案を入力」で標準報酬月額を入れ、登録する', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setAmount(k: string, v: string): void;
      setBreakdown(k: string, v: string): void;
      setEligibilityNumber(k: string, v: string): void;
      suggest(): void;
    };
    c.setEligibilityNumber('weeklyHours', '40');
    c.setEligibilityNumber('monthlyDays', '20');
    c.setText('employeeNumber', '0002');
    c.setText('name', '田中 次郎');
    c.setText('birthDate', '1990-04-01');
    c.setText('acquiredDate', '2026-10-01');
    c.setBreakdown('basic', '600,000');
    c.setBreakdown('allowances', '50,000');
    c.setBreakdown('commuting', '30,000');
    c.setBreakdown('overtime', '20,000');
    await settle();
    expect(el().querySelector('fieldset.breakdown .total')?.textContent).toContain('700,000円');
    // 内訳を入れると、「提案を入力」を押さなくても標準報酬月額が入る
    expect((el().querySelector('input[name=healthStandard]') as HTMLInputElement).value).toBe('710000');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
    expect(created[0].officeId).toBe('honsha');
    expect(created[0].healthStandard).toBe(710_000);
    expect(created[0].eligibilityResult?.candidate).toBe('general');
    expect(created[0].breakdown).toEqual({ basic: 600_000, allowances: 50_000, commuting: 30_000, overtime: 20_000 });
    expect(created[0].pensionStandard).toBe(650_000);
    expect(el().querySelector('.notice')?.textContent).toContain('田中 次郎さんを登録しました');
    // 続きを入れやすいように、登録した人の詳細へのリンクを出す
    expect(el().querySelector('.created-link a')?.textContent).toContain('田中 次郎さんの詳細を開く');
    // 入社時：控除する給与の月と資格取得届の期限
    const ym = created[0].acquiredDate.slice(0, 7);
    expect(el().querySelector('.notice')?.textContent).toContain(`${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月分から保険料がかかり`);
    expect(el().querySelector('.notice')?.textContent).toContain('資格取得届の期限は');
  });

  it('導入時の登録：資格取得月に等級表がない人は自動で導入時の登録になり、内訳なしで今の標準報酬月額を登録する', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setAmount(k: string, v: string): void;
      setOnboardingFrom(v: string): void;
    };
    c.setText('employeeNumber', '0003');
    c.setText('name', '古参 一郎');
    c.setText('birthDate', '1980-04-01');
    c.setText('acquiredDate', '2015-04-01');
    await settle();
    // 等級表は2020年9月からなので、2015年4月の入社は自動で導入時の登録（内訳の欄は出さない）
    expect((el().querySelector('input[name=onboarding]') as HTMLInputElement).checked).toBe(true);
    expect(el().querySelector('fieldset.breakdown')).toBeNull();
    expect(el().textContent).toContain('使える等級表がない');
    c.setOnboardingFrom('2026-09');
    c.setAmount('healthStandard', '300000');
    c.setAmount('pensionStandard', '300000');
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
    expect(created[0].onboarding).toEqual({ validFrom: '2026-09' });
    expect(created[0].acquiredDate).toBe('2015-04-01');
    const notice = el().querySelector('.notice')?.textContent ?? '';
    expect(notice).toContain('2026年9月分から登録しました');
    expect(notice).toContain('「対応不要」にしました');
    expect(notice).not.toContain('資格取得届の期限は');
  });

  it('導入時の登録：最近の入社日なら、資格取得届が済んでいるかを確かめ、やめれば登録しない。今月の入社では選べない', async () => {
    const ask = vi.spyOn(TestBed.inject(Confirm), 'ask').mockResolvedValue(false);
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setAmount(k: string, v: string): void;
      setOnboarding(on: boolean): void;
      form(): NewEmployeeInput;
    };
    c.setText('employeeNumber', '0004');
    c.setText('name', '最近 入社');
    c.setText('birthDate', '1990-04-01');
    // 今日の資格取得日（初期値）では、導入時の登録の欄を出さない
    await settle();
    expect(el().querySelector('input[name=onboarding]')).toBeNull();
    // 前の月の入社：等級表はあるので自動では選ばないが、選べる
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const lastMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d).slice(0, 7) + '-01';
    c.setText('acquiredDate', lastMonth);
    await settle();
    expect((el().querySelector('input[name=onboarding]') as HTMLInputElement).checked).toBe(false);
    c.setOnboarding(true);
    c.setAmount('healthStandard', '300000');
    c.setAmount('pensionStandard', '300000');
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].message).toContain('資格取得届');
    expect(created.length).toBe(0);
    // 今月の入社日に戻すと、導入時の登録は外れる
    c.setText('acquiredDate', lastMonth.slice(0, 5) + lastMonth.slice(5, 7) + '-01');
    c.setText('acquiredDate', new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()));
    expect(c.form().onboarding).toBeNull();
  });

  it('正社員は所定労働時間を空欄のまま登録でき、被扶養者も一緒に登録して期限を知らせる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setBreakdown(k: string, v: string): void;
      setAmount(k: string, v: string): void;
      addDependentRow(): void;
      setDependent(i: number, k: string, v: string): void;
    };
    c.setText('employeeNumber', '0003');
    c.setText('name', '扶養 太郎');
    c.setText('birthDate', '1985-01-01');
    c.setText('acquiredDate', '2026-11-01');
    c.setBreakdown('basic', '300000');
    c.setAmount('healthStandard', '300000');
    c.setAmount('pensionStandard', '300000');
    await settle();
    expect(el().querySelector('fieldset.eligibility')!.textContent).toContain('正社員は通常の労働者のため一般の被保険者');
    // 被扶養者：1人目は扶養に入った日を空欄（資格取得日になる）、2人目は氏名が空でエラー
    c.addDependentRow();
    c.setDependent(0, 'name', '扶養 花子');
    c.setDependent(0, 'birthDate', '1987-03-03');
    c.addDependentRow();
    c.setDependent(1, 'birthDate', '2015-05-05');
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(0);
    expect(el().textContent).toContain('被扶養者2人目：氏名を入力してください');
    c.setDependent(1, 'name', '扶養 一郎');
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
    expect(created[0].eligibility?.weeklyHours).toBeNull();
    expect(created[0].dependents).toEqual([
      { name: '扶養 花子', birthDate: '1987-03-03', certifiedDate: '' },
      { name: '扶養 一郎', birthDate: '2015-05-05', certifiedDate: '' },
    ]);
    expect(el().querySelector('.notice')?.textContent).toContain('被扶養者異動届（2人）の期限も同じ');
  });

  it('中学校を卒業する時期より前の入社日なら、生年月日の下に注意の一文を出す', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as { setText(k: string, v: string): void };
    c.setText('birthDate', '2011-06-01');
    c.setText('acquiredDate', '2026-11-01');
    await settle();
    expect(el().querySelector('.child-notice')?.textContent).toContain('2027年3月31日');
    c.setText('acquiredDate', '2027-04-01');
    await settle();
    expect(el().querySelector('.child-notice')).toBeNull();
  });

  it('日給・時給の人：同じような仕事をする人を選ぶと前月の報酬の平均を出し、報酬月額にできる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();
    const page = fixture.componentInstance as unknown as { setText(k: string, v: string): void; form(): { breakdown: object } };
    page.setText('acquiredDate', '2026-11-01');
    fixture.detectChanges();
    const similar = el().querySelector('details.similar') as HTMLElement;
    expect(similar.textContent).toContain('前月（2026年10月）');
    // 選べるのは同じ事業所で加入中の人だけ（退職済み・未加入の人は出ない）
    const boxes = [...similar.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    expect(boxes.map((b) => b.name)).toEqual(['similar-e1']);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(salaryRanges).toEqual(['2026-10']);
    expect(similar.textContent).toContain('225,000円');
    expect(similar.textContent).toContain('平均 225,000円');
    [...similar.querySelectorAll('button')].find((b) => b.textContent?.includes('この平均を報酬月額にする'))!.click();
    fixture.detectChanges();
    expect(page.form().breakdown).toEqual({ basic: 225_000, allowances: null, commuting: null, overtime: null });
  });

  it('加入しない人は、報酬月額なしで登録できる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setInsured(v: boolean): void;
      setEligibilityNumber(k: string, v: string): void;
    };
    c.setEligibilityNumber('weeklyHours', '15');
    c.setEligibilityNumber('monthlyDays', '12');
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
    expect(created[0].eligibilityResult?.candidate).toBe('none');
  });

  it('登録できなかったとき（通信・権限）は、社員番号の欄ではなく、登録のボタンの横に知らせる', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as {
      setText(k: string, v: string): void;
      setInsured(v: boolean): void;
      setEligibilityNumber(k: string, v: string): void;
    };
    c.setEligibilityNumber('weeklyHours', '15');
    c.setEligibilityNumber('monthlyDays', '12');
    c.setText('employeeNumber', '0003');
    c.setText('name', '短時間 パート');
    c.setText('birthDate', '1985-01-01');
    c.setInsured(false);
    failCreate = true;
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const msg = el().querySelector('form .actions .err');
    expect(msg?.textContent).toContain('登録できませんでした');
    expect(msg?.getAttribute('role')).toBe('alert');
    const numberLabel = (el().querySelector('input[name=employeeNumber]') as HTMLElement).closest('label')!;
    expect(numberLabel.textContent).not.toContain('登録できませんでした');
    // もう一度押して登録できたら、知らせは消える
    failCreate = false;
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(1);
  });

  it('加入対象の判定：週25時間のパートは短時間労働者の候補。「候補どおりにする」で区分が入る', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const type = el().querySelector('select[name=employmentType]') as HTMLSelectElement;
    type.value = 'partTime';
    type.dispatchEvent(new Event('change'));
    for (const [name, v] of [['weeklyHours', '25'], ['monthlyDays', '20']]) {
      const i = el().querySelector(`input[name=${name}]`) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle();
    const box = el().querySelector('.candidate')!;
    expect(box.textContent).toContain('候補：短時間労働者');
    expect(box.textContent).toContain('4分の3（週30時間）未満');
    expect(box.textContent).toContain('下の選択が候補と違います');
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('候補どおりにする'))!.click();
    await settle();
    expect((el().querySelector('select[name=insuredType]') as HTMLSelectElement).value).toBe('shortTime');
    expect(el().querySelector('.candidate')!.textContent).not.toContain('下の選択が候補と違います');
  });

  it('パートは、週の所定労働時間・月の所定労働日数がないと登録しない（正社員は空欄でよい）', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const type = el().querySelector('select[name=employmentType]') as HTMLSelectElement;
    type.value = 'partTime';
    type.dispatchEvent(new Event('change'));
    await settle();
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(created.length).toBe(0);
    expect(el().textContent).toContain('週の所定労働時間を0〜168時間で入力してください');
  });
  it('状態・検索・事業所で絞り込める', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll('button.tab')].find((b) => b.textContent?.includes('未加入')) as HTMLButtonElement;
    tab.click();
    fixture.detectChanges();
    // 未加入は、加入の条件から外れた人だけ（退職した人・加入中の人は出ない）
    expect(el.querySelector('table.list tbody')!.textContent).toContain('条件 外子');
    expect(el.querySelector('table.list tbody')!.textContent).not.toContain('退職 済子');
    expect(el.querySelector('table.list tbody')!.textContent).not.toContain('山田 太郎');
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

  it('標準報酬月額を自分で直したあとは、内訳を変えても自動では書き換えない', async () => {
    (el().querySelector('.page-header button') as HTMLButtonElement).click();
    await settle();
    const c = fixture.componentInstance as unknown as { setText(k: string, v: string): void; setAmount(k: string, v: string): void; setBreakdown(k: string, v: string): void };
    c.setText('acquiredDate', '2026-10-01');
    c.setBreakdown('basic', '300000');
    await settle();
    expect((el().querySelector('input[name=healthStandard]') as HTMLInputElement).value).toBe('300000');
    c.setAmount('healthStandard', '320000');
    c.setBreakdown('basic', '500000');
    await settle();
    expect((el().querySelector('input[name=healthStandard]') as HTMLInputElement).value).toBe('320000');
  });
});
