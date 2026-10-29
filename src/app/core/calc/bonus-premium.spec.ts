import { describe, expect, it } from 'vitest';
import {
  bonusExemption,
  bonusReportDeadline,
  bonusTarget,
  BonusRecord,
  calcEmployeeBonuses,
  fiscalYearOf,
  standardBonusOf,
} from './bonus-premium';
import { EmployeeData, Masters } from './employee-month';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'kumiai-office', name: '組合の事業所', prefecture: '', insurerId: 'k1' },
  ],
  insurers: [
    { id: 'kyokai', type: 'kyokai', name: '協会けんぽ' },
    { id: 'k1', type: 'kumiai', name: '〇〇健康保険組合' },
  ],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
    { insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9000, employeeShare: 500 },
    { insurerId: 'k1', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1600, employeeShare: 500 },
    { insurerId: 'k1', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

function emp(over: Partial<EmployeeData> = {}): EmployeeData {
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
const b = (id: string, paidDate: string, amount: number): BonusRecord => ({ id, employeeId: 'e1', paidDate, amount });

describe('基本', () => {
  it('標準賞与額は1,000円未満を切り捨てる', () => {
    expect(standardBonusOf(1_234_567)).toBe(1_234_000);
  });
  it('年度は4月〜翌3月', () => {
    expect(fiscalYearOf('2026-04-01')).toBe('2026');
    expect(fiscalYearOf('2027-03-31')).toBe('2026');
  });
  it('賞与支払届の期限は支給日から5日', () => {
    expect(bonusReportDeadline('2026-06-30')).toBe('2026-07-05');
    expect(bonusReportDeadline('2026-12-28')).toBe('2027-01-02');
  });
});

describe('保険料（月額と同じ端数処理）', () => {
  it('46歳・東京・50万円の賞与', () => {
    const [r] = calcEmployeeBonuses(emp(), [b('a', '2026-12-10', 500_000)], masters);
    expect(r.status).toBe('ok');
    expect(r.premium?.health?.employeeYen).toBe(24625n);
    expect(r.premium?.care?.employeeYen).toBe(4050n);
    expect(r.premium?.childSupport?.employeeYen).toBe(575n);
    expect(r.premium?.pension?.employeeYen).toBe(45750n);
    expect(r.rates?.health).toEqual({ rate: 9850, share: 500 });
  });
  it('70歳以上は厚生年金がかからない', () => {
    const [r] = calcEmployeeBonuses(emp({ birthDate: '1955-01-15' }), [b('a', '2026-12-10', 500_000)], masters);
    expect(r.premium?.pension).toBeNull();
    expect(r.premium?.health).not.toBeNull();
  });
});

describe('上限', () => {
  it('厚生年金は同じ月の合計150万円まで', () => {
    const r = calcEmployeeBonuses(emp(), [b('a', '2026-12-05', 1_000_000), b('b', '2026-12-20', 1_000_000)], masters);
    expect(r.map((x) => x.base.pension)).toEqual([1_000_000, 500_000]);
    expect(r[1].capped.pension).toBe(true);
    expect(r[1].base.health).toBe(1_000_000);
  });
  it('健康保険は年度累計573万円まで。次の年度は戻る', () => {
    const r = calcEmployeeBonuses(
      emp(),
      [b('a', '2026-07-10', 3_000_000), b('b', '2026-12-10', 3_000_000), b('c', '2027-07-10', 3_000_000)],
      masters,
    );
    expect(r.map((x) => x.base.health)).toEqual([3_000_000, 2_730_000, 3_000_000]);
  });
  it('年度の途中で保険者が変わったら、累計はやり直す', () => {
    const e = emp({
      assignments: [
        { validFrom: '2024-04-01', officeId: 'honsha' },
        { validFrom: '2026-10-01', officeId: 'kumiai-office' },
      ],
    });
    const r = calcEmployeeBonuses(e, [b('a', '2026-07-10', 5_000_000), b('b', '2026-12-10', 3_000_000)], masters);
    expect(r.map((x) => x.base.health)).toEqual([5_000_000, 3_000_000]);
    expect(r[1].insurerId).toBe('k1');
  });
});

describe('資格', () => {
  it('喪失月に喪失日の前日までに払った賞与は保険料なし（累計には含める）', () => {
    const q = [{ acquiredDate: '2024-04-01', lostDate: '2026-12-31' }];
    expect(bonusTarget(q, '2026-12-10')).toBe('lostMonth');
    const [r] = calcEmployeeBonuses(emp({ qualifications: q }), [b('a', '2026-12-10', 500_000)], masters);
    expect(r.premium).toBeNull();
    expect(r.base.health).toBe(500_000);
  });
  it('喪失日以降・取得日より前は対象外', () => {
    const q = [{ acquiredDate: '2026-04-01', lostDate: '2026-12-31' }];
    expect(bonusTarget(q, '2026-12-31')).toBe('outside');
    expect(bonusTarget(q, '2026-03-31')).toBe('outside');
  });
  it('同じ月に取得・喪失した月の賞与は保険料がかかる', () => {
    expect(bonusTarget([{ acquiredDate: '2026-12-01', lostDate: '2026-12-20' }], '2026-12-10')).toBe('charged');
  });
});

describe('産休・育休の免除', () => {
  it('育休：支払月の末日を含み、1か月を超える休業なら免除', () => {
    const leave = (startDate: string, endDate: string | null) => [{ type: 'childcare' as const, startDate, endDate }];
    expect(bonusExemption(leave('2026-11-20', '2026-12-25'), '2026-12-10')).toBe('none'); // 末日を含まない
    expect(bonusExemption(leave('2026-11-01', '2026-12-31'), '2026-12-10')).toBe('childcare');
    expect(bonusExemption(leave('2026-12-01', '2026-12-31'), '2026-12-10')).toBe('none'); // ちょうど1か月
    expect(bonusExemption(leave('2026-12-01', null), '2026-12-10')).toBe('childcare'); // 終了日が未定
  });
  it('産休：月額の免除月に当たれば免除', () => {
    const m = [{ type: 'maternity' as const, startDate: '2026-10-01', endDate: '2027-01-10' }];
    expect(bonusExemption(m, '2026-12-10')).toBe('maternity');
    expect(bonusExemption(m, '2027-01-20')).toBe('none');
  });
  it('免除された賞与は保険料0円で、累計には含める', () => {
    const leaves = [{ type: 'childcare' as const, startDate: '2026-11-01', endDate: '2027-03-31' }];
    const [r] = calcEmployeeBonuses(emp({ leaves }), [b('a', '2026-12-10', 500_000)], masters);
    expect(r.exemption).toBe('childcare');
    expect(r.premium?.health?.employeeYen).toBe(0n);
    expect(r.base.health).toBe(500_000);
  });
});
