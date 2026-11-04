// 特定被保険者制度（組合健保）のテスト
//
// 特定被保険者：介護保険の第2号被保険者（40〜64歳）ではない被保険者（40歳未満・65歳以上）のうち、
// 40〜64歳の被扶養者がいる人。規約で制度を設けた組合健保だけが、この人から介護保険料を取れる（協会けんぽにはない）。
//
// 確かめること
//   1. 対象になる保険者：制度のある組合健保だけ
//   2. 被扶養者の年齢：40歳到達月から64歳（65歳到達月の前月）まで。年齢到達日は誕生日の前日（1日生まれ・2月29日生まれに注意）
//   3. 扶養の期間：認定日の月から、外れた日の月の前月まで（月の途中でも、その月の末日の状態で決める）
//   4. 被扶養者が複数いるとき：1人でも当てはまればかける
//   5. 本人の年齢との組み合わせ：本人が40〜64歳なら第2号として（特定ではなく）かける。65歳以上は特定になりうる。75歳からは健康保険ごと終わる
//   6. 月額・賞与の計算：介護保険料の額と、育休の免除、事業所の異動（協会けんぽ ⇄ 組合健保）
//   7. 被扶養者の介護保険の適用除外（国外居住・施設入所）：該当年月日の月から、非該当年月日の月の前月まで、数えない
//
// 正解は、条文の決まりから手で求めた月・額を書いている（アプリの年齢計算の関数からは作らない）。
import { describe, expect, it } from 'vitest';
import { calcEmployeeBonuses } from './bonus-premium';
import {
  careExemptionLabel,
  checkDependentCareExemption,
  Dependent,
  DependentCareExemption,
  isDependentCareExemptInMonth,
  isDependentInMonth,
  isSpecialInsuredMonth,
  withCareExemption,
} from './dependent';
import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import type { Insurer } from './rate';

const kumiai: Insurer = { id: 'k1', type: 'kumiai', name: '〇〇健康保険組合', specialInsuredEnabled: true };
const kumiaiWithout: Insurer = { id: 'k2', type: 'kumiai', name: '△△健康保険組合', specialInsuredEnabled: false };
const kyokai: Insurer = { id: 'kyokai', type: 'kyokai', name: '協会けんぽ' };

const dep = (birthDate: string, certifiedDate = '2020-01-01', removedDate: string | null = null): Dependent => ({
  name: '被扶養者',
  birthDate,
  certifiedDate,
  removedDate,
});
/** 制度のある組合健保で、その月に特定被保険者になるか */
const special = (dependents: Dependent[], ym: string) => isSpecialInsuredMonth(kumiai, dependents, ym);

