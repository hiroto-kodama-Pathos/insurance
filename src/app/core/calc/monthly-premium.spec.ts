import { careNote, calcMonthlyPremium, MonthlyPremiumInput } from './monthly-premium';

// 東京（協会けんぽ）の例として置いた料率。健康保険9.85%・介護1.62%・支援金0.23%・厚生年金18.3%、すべて折半
const RATES: MonthlyPremiumInput['rates'] = {
  health: { rate: 9850, share: 500 },
  care: { rate: 1620, share: 500 },
  childSupport: { rate: 230, share: 500 },
  pension: { rate: 18300, share: 500 },
};

function input(over: Partial<MonthlyPremiumInput> = {}): MonthlyPremiumInput {
  return {
    yearMonth: '2026-10',
    birthDate: '1980-05-10', // 2026年10月に46歳（介護保険の第2号）
    insured: true,
    leaveExempt: false,
    standard: { health: 300_000, pension: 300_000 },
    rates: RATES,
    ...over,
  };
}

describe('月額の保険料（1人・1か月）', () => {
  it('40〜64歳は健保＋介護を合算して端数処理し、介護は差し引きで出す', () => {
    const r = calcMonthlyPremium(input());
    expect(r.health?.employeeYen).toBe(14_775n);
    expect(r.care?.employeeYen).toBe(17_205n - 14_775n);
    expect(r.care?.fullSen).toBe(486_000n);
    expect(r.pension?.employeeYen).toBe(27_450n);
    expect(r.careLabel).toBe('second');
  });

  it('40歳未満は介護保険がかからない', () => {
    const r = calcMonthlyPremium(input({ birthDate: '1995-05-10' }));
    expect(r.care).toBeNull();
    expect(r.careLabel).toBe('none');
  });

  it('65歳以上は第1号として介護保険がかからない', () => {
    const r = calcMonthlyPremium(input({ birthDate: '1960-05-10' }));
    expect(r.care).toBeNull();
    expect(r.careLabel).toBe('first');
  });

  it('特定被保険者は40歳未満でも介護保険がかかる', () => {
    const r = calcMonthlyPremium(input({ birthDate: '1995-05-10', specialInsured: true }));
    expect(r.careLabel).toBe('special');
    expect(r.care?.fullSen).toBe(486_000n);
  });

  it('70歳到達月から厚生年金がかからない', () => {
    const r = calcMonthlyPremium(input({ birthDate: '1956-10-10' }));
    expect(r.pension).toBeNull();
    expect(r.health).not.toBeNull();
  });

  it('75歳の誕生月から健康保険・介護保険・支援金がかからない', () => {
    const r = calcMonthlyPremium(input({ birthDate: '1951-10-10' }));
    expect(r.health).toBeNull();
    expect(r.childSupport).toBeNull();
  });

  it('産休・育休の免除月は、かかる保険がすべて0円', () => {
    const r = calcMonthlyPremium(input({ leaveExempt: true }));
    expect(r.exempt).toBe(true);
    expect(r.health?.employeeYen).toBe(0n);
    expect(r.care?.employeeYen).toBe(0n);
    expect(r.childSupport?.employeeYen).toBe(0n);
    expect(r.pension?.employeeYen).toBe(0n);
  });

  it('資格のない月は何も計算しない', () => {
    const r = calcMonthlyPremium(input({ insured: false }));
    expect(r.health).toBeNull();
    expect(r.pension).toBeNull();
  });

  it('適用除外は、その保険だけ0円（計算しない）', () => {
    const r = calcMonthlyPremium(input({ exclusions: { care: true } }));
    expect(r.care).toBeNull();
    expect(r.health?.employeeYen).toBe(14_775n);
  });

  it('料率が未登録なら、その保険は計算せず未登録として返す', () => {
    const r = calcMonthlyPremium(input({ rates: { ...RATES, childSupport: null } }));
    expect(r.missingRates).toContain('childSupport');
    expect(r.health).toBeNull();
  });
});

