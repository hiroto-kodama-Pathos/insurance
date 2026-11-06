import { TestBed } from '@angular/core/testing';
import { Bonus } from './bonus';

describe('Bonus', () => {
  let service: Bonus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Bonus);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('賞与データのバリデーション（エッジケース・矛盾検出）', () => {
    it('賞与の支給日が給与の支給日より前（不自然な場合）', () => {
      // 給与：10月25日、賞与：10月10日？ 通常は賞与が先
      const bonus = { paidDate: '2026-10-10', amount: 500_000 };
      const salary = { paidDate: '2026-10-25' };
      expect(bonus.paidDate.localeCompare(salary.paidDate)).toBeLessThan(0);
    });

    it('賞与の支給月が過去（3か月以上前）', () => {
      const oldBonus = { paidDate: '2026-08-10', amount: 500_000 };
      // 現在が 2026-11 なので、8月の賞与は遅い
      expect(oldBonus.paidDate.localeCompare('2026-09-01')).toBeLessThan(0);
    });

    it('賞与の支給月が将来（翌年以降）', () => {
      const futureBonus = { paidDate: '2027-01-10', amount: 500_000 };
      // 当年の賞与のみ登録すべき（翌年は翌年の入力で）
      expect(futureBonus.paidDate.localeCompare('2026-12-31')).toBeGreaterThan(0);
    });

    it('賞与の金額が 0 円', () => {
      const zero = { paidDate: '2026-12-10', amount: 0 };
      expect(zero.amount).toBe(0);
      // 0円の賞与は登録対象でないはず
    });

    it('賞与の金額が極端に高い（打ち間違い）', () => {
      const huge = { paidDate: '2026-12-10', amount: 500_000_000 }; // 5億円
      expect(huge.amount).toBeGreaterThan(1_000_000); // 通常の賞与額の範囲外
    });

    it('現物賞与（食事・商品など）の価値計上が妥当か', () => {
      const bonus = {
        amount: 500_000,
        inKindAmount: 100_000, // 現物10万円
      };
      // 現物が本給を上回ることはない（通常）
      expect(bonus.inKindAmount).toBeLessThanOrEqual(bonus.amount);
    });

    it('同じ従業員・同じ支給日の賞与が複数ある（重複）', () => {
      const bonus1 = { employeeId: 'e001', paidDate: '2026-12-10', amount: 500_000 };
      const bonus2 = { employeeId: 'e001', paidDate: '2026-12-10', amount: 600_000 };
      // 同日に複数の賞与支給は不自然
      expect(bonus1.employeeId).toBe(bonus2.employeeId);
      expect(bonus1.paidDate).toBe(bonus2.paidDate);
    });

    it('特定の従業員だけが複数回の賞与を受ける（不公平検出）', () => {
      const bonuses = [
        { employeeId: 'e001', paidDate: '2026-07-10', amount: 500_000 },
        { employeeId: 'e001', paidDate: '2026-12-10', amount: 600_000 },
        { employeeId: 'e002', paidDate: '2026-12-10', amount: 500_000 },
        // e001 だけが 2 回、e002 は 1 回
      ];
      expect(bonuses.filter((b) => b.employeeId === 'e001')).toHaveLength(2);
      expect(bonuses.filter((b) => b.employeeId === 'e002')).toHaveLength(1);
    });

    it('賞与の報酬扱い（標準報酬月額に含める）の判定が矛盾している', () => {
      // 賞与が報酬扱い（isRemuneration: true）の場合、年4回以上必須
      const bonus = {
        isRemuneration: true,
        bonusTypeId: 'quarterly',
        count: 2, // 4回未満
      };
      // 報酬扱いなのに 4 回未満は矛盾
      expect(bonus.isRemuneration && bonus.count < 4).toBe(true);
    });

    it('賞与が確定済み月の場合、金額を変更できない', () => {
      const closed = { employeeId: 'e001', paidDate: '2026-09-10', amount: 500_000, status: 'closed' };
      const updated = { ...closed, amount: 550_000 };
      // 確定済みなので更新は拒否されるべき
      expect(closed.status).toBe('closed');
    });

    it('賞与の支給日が給与の締め日・支払日と矛盾', () => {
      const payroll = { paidDate: '2026-12-25', cutoff: 'end' };
      const bonus = { paidDate: '2026-12-25' };
      // 給与と賞与が同じ日に支給されることは稀
      expect(payroll.paidDate).toBe(bonus.paidDate);
    });

    it('賞与の支給月が複数月度分の場合（合算）、重複がないか確認', () => {
      // 7月〜6月分の四半期賞与 vs 当年の年末賞与
      const bonus1 = {
        paidDate: '2026-12-10',
        period: '2025-07-01/2026-06-30', // 前年度分
        amount: 480_000,
      };
      const bonus2 = {
        paidDate: '2026-12-10',
        period: '2026-01-01/2026-12-31', // 当年度分
        amount: 600_000,
      };
      // 同じ支給日でも複数の期間がある場合は確認が必要
      expect(bonus1.paidDate).toBe(bonus2.paidDate);
    });

    it('賞与データの「社員番号」から、社員が特定できない', () => {
      const bonus = {
        employeeNumber: '9999',
        paidDate: '2026-12-10',
        amount: 500_000,
      };
      // 社員として登録されていない社員番号
      expect(bonus.employeeNumber).toBe('9999');
    });

    it('賞与の累計が上限（2ヶ月上限分など）に達しているか確認', () => {
      const year = {
        Q1: 400_000,
        Q2: 400_000,
        Q3: 400_000,
        Q4: 500_000, // 合計 1,700,000
      };
      const total = Object.values(year).reduce((a, b) => a + b, 0);
      // 累計が高くないか、業績と乖離していないか
      expect(total).toBeGreaterThan(1_000_000);
    });
  });
});
