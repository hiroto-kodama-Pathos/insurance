import { calcCompanyTotals, calcPremium, senToDisplayYen } from './premium-calculator';

describe('保険料の計算', () => {
  it('健保＋介護を合算して1回だけ端数処理する（東京・45歳・134,000円）', () => {
    const r = calcPremium(134_000, 9850 + 1620, 500);
    expect(r.fullSen).toBe(1_536_980n);
    expect(r.employeeYen).toBe(7_685n);
  });

  it('142,000円でも保険料額表の折半額（8,143.7円）と一致する', () => {
    expect(calcPremium(142_000, 9850 + 1620, 500).employeeYen).toBe(8_144n);
  });

  it('50銭ちょうどは切り捨て（賞与55万円の健康保険料）', () => {
    const r = calcPremium(550_000, 9850, 500);
    expect(r.fullSen).toBe(5_417_500n);
    expect(r.employeeYen).toBe(27_087n);
    expect(senToDisplayYen(r.employerSen)).toBe(27_088n);
  });

  it('会社負担は銭単位で持ち、表示は円未満を切り捨てる（全額939.60円）', () => {
    // 標準報酬月額 1,000円 × 93.96% のような仮の値で全額939.60円を作る
    const r = calcPremium(1_000, 93_960, 500);
    expect(r.fullSen).toBe(93_960n);
    expect(r.employeeYen).toBe(470n);
    expect(r.employerSen).toBe(46_960n);
    expect(senToDisplayYen(r.employerSen)).toBe(469n);
  });

  it('二以上事業所勤務は自社の報酬の割合で按分する', () => {
    const r = calcPremium(300_000, 18_300, 500, 200_000, 300_000);
    expect(r.fullSen).toBe(3_660_000n);
    expect(r.employeeYen).toBe(18_300n);
    expect(senToDisplayYen(r.employerSen)).toBe(18_300n);
  });

  it('合計の報酬が0ならエラーにする', () => {
    expect(() => calcPremium(300_000, 18_300, 500, 0, 0)).toThrow();
  });
});

describe('納付見込額・会社負担合計', () => {
  it('全額を合計してから円未満を切り捨て、会社負担合計は納付見込額 − 本人負担合計', () => {
    const t = calcCompanyTotals([
      { fullSen: 100_030n, employeeYen: 500n },
      { fullSen: 100_030n, employeeYen: 500n },
    ]);
    expect(t.paymentYen).toBe(2_000n);
    expect(t.employeeTotal).toBe(1_000n);
    expect(t.employerTotal).toBe(1_000n);
  });

  it('事業所ごとに切り捨て、会社全体は足し上げるだけ（3,001円にしない）', () => {
    const honsha = calcCompanyTotals([{ fullSen: 100_060n, employeeYen: 500n }]);
    const osaka = calcCompanyTotals([{ fullSen: 200_060n, employeeYen: 1_000n }]);
    expect(honsha.paymentYen).toBe(1_000n);
    expect(osaka.paymentYen).toBe(2_000n);
    expect(honsha.paymentYen + osaka.paymentYen).toBe(3_000n);
  });
});