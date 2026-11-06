import { insurerUsage, inUseMessage, officeChangeError, officeUsage, payrollGroupUsage, rateDeleteImpact, rateDeleteMessage } from './master-usage';

describe('適用事業所・支払区分が使われているか', () => {
  const employees = [
    { assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-04-01', officeId: 'osaka' }], payrollAssignments: [{ validFrom: '2024-04-01', payrollGroupId: 'g1' }] },
    { assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }] },
  ];
  it('今の所属だけでなく、過去の所属も数える', () => {
    expect(officeUsage(employees, 'honsha')).toBe(2); // 1人目は大阪へ異動したが、過去に所属
    expect(officeUsage(employees, 'osaka')).toBe(1);
    expect(officeUsage(employees, 'nagoya')).toBe(0);
    expect(payrollGroupUsage(employees, 'g1')).toBe(1);
    expect(payrollGroupUsage(employees, 'g2')).toBe(0);
  });
  it('使用中なら知らせの文、使われていなければ null', () => {
    expect(inUseMessage('適用事業所', '本社', { isDefault: true })).toContain('新規登録の初期値として使用中なので、削除できません');
    expect(inUseMessage('適用事業所', '大阪支店', { isDefault: false, employees: 3 })).toBe(
      '適用事業所「大阪支店」は使用中なので、削除できません（従業員3人が所属しています。過去の所属を含みます）。',
    );
    expect(inUseMessage('賞与の種類', '夏季賞与', { isDefault: false, bonuses: true })).toContain('この種類の賞与が登録されています');
    expect(inUseMessage('適用事業所', '名古屋支店', { isDefault: false, employees: 0 })).toBeNull();
  });

  it('健康保険組合：適用事業所の保険者・二以上事業所勤務で選んだ保険者になっていれば使用中', () => {
    const offices = [{ insurerId: 'k1' }, { insurerId: 'kyokai' }];
    const employees = [{ standardHistory: [{ selectedInsurerId: 'k2' }] }, { standardHistory: [{}] }];
    expect(insurerUsage(offices, employees, 'k1')).toEqual({ offices: 1, employees: 0 });
    expect(insurerUsage(offices, employees, 'k2')).toEqual({ offices: 0, employees: 1 });
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 1, employees: 0 })).toContain('適用事業所1件の保険者');
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 0, employees: 1 })).toContain('二以上事業所勤務の保険者として選んでいます');
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 0, employees: 0 })).toBeNull();
  });
});

describe('使用中の適用事業所の変更（officeChangeError）', () => {
  const before = { insurerId: 'kyokai', prefecture: '東京都' };
  it('使われていれば、保険者・都道府県を変えない（理由を添える）。変えないなら・使われていなければよい', () => {
    expect(officeChangeError(before, { insurerId: 'kyokai', prefecture: '大阪府' }, { employees: 3, closedMonths: 0 })).toContain('従業員3人が所属');
    expect(officeChangeError(before, { insurerId: 'k1', prefecture: '東京都' }, { employees: 0, closedMonths: 2 })).toContain('確定済みの月2か月');
    expect(officeChangeError(before, { ...before }, { employees: 3, closedMonths: 2 })).toBeNull();
    expect(officeChangeError(before, { insurerId: 'kyokai', prefecture: '大阪府' }, { employees: 0, closedMonths: 0 })).toBeNull();
  });
  it('削除：確定済みの月があれば使用中', () => {
    expect(inUseMessage('適用事業所', '大阪支店', { isDefault: false, employees: 0, closedMonths: 1 })).toContain('確定済みの月（1か月）');
  });
});

describe('組合健保の料率の削除の影響', () => {
  const rates = [
    { id: 'r1', insurerId: 'k1', rateType: 'health', validFrom: '2025-03', rate: 9800 },
    { id: 'r2', insurerId: 'k1', rateType: 'health', validFrom: '2026-03', rate: 10000 },
    { id: 'r3', insurerId: 'k1', rateType: 'health', validFrom: '2027-03', rate: 10200 },
    { id: 'c1', insurerId: 'k1', rateType: 'care', validFrom: '2026-03', rate: 1800 },
  ];
  const offices = [
    { id: 'tokyo', name: '東京工場', insurerId: 'k1' },
    { id: 'honsha', name: '本社', insurerId: 'kyokai' },
  ];
  const pct = (v: number) => String(v / 1000);

  it('期間は次の適用開始月の前の月まで。削除したあとは前の料率で計算し、確定済みの月を数える', () => {
    const i = rateDeleteImpact(rates[1], rates, offices, 0, { tokyo: ['2026-02', '2026-04', '2026-05'], honsha: ['2026-04'] });
    expect(i).toMatchObject({ from: '2026-03', to: '2027-02', officeNames: ['東京工場'], closedMonths: 2 });
    expect(i.fallback?.id).toBe('r1');
    const m = rateDeleteMessage(i, pct);
    expect(m).toContain('影響する期間：2026年3月分から2027年2月分まで。');
    expect(m).toContain('影響する人：適用事業所「東京工場」の保険料。');
    expect(m).toContain('前の料率（9.8%・2025年3月から）で計算し直します');
    expect(m).toContain('確定済みの月（2か月）は確定した金額のままで、差額の画面に差額が出ます');
    expect(m).toContain('料率が変わったときは削除せず、新しい適用開始月で追加してください');
  });

  it('前の料率がなければ「料率が未登録」になる。最後の行は今後ずっと。使っている事業所がなければ計算は変わらない', () => {
    const care = rateDeleteImpact(rates[3], rates, offices, 2, {});
    expect(care.to).toBeNull();
    const m = rateDeleteMessage(care, pct);
    expect(m).toContain('2026年3月分から今後ずっと');
    expect(m).toContain('適用事業所「東京工場」と二以上事業所勤務でこの組合を選んでいる従業員2人');
    expect(m).toContain('「料率が未登録」になり、保険料を計算できなくなります');
    const unused = rateDeleteMessage(rateDeleteImpact(rates[1], rates, [offices[1]], 0, {}), pct);
    expect(unused).toContain('この組合を保険者にしている適用事業所はないので、保険料の計算は変わりません');
  });
});
