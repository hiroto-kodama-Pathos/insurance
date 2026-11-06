import { describe, expect, it } from 'vitest';
import { Insurer, InsurerRate } from './rate';
import {
  checkKumiai,
  checkKumiaiRates,
  EMPTY_KUMIAI_RATES,
  checkOffice,
  checkRate,
  checkSettings,
  DEFAULT_SETTINGS,
  percentToRate,
  RateInput,
  rateToPercent,
  shareFromRates,
} from './settings';

const kyokai: Insurer = { id: 'kyokai', type: 'kyokai', name: '全国健康保険協会' };
const kumiai: Insurer = { id: 'k1', type: 'kumiai', name: '〇〇健康保険組合' };

describe('percentToRate / rateToPercent', () => {
  it('%を10万分率の整数にする（浮動小数点の誤差なし）', () => {
    expect(percentToRate('9.85')).toBe(9850);
    expect(percentToRate('10')).toBe(10000);
    expect(percentToRate('0.23')).toBe(230);
    expect(percentToRate('1.159')).toBe(1159);
    expect(percentToRate(' 18.3 ')).toBe(18300);
  });
  it('形が違えば null', () => {
    expect(percentToRate('')).toBeNull();
    expect(percentToRate('9.8512')).toBeNull();
    expect(percentToRate('abc')).toBeNull();
    expect(percentToRate('-1')).toBeNull();
    expect(percentToRate('100')).toBeNull();
  });
  it('表示に戻す', () => {
    expect(rateToPercent(9850)).toBe('9.85');
    expect(rateToPercent(10000)).toBe('10');
    expect(rateToPercent(230)).toBe('0.23');
  });
});

describe('shareFromRates', () => {
  it('折半と、本人が少ない組合', () => {
    expect(shareFromRates(9000, 4500)).toBe(500);
    expect(shareFromRates(10000, 4500)).toBe(450);
  });
  it('千分率で割り切れなければ null', () => {
    expect(shareFromRates(9500, 4200)).toBeNull();
  });
});

describe('checkOffice', () => {
  const base = { name: '本社', prefecture: '東京都', insurerId: 'kyokai', isDefault: false };
  it('正しい入力', () => {
    expect(checkOffice(base, [kyokai], [])).toEqual({});
  });
  it('協会けんぽは都道府県が必須、組合健保は任意', () => {
    expect(checkOffice({ ...base, prefecture: '' }, [kyokai], [])).toHaveProperty('prefecture');
    expect(checkOffice({ ...base, prefecture: '', insurerId: 'k1' }, [kumiai], [])).toEqual({});
  });
  it('名前の重複・保険者なし', () => {
    const e = checkOffice({ ...base, insurerId: '' }, [kyokai], [{ id: 'x', name: '本社', prefecture: '', insurerId: 'kyokai' }]);
    expect(Object.keys(e).sort()).toEqual(['insurerId', 'name']);
  });
});

describe('checkKumiai', () => {
  it('名前が必須で、重複しない', () => {
    expect(checkKumiai({ name: '', specialInsuredEnabled: false }, [])).toHaveProperty('name');
    expect(checkKumiai({ name: '〇〇健康保険組合', specialInsuredEnabled: false }, [kumiai])).toHaveProperty('name');
    expect(checkKumiai({ name: '△△健康保険組合', specialInsuredEnabled: true }, [kumiai])).toEqual({});
  });
});