// ---------------------------------------------------------------------------
describe('特定被保険者：対象になる保険者', () => {
  const wife = dep('1980-05-10'); // 2026年は46歳
  it('制度のある組合健保だけ。制度のない組合健保・協会けんぽでは、40〜64歳の被扶養者がいても対象にならない', () => {
    expect(isSpecialInsuredMonth(kumiai, [wife], '2026-10')).toBe(true);
    expect(isSpecialInsuredMonth(kumiaiWithout, [wife], '2026-10')).toBe(false);
    expect(isSpecialInsuredMonth(kyokai, [wife], '2026-10')).toBe(false);
  });

  it('協会けんぽに「制度あり」の印が誤って付いていても、対象にならない（制度は組合健保だけ）', () => {
    expect(isSpecialInsuredMonth({ ...kyokai, specialInsuredEnabled: true }, [wife], '2026-10')).toBe(false);
  });

  it('被扶養者がいない・登録がない（undefined）なら対象にならない', () => {
    expect(isSpecialInsuredMonth(kumiai, [], '2026-10')).toBe(false);
    expect(isSpecialInsuredMonth(kumiai, undefined, '2026-10')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('特定被保険者：被扶養者の年齢の境界（年齢到達日＝誕生日の前日の月から）', () => {
  it.each([
    // [生年月日, 40歳到達月の前月（対象外）, 40歳到達月（対象）, 説明]
    ['1986-11-15', '2026-10', '2026-11', '15日生まれ：誕生日の月から'],
    ['1986-11-02', '2026-10', '2026-11', '2日生まれ：前日の1日に到達するので、誕生日の月から'],
    ['1986-11-01', '2026-09', '2026-10', '1日生まれ：前日（前月の末日）に到達するので、誕生日の前月から'],
    ['1987-01-01', '2026-11', '2026-12', '1月1日生まれ：前年の12月31日に到達するので、前年の12月から'],
    ['1988-02-29', '2028-01', '2028-02', '2月29日生まれ（40歳の年はうるう年）：2月28日に到達'],
  ])('40歳：%s 生まれは %s は対象外、%s から対象（%s）', (birth, before, from) => {
    expect(special([dep(birth)], before)).toBe(false);
    expect(special([dep(birth)], from)).toBe(true);
  });

  it.each([
    // [生年月日, 64歳の最後の月（対象）, 65歳到達月（対象外）, 説明]
    ['1961-11-15', '2026-10', '2026-11', '15日生まれ：誕生日の月から外れる'],
    ['1961-11-01', '2026-09', '2026-10', '1日生まれ：誕生日の前月から外れる'],
    ['1962-01-01', '2026-11', '2026-12', '1月1日生まれ：前年の12月から外れる'],
    ['1984-02-29', '2049-01', '2049-02', '2月29日生まれ（65歳の年はうるう年でない）：2月28日に到達'],
  ])('65歳：%s 生まれは %s まで対象、%s から対象外（%s）', (birth, last, from) => {
    expect(special([dep(birth)], last)).toBe(true);
    expect(special([dep(birth)], from)).toBe(false);
  });

  it('扶養に入ったときは39歳でも、40歳到達月から自動で対象になる（登録し直しは要らない）', () => {
    const child = dep('1986-11-15', '2010-04-01');
    expect(special([child], '2026-10')).toBe(false);
    expect(special([child], '2026-11')).toBe(true);
    expect(special([child], '2027-11')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('特定被保険者：扶養の期間の境界（月の末日に扶養に入っているか）', () => {
  const b = '1975-06-10'; // 2026年は51歳（年齢は常に対象）

  it.each([
    ['2026-04-01', '2026-03', '2026-04', '1日に認定'],
    ['2026-04-15', '2026-03', '2026-04', '月の途中に認定'],
    ['2026-04-30', '2026-03', '2026-04', '末日に認定（その月の末日に扶養に入っている）'],
  ])('認定日 %s：%s は対象外、%s から対象（%s）', (certified, before, from) => {
    expect(isDependentInMonth(dep(b, certified), before)).toBe(false);
    expect(special([dep(b, certified)], before)).toBe(false);
    expect(special([dep(b, certified)], from)).toBe(true);
  });

  it.each([
    ['2026-09-01', '2026-08', '2026-09', '1日に外れた'],
    ['2026-09-15', '2026-08', '2026-09', '月の途中に外れた'],
    ['2026-09-30', '2026-08', '2026-09', '末日に外れた（その月の末日には扶養に入っていない）'],
  ])('外れた日 %s：%s まで対象、%s から対象外（%s）', (removed, last, from) => {
    const d = dep(b, '2024-04-01', removed);
    expect(special([d], last)).toBe(true);
    expect(special([d], from)).toBe(false);
    expect(special([d], '2027-01')).toBe(false);
  });

  it('同じ月に扶養に入って外れた人は、その月も対象にならない', () => {
    expect(special([dep(b, '2026-09-05', '2026-09-25')], '2026-09')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('特定被保険者：被扶養者が複数いるとき', () => {
  it('1人でも40〜64歳なら対象（39歳の子と51歳の妻）', () => {
    expect(special([dep('2000-01-10'), dep('1975-06-10')], '2026-10')).toBe(true);
  });

  it('対象の人が65歳になっても、ほかに40〜64歳の人がいれば続く。いなくなった月から外れる', () => {
    const father = dep('1961-11-15'); // 2026-11 に65歳
    const wife = dep('1986-12-20'); // 2026-12 に40歳
    expect(special([father, wife], '2026-10')).toBe(true); // 父が64歳
    expect(special([father, wife], '2026-11')).toBe(false); // 父は65歳、妻はまだ39歳 → 1か月だけ外れる
    expect(special([father, wife], '2026-12')).toBe(true); // 妻が40歳
  });

  it('対象の人が扶養から外れても、ほかの人がまだ扶養に入っていれば続く', () => {
    const a = dep('1975-06-10', '2024-04-01', '2026-09-15');
    const c = dep('1978-03-03', '2026-08-20');
    expect(special([a, c], '2026-09')).toBe(true);
    expect(special([a], '2026-09')).toBe(false);
  });

  it('40〜64歳でも、扶養から外れた人は数えない（39歳の子だけが残る）', () => {
    expect(special([dep('1975-06-10', '2024-04-01', '2026-05-01'), dep('2000-01-10')], '2026-10')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 月額・賞与の計算（介護保険料がかかるか、いくらか）
// 料率：健康保険 9.00%・介護保険 1.60%（いずれも本人50%）。標準報酬月額30万円
//   介護保険料の全額 = 300,000 × 1.6% = 4,800円、本人 2,400円（健康保険と合算しても端数は出ない）

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'k1' },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
  ],
  insurers: [kumiai, kyokai],
  insurerRates: [
    { insurerId: 'k1', rateType: 'health', prefecture: null, validFrom: '2026-03', rate: 9000, employeeShare: 500 },
    { insurerId: 'k1', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1600, employeeShare: 500 },
    { insurerId: 'k1', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'health', prefecture: '大阪府', validFrom: '2026-03', rate: 10000, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1600, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

const wife = dep('1980-05-10', '2024-04-01'); // 2026年は46歳

function employee(over: Partial<EmployeeData> = {}): EmployeeData {
  return {
    id: 'e1',
    birthDate: '1991-05-10', // 2026年は35歳（第2号ではない）
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [],
    exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 300_000, pensionStandard: 300_000 }],
    dependents: [wife],
    ...over,
  };
}
const month = (e: EmployeeData, ym: string) => calcEmployeeMonth(e, masters, ym).premium!;

describe('特定被保険者：月額の介護保険料', () => {
  it('本人35歳・妻46歳：介護保険料がかかり、区分は「特定」。全額4,800円・本人2,400円・会社2,400円', () => {
    const p = month(employee(), '2026-10');
    expect(p.careLabel).toBe('special');
    expect(p.care!.employeeYen).toBe(2_400n);
    expect(p.care!.fullSen).toBe(480_000n);
    expect(p.care!.employerSen).toBe(240_000n);
  });

  it('被扶養者がいなければ、本人35歳には介護保険料がかからない', () => {
    const p = month(employee({ dependents: [] }), '2026-10');
    expect(p.careLabel).toBe('none');
    expect(p.care).toBeNull();
  });

  it('本人が40歳になった月からは、第2号として（特定ではなく）かかる。額は同じ', () => {
    const e = employee({ birthDate: '1986-11-15' }); // 2026-11 に40歳
    expect(month(e, '2026-10').careLabel).toBe('special');
    expect(month(e, '2026-11').careLabel).toBe('second');
    expect(month(e, '2026-11').care!.employeeYen).toBe(2_400n);
  });

  it('本人が65歳になった月から：40〜64歳の妻がいれば「特定」で続き、いなければかからない', () => {
    const me = { birthDate: '1961-11-15' }; // 2026-11 に65歳
    expect(month(employee({ ...me }), '2026-10').careLabel).toBe('second');
    expect(month(employee({ ...me }), '2026-11').careLabel).toBe('special');
    expect(month(employee({ ...me }), '2026-11').care!.employeeYen).toBe(2_400n);
    const alone = month(employee({ ...me, dependents: [] }), '2026-11');
    expect(alone.careLabel).toBe('first');
    expect(alone.care).toBeNull();
  });

  it('本人が75歳になった月からは、健康保険とともに介護保険料もかからない（40〜64歳の被扶養者がいても）', () => {
    // 75歳の誕生日の月から後期高齢者医療制度。被扶養者は75歳未満なので、そのまま妻を残しておく
    const e = employee({ birthDate: '1951-11-15', dependents: [dep('1970-01-10')] });
    expect(month(e, '2026-10').care!.employeeYen).toBe(2_400n);
    const p = month(e, '2026-11');
    expect(p.health).toBeNull();
    expect(p.care).toBeNull();
  });

  it('妻が扶養から外れた月から、介護保険料がかからなくなる', () => {
    const e = employee({ dependents: [dep('1980-05-10', '2024-04-01', '2026-10-20')] });
    expect(month(e, '2026-09').care!.employeeYen).toBe(2_400n);
    expect(month(e, '2026-10').care).toBeNull();
  });

  it('産休・育休で免除される月は、特定被保険者の介護保険料も0円（免除）', () => {
    const p = month(employee({ leaves: [{ type: 'childcare', startDate: '2026-09-01', endDate: null }] }), '2026-10');
    expect(p.exempt).toBe(true);
    expect(p.careLabel).toBe('special');
    expect(p.care!.employeeYen).toBe(0n);
  });

  it('協会けんぽの事業所に異動した月からは、かからない（協会けんぽには制度がない）', () => {
    const e = employee({
      assignments: [
        { validFrom: '2024-04-01', officeId: 'honsha' },
        { validFrom: '2026-10-01', officeId: 'osaka' },
      ],
    });
    expect(month(e, '2026-09').careLabel).toBe('special');
    const p = month(e, '2026-10');
    expect(p.careLabel).toBe('none');
    expect(p.care).toBeNull();
  });

  it('制度のない組合健保では、かからない', () => {
    const m: Masters = {
      ...masters,
      insurers: [kumiaiWithout, kyokai],
      insurerRates: masters.insurerRates.map((r) => (r.insurerId === 'k1' ? { ...r, insurerId: 'k2' } : r)),
      offices: masters.offices.map((o) => (o.insurerId === 'k1' ? { ...o, insurerId: 'k2' } : o)),
    };
    const p = calcEmployeeMonth(employee(), m, '2026-10').premium!;
    expect(p.careLabel).toBe('none');
    expect(p.care).toBeNull();
  });
});

describe('特定被保険者：賞与の介護保険料', () => {
  const bonus = (paidDate: string) => ({ id: 'b1', employeeId: 'e1', paidDate, amount: 500_000 });

  it('支給月に40〜64歳の被扶養者がいれば、賞与にも介護保険料がかかる（50万円 × 1.6% × 50% = 4,000円）', () => {
    const [r] = calcEmployeeBonuses(employee(), [bonus('2026-12-10')], masters);
    expect(r.premium!.careLabel).toBe('special');
    expect(r.premium!.care!.employeeYen).toBe(4_000n);
  });

  it('支給月に扶養から外れていれば、賞与に介護保険料はかからない', () => {
    const e = employee({ dependents: [dep('1980-05-10', '2024-04-01', '2026-12-01')] });
    const [r] = calcEmployeeBonuses(e, [bonus('2026-12-10')], masters);
    expect(r.premium!.care).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('特定被保険者：被扶養者の介護保険の適用除外（国外居住・適用除外施設への入所など）', () => {
  const b = '1975-06-10'; // 2026年は51歳（年齢は常に対象）
  const exempt = (careExemptions: DependentCareExemption[]): Dependent => ({ ...dep(b, '2024-04-01'), careExemptions });

  it.each([
    ['2026-04-01', '1日に該当'],
    ['2026-04-16', '月の途中に該当（国外転出が4月15日）'],
    ['2026-04-30', '末日に該当'],
  ])('該当年月日 %s：前月までは対象、該当年月日の月から対象外（%s）', (start) => {
    const d = exempt([{ startDate: start, endDate: null }]);
    expect(special([d], '2026-03')).toBe(true);
    expect(isDependentCareExemptInMonth(d, '2026-04')).toBe(true);
    expect(special([d], '2026-04')).toBe(false);
    expect(special([d], '2030-01')).toBe(false); // 該当中のあいだはずっと対象外
  });

  it.each([
    ['2027-03-01', '1日に非該当'],
    ['2027-03-15', '月の途中に非該当（帰国して住所を持った日）'],
    ['2027-03-31', '末日に非該当'],
  ])('非該当年月日 %s：前月までは対象外、非該当年月日の月から対象に戻る（%s）', (end) => {
    const d = exempt([{ startDate: '2026-04-16', endDate: end }]);
    expect(special([d], '2027-02')).toBe(false);
    expect(special([d], '2027-03')).toBe(true);
  });

  it('同じ月に該当して非該当になった期間は、その月も対象のまま', () => {
    expect(special([exempt([{ startDate: '2026-09-05', endDate: '2026-09-25' }])], '2026-09')).toBe(true);
  });

  it('期間が2回あるとき：それぞれの期間だけ外す', () => {
    const d = exempt([
      { startDate: '2026-04-16', endDate: '2026-07-01' },
      { startDate: '2026-10-02', endDate: null },
    ]);
    expect(['2026-03', '2026-04', '2026-06', '2026-07', '2026-09', '2026-10'].map((ym) => special([d], ym))).toEqual([
      true, false, false, true, true, false,
    ]);
  });

  it('適用除外の被扶養者のほかに、40〜64歳の被扶養者がいれば続く', () => {
    const abroad = exempt([{ startDate: '2026-04-16', endDate: null }]);
    expect(special([abroad, dep('1978-03-03')], '2026-10')).toBe(true);
    expect(special([abroad, dep('2000-01-10')], '2026-10')).toBe(false); // もう1人は26歳
  });

  it('月額：妻が国外に転出した月から、本人35歳の介護保険料がかからなくなる', () => {
    const e = employee({ dependents: [{ ...wife, careExemptions: [{ startDate: '2026-11-11', endDate: null }] }] });
    expect(month(e, '2026-10').care!.employeeYen).toBe(2_400n);
    const p = month(e, '2026-11');
    expect(p.careLabel).toBe('none');
    expect(p.care).toBeNull();
  });

  it('賞与：支給月に妻が適用除外なら、賞与に介護保険料はかからない', () => {
    const e = employee({ dependents: [{ ...wife, careExemptions: [{ startDate: '2026-12-01', endDate: '2027-01-10' }] }] });
    const [dec, jan] = calcEmployeeBonuses(
      e,
      [
        { id: 'b1', employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000 },
        { id: 'b2', employeeId: 'e1', paidDate: '2027-01-20', amount: 500_000 },
      ],
      masters,
    );
    expect(dec.premium!.care).toBeNull();
    expect(jan.premium!.care!.employeeYen).toBe(4_000n);
  });
});

describe('被扶養者の介護保険の適用除外：入力チェック', () => {
  const d = (careExemptions: DependentCareExemption[] = []): Dependent => ({ ...dep('1975-06-10', '2024-04-01'), careExemptions });

  it('日付の形・順番', () => {
    expect(checkDependentCareExemption(d(), { startDate: '', endDate: '' })).toEqual({ startDate: '該当年月日を正しく入力してください' });
    expect(checkDependentCareExemption(d(), { startDate: '2026-04-16', endDate: '2026-02-30' }).endDate).toBe('非該当年月日を正しく入力してください');
    expect(checkDependentCareExemption(d(), { startDate: '2026-04-16', endDate: '2026-04-16' }).endDate).toBe('非該当年月日は該当年月日より後の日にしてください');
    expect(checkDependentCareExemption(d(), { startDate: '1975-06-09', endDate: '' }).startDate).toBe('該当年月日は生年月日以降の日にしてください');
    expect(checkDependentCareExemption(d(), { startDate: '2026-04-16', endDate: '' })).toEqual({});
  });

  it('同じ人の期間と重ならない（隣り合う日は重ならない）', () => {
    const closed = d([{ startDate: '2026-04-16', endDate: '2026-07-01' }]);
    expect(checkDependentCareExemption(closed, { startDate: '2026-06-30', endDate: '' }).startDate).toBe('この人の適用除外の期間と重なっています');
    expect(checkDependentCareExemption(closed, { startDate: '2026-07-01', endDate: '' })).toEqual({});
    expect(checkDependentCareExemption(closed, { startDate: '2026-01-01', endDate: '2026-04-16' })).toEqual({});
    const open = d([{ startDate: '2026-04-16', endDate: null }]);
    expect(checkDependentCareExemption(open, { startDate: '2027-01-01', endDate: '' }).startDate).toBe('この人の適用除外の期間と重なっています');
  });

  it('非該当年月日を入れるときは、その期間自身とは比べない', () => {
    const open = d([{ startDate: '2026-04-16', endDate: null }]);
    expect(checkDependentCareExemption(open, { startDate: '2026-04-16', endDate: '2027-03-15' }, 0)).toEqual({});
  });

  it('保存する一覧：足すと該当年月日の順に並び、非該当年月日はその期間だけを書き換える。表示は「〜（該当中）」', () => {
    const base = d([{ startDate: '2026-10-02', endDate: null }]);
    expect(withCareExemption(base, { startDate: '2026-04-16', endDate: '2026-07-01' })).toEqual([
      { startDate: '2026-04-16', endDate: '2026-07-01' },
      { startDate: '2026-10-02', endDate: null },
    ]);
    expect(withCareExemption(base, { startDate: '2026-10-02', endDate: '2027-03-15' }, 0)).toEqual([{ startDate: '2026-10-02', endDate: '2027-03-15' }]);
    expect(careExemptionLabel({ startDate: '2026-10-02', endDate: null })).toBe('2026年10月2日〜（該当中）');
  });
});
