import { calcEmployeeMonth, EmployeeData, findEffective, Masters, standardChangeLabel } from './employee-month';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
    { id: 'kumiaiOffice', name: '工場', prefecture: '愛知県', insurerId: 'kumiaiA' },
  ],
  insurers: [
    { id: 'kyokai', type: 'kyokai', name: '協会けんぽ' },
    { id: 'kumiaiA', type: 'kumiai', name: 'A健康保険組合' },
  ],
  insurerRates: [
    // 例として置いた料率
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2025-03', rate: 9910, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'health', prefecture: '大阪府', validFrom: '2026-03', rate: 10130, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2025-03', rate: 1590, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
    { insurerId: 'kumiaiA', rateType: 'health', prefecture: null, validFrom: '2026-04', rate: 9000, employeeShare: 450 },
    { insurerId: 'kumiaiA', rateType: 'care', prefecture: null, validFrom: '2026-04', rate: 1600, employeeShare: 500 },
    { insurerId: 'kumiaiA', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

function employee(over: Partial<EmployeeData> = {}): EmployeeData {
  return {
    id: 'e1',
    birthDate: '1980-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [],
    exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
    ...over,
  };
}

describe('対象月に有効な値', () => {
  it('対象月以前で最も新しいものを選び、順番に左右されない', () => {
    const items = [{ validFrom: '2026-03' }, { validFrom: '2025-03' }, { validFrom: '2027-03' }];
    expect(findEffective(items, '2026-10')?.validFrom).toBe('2026-03');
    expect(findEffective(items, '2025-02')).toBeNull();
  });
});

describe('従業員1人・1か月分の保険料', () => {
  it('東京の事業所・45歳は、東京の料率で健保・介護・支援金・厚年を計算する', () => {
    const r = calcEmployeeMonth(employee(), masters, '2026-10');
    expect(r.status).toBe('ok');
    expect(r.officeId).toBe('honsha');
    expect(r.premium?.health?.employeeYen).toBe(14_775n);
    expect(r.premium?.childSupport?.employeeYen).toBe(345n);
    expect(r.premium?.pension?.employeeYen).toBe(27_450n);
  });

  it('料率の切り替え：2026年2月分は旧料率、3月分から新料率', () => {
    const feb = calcEmployeeMonth(employee(), masters, '2026-02');
    const mar = calcEmployeeMonth(employee(), masters, '2026-03');
    expect(feb.premium?.health?.fullSen).toBe(2_973_000n); // 300,000 × 9.91%
    expect(mar.premium?.health?.fullSen).toBe(2_955_000n); // 300,000 × 9.85%
  });

  it('支援金は2026年4月分から（3月分は支援金なしで ok）', () => {
    expect(calcEmployeeMonth(employee(), masters, '2026-03').premium?.childSupport).toBeNull();
    expect(calcEmployeeMonth(employee(), masters, '2026-04').premium?.childSupport?.employeeYen).toBe(345n);
  });

  it('料率が登録されていない月は missingRate（2025年2月分は介護の料率がない）', () => {
    const r = calcEmployeeMonth(employee(), masters, '2025-02');
    expect(r.status).toBe('missingRate');
    expect(r.premium?.missingRates).toContain('health');
  });

  it('月の途中で大阪へ異動した月は、大阪の料率で1か月分', () => {
    const r = calcEmployeeMonth(
      employee({
        assignments: [
          { validFrom: '2024-04-01', officeId: 'honsha' },
          { validFrom: '2026-10-15', officeId: 'osaka' },
        ],
      }),
      masters,
      '2026-10',
    );
    expect(r.officeId).toBe('osaka');
    expect(r.premium?.health?.fullSen).toBe(3_039_000n); // 300,000 × 10.13%
  });

  it('組合健保は組合の料率と負担割合で計算し、健保と介護は別々に端数処理する', () => {
    const r = calcEmployeeMonth(
      employee({ assignments: [{ validFrom: '2024-04-01', officeId: 'kumiaiOffice' }] }),
      masters,
      '2026-10',
    );
    expect(r.insurerId).toBe('kumiaiA');
    expect(r.premium?.health?.employeeYen).toBe(12_150n); // 300,000 × 9% × 45%
    expect(r.premium?.care?.employeeYen).toBe(2_400n);
  });

  it('標準報酬月額の改定月から新しい額で計算する', () => {
    const history = [
      { validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 },
      { validFrom: '2026-09', healthStandard: 340_000, pensionStandard: 340_000 },
    ];
    expect(calcEmployeeMonth(employee({ standardHistory: history }), masters, '2026-08').standard?.health).toBe(300_000);
    expect(calcEmployeeMonth(employee({ standardHistory: history }), masters, '2026-09').standard?.health).toBe(340_000);
  });

  it('資格のない月は計算しない', () => {
    const r = calcEmployeeMonth(
      employee({ qualifications: [{ acquiredDate: '2024-04-01', lostDate: '2026-10-01' }] }),
      masters,
      '2026-10',
    );
    expect(r.status).toBe('notInsured');
    expect(r.premium).toBeNull();
  });

  it('標準報酬月額の履歴がなければ noStandard', () => {
    const r = calcEmployeeMonth(employee({ standardHistory: [] }), masters, '2026-10');
    expect(r.status).toBe('noStandard');
  });

  it('育休の免除月は0円', () => {
    const r = calcEmployeeMonth(
      employee({ leaves: [{ type: 'childcare', startDate: '2026-09-01', endDate: null }] }),
      masters,
      '2026-10',
    );
    expect(r.premium?.exempt).toBe(true);
    expect(r.premium?.health?.employeeYen).toBe(0n);
  });

  it('二以上事業所勤務は、履歴の自社の報酬・合計の報酬で按分する', () => {
    const r = calcEmployeeMonth(
      employee({
        standardHistory: [
          { validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000, ownRemuneration: 200_000, totalRemuneration: 300_000 },
        ],
      }),
      masters,
      '2026-10',
    );
    expect(r.premium?.pension?.employeeYen).toBe(18_300n);
  });
});

describe('standardChangeLabel', () => {
  const h = (validFrom: string, health: number, pension: number) => ({ validFrom, healthStandard: health, pensionStandard: pension });
  it('変わった側を出す（改定のない月・最初の月は null）', () => {
    const list = [h('2024-04', 620_000, 620_000), h('2026-07', 750_000, 620_000), h('2026-09', 750_000, 650_000), h('2026-11', 300_000, 300_000), h('2027-01', 300_000, 300_000)];
    expect(standardChangeLabel(list, '2024-04')).toBeNull();
    expect(standardChangeLabel(list, '2026-07')).toBe('標準報酬月額の改定（健康保険のみ：62万円→75万円）');
    expect(standardChangeLabel(list, '2026-09')).toBe('標準報酬月額の改定（厚生年金のみ：62万円→65万円）');
    expect(standardChangeLabel(list, '2026-11')).toBe('標準報酬月額の改定（健保 75万円→30万円／厚年 65万円→30万円）');
    expect(standardChangeLabel(list, '2026-10')).toBeNull();
    expect(standardChangeLabel(list, '2027-01')).toBeNull();
  });
});