describe('checkRate', () => {
  const input: RateInput = { insurerId: 'k1', rateType: 'health', validFrom: '2026-03', rate: '9.5', employeeRate: '' };
  it('本人の料率が空なら折半', () => {
    expect(checkRate(input, []).value).toEqual({
      insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9500, employeeShare: 500,
    });
  });
  it('本人の料率から負担割合を求める', () => {
    expect(checkRate({ ...input, rate: '10', employeeRate: '4.5' }, []).value?.employeeShare).toBe(450);
  });
  it('割り切れない・全体より大きい本人の料率はエラー', () => {
    expect(checkRate({ ...input, employeeRate: '4.2' }, []).errors).toHaveProperty('employeeRate');
    expect(checkRate({ ...input, employeeRate: '9.6' }, []).errors).toHaveProperty('employeeRate');
  });
  it('同じ種類・同じ月の二重登録はエラー（種類が違えばよい）', () => {
    const existing: InsurerRate = { insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9000, employeeShare: 500 };
    expect(checkRate(input, [existing]).errors).toHaveProperty('validFrom');
    expect(checkRate({ ...input, rateType: 'care' }, [existing]).errors).toEqual({});
  });
  it('支援金は2026年4月分より前は登録できない', () => {
    expect(checkRate({ ...input, rateType: 'childSupport', rate: '0.23' }, []).errors).toHaveProperty('validFrom');
    expect(checkRate({ ...input, rateType: 'childSupport', rate: '0.23', validFrom: '2026-04' }, []).errors).toEqual({});
  });
  it('料率の形が違えばエラーで、値は返さない', () => {
    const r = checkRate({ ...input, rate: '9.5%' }, []);
    expect(r.errors).toHaveProperty('rate');
    expect(r.value).toBeNull();
  });
});

describe('checkSettings', () => {
  it('締め日は1〜30日か末日', () => {
    expect(checkSettings(DEFAULT_SETTINGS)).toEqual({});
    // 利用開始日：空（null）か、正しい日付
    expect(checkSettings({ ...DEFAULT_SETTINGS, startDate: '2026-11-01' })).toEqual({});
    expect(checkSettings({ ...DEFAULT_SETTINGS, startDate: '2026-02-30' })).toHaveProperty('startDate');
    expect(checkSettings({ ...DEFAULT_SETTINGS, payrollCutoff: { day: 25, paidIn: 'sameMonth' } })).toEqual({});
    expect(checkSettings({ ...DEFAULT_SETTINGS, payrollCutoff: { day: 31, paidIn: 'sameMonth' } })).toHaveProperty('cutoffDay');
  });
});

describe('健康保険組合の追加と一緒に登録する料率（checkKumiaiRates）', () => {
  const base = { ...EMPTY_KUMIAI_RATES, validFrom: '2026-04', health: { rate: '9.5', employeeRate: '' } };

  it('健康保険だけ入れれば登録できる。空欄の介護保険・支援金は登録しない種類として返す', () => {
    const r = checkKumiaiRates(base);
    expect(r.errors).toEqual({});
    expect(r.rates).toEqual([{ rateType: 'health', prefecture: null, validFrom: '2026-04', rate: 9500, employeeShare: 500 }]);
    expect(r.skipped).toEqual(['care', 'childSupport']);
  });

  it('3つとも入れると、同じ適用開始月で3件。本人の料率から負担割合を求める', () => {
    const r = checkKumiaiRates({
      ...base,
      health: { rate: '10', employeeRate: '4.5' },
      care: { rate: '1.8', employeeRate: '' },
      childSupport: { rate: '0.23', employeeRate: '' },
    });
    expect(r.errors).toEqual({});
    expect(r.rates.map((x) => [x.rateType, x.rate, x.employeeShare])).toEqual([
      ['health', 10000, 450], ['care', 1800, 500], ['childSupport', 230, 500],
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('健康保険の料率がない・適用開始月がない・本人の料率が全体より大きいときはエラー。エラーがあれば何も登録しない', () => {
    const r = checkKumiaiRates({ ...EMPTY_KUMIAI_RATES, care: { rate: '1.8', employeeRate: '2' } });
    expect(r.errors['kumiaiFrom']).toContain('適用開始月');
    expect(r.errors['healthRate']).toContain('料率を%で');
    expect(r.errors['careEmployeeRate']).toContain('全体の料率以下');
    expect(r.rates).toEqual([]);
  });

  it('2026年3月以前からの登録で支援金を入れると、支援金の欄にエラーを出す（空欄ならよい）', () => {
    const early = { ...base, validFrom: '2026-03' };
    expect(checkKumiaiRates({ ...early, childSupport: { rate: '0.23', employeeRate: '' } }).errors['childSupportRate']).toContain('2026年4月分から');
    expect(checkKumiaiRates(early).errors).toEqual({});
  });
});