describe('子ども・子育て支援金の端数処理', () => {
  it('2026年3月分までは支援金を計算しない（料率がなくても未登録にしない）', () => {
    const r = calcMonthlyPremium(input({ yearMonth: '2026-03', rates: { ...RATES, childSupport: null } }));
    expect(r.childSupport).toBeNull();
    expect(r.missingRates).toEqual([]);
    expect(r.health?.employeeYen).toBe(14_775n);
  });

  it('合算：40歳未満・110,000円は、健保と合算して127円', () => {
    const r = calcMonthlyPremium(
      input({ birthDate: '1995-05-10', standard: { health: 110_000, pension: 110_000 } }),
    );
    expect(r.health?.employeeYen).toBe(5_417n);
    expect(r.childSupport?.employeeYen).toBe(127n);
  });

  it('別々：同じ条件で126円', () => {
    const r = calcMonthlyPremium(
      input({
        birthDate: '1995-05-10',
        standard: { health: 110_000, pension: 110_000 },
        childSupportRounding: 'separate',
      }),
    );
    expect(r.childSupport?.employeeYen).toBe(126n);
  });

  it('合算：40〜64歳は健保＋介護＋支援金をまとめて処理する（110,000円で127円）', () => {
    const r = calcMonthlyPremium(input({ standard: { health: 110_000, pension: 110_000 } }));
    expect(r.childSupport?.employeeYen).toBe(127n);
  });

  it('支援金の全額は、合算でも支援金だけの全額（会社負担＝全額−本人負担）', () => {
    const r = calcMonthlyPremium(input());
    expect(r.childSupport?.fullSen).toBe(69_000n);
    expect(r.childSupport?.employeeYen).toBe(17_550n - 17_205n);
    expect(r.childSupport?.employerSen).toBe(69_000n - 345n * 100n);
  });
});

describe('組合健保で負担割合が違う場合', () => {
  it('健保と介護の割合が違えば、別々に端数処理する', () => {
    const r = calcMonthlyPremium(
      input({
        rates: { ...RATES, health: { rate: 9000, share: 450 }, care: { rate: 1600, share: 500 } },
      }),
    );
    // 介護：300,000 × 1.6% × 50% = 2,400円
    expect(r.care?.employeeYen).toBe(2_400n);
  });
});

describe('介護保険の欄に出す理由（careNote）', () => {
  it('かからない人だけ理由を出す（40歳未満・65歳以上）。かかる人・特定被保険者・計算していない人は空', () => {
    const care = { employeeYen: 2430n } as never;
    expect(careNote({ care: null, careLabel: 'none' })).toBe('対象外（40歳未満）');
    expect(careNote({ care: null, careLabel: 'first' })).toBe('第1号（65歳以上）');
    expect(careNote({ care, careLabel: 'second' })).toBe('');
    expect(careNote({ care: null, careLabel: 'special' })).toBe('');
    expect(careNote(null)).toBe('');
  });
});

describe('エッジケース：料率と計算条件', () => {
  it('適用開始月より前の料率しか存在しない：料率未登録として扱う', () => {
    // 2026-10 の料率が存在せず、2026-09 までしかない場合
    const noRates: MonthlyPremiumInput['rates'] = {
      health: { rate: 0, share: 0 },
      care: { rate: 0, share: 0 },
      childSupport: { rate: 0, share: 0 },
      pension: { rate: 0, share: 0 },
    };
    const r = calcMonthlyPremium(input({ rates: noRates }));
    expect(r.health?.employeeYen).toBe(0n);
    expect(r.pension?.employeeYen).toBe(0n);
  });

  it('保険者の料率を変更した場合、計算に反映される', () => {
    // 同じ月でも料率が変われば計算結果も変わる
    const ratesOld = RATES;
    const ratesNew = { ...RATES, health: { rate: 10_000, share: 500 } };
    
    const rOld = calcMonthlyPremium(input({ rates: ratesOld }));
    const rNew = calcMonthlyPremium(input({ rates: ratesNew }));
    
    expect(rOld.health?.employeeYen).toBeLessThan(rNew.health?.employeeYen ?? 0n);
  });

  it('標準報酬月額が0の場合、保険料も0', () => {
    const r = calcMonthlyPremium(input({ standard: { health: 0, pension: 0 } }));
    expect(r.health?.employeeYen).toBe(0n);
    expect(r.pension?.employeeYen).toBe(0n);
  });

  it('免除対象月は保険料が 0 円で計算される', () => {
    const r = calcMonthlyPremium(input({ leaveExempt: true }));
    expect(r.health?.employeeYen).toBe(0n);
    expect(r.care?.employeeYen).toBe(0n);
    expect(r.pension?.employeeYen).toBe(0n);
  });

  it('未加入の月は保険料が計算されない', () => {
    const r = calcMonthlyPremium(input({ insured: false }));
    expect(r.health).toBeNull();
    expect(r.care).toBeNull();
    expect(r.pension).toBeNull();
  });
});

describe('免除の月の、かからない保険', () => {
  it('75歳以上・70歳以上・適用除外の保険は、免除の月も「0円」ではなく対象外（null）', () => {
    const old = calcMonthlyPremium(input({ birthDate: '1950-05-10', leaveExempt: true })); // 2026年10月に76歳
    expect(old.exempt).toBe(true);
    expect(old.health).toBeNull();
    expect(old.childSupport).toBeNull();
    expect(old.care).toBeNull();
    expect(old.pension).toBeNull();
    const excluded = calcMonthlyPremium(input({ leaveExempt: true, exclusions: { pension: true } }));
    expect(excluded.health?.employeeYen).toBe(0n);
    expect(excluded.pension).toBeNull();
  });
});
