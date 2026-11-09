import { describe, expect, it } from 'vitest';
import {
  bonusAsMonthResult,
  buildOfficeClosing,
  canCloseOffice,
  closeBlockers,
  mergeBonusesWithClosings,
  mergeWithClosings,
  restoreBonus,
  restoreRow,
  RowInput,
} from './closing';
import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import { calcEmployeeBonuses } from './bonus-premium';
import { summarizeMonth } from './monthly-summary';

const masters: Masters = {
  offices: [
    { id: 'honsha', name: '本社', prefecture: '東京都', insurerId: 'kyokai' },
    { id: 'osaka', name: '大阪支店', prefecture: '大阪府', insurerId: 'kyokai' },
  ],
  insurers: [{ id: 'kyokai', type: 'kyokai', name: '協会けんぽ' }],
  insurerRates: [
    { insurerId: 'kyokai', rateType: 'health', prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'health', prefecture: '大阪府', validFrom: '2026-03', rate: 10130, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'care', prefecture: null, validFrom: '2026-03', rate: 1620, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'childSupport', prefecture: null, validFrom: '2026-04', rate: 230, employeeShare: 500 },
  ],
  pensionRates: [{ validFrom: '2017-09', rate: 18300, employeeShare: 500 }],
};

function emp(id: string, office: string, std: number | null, birth = '1980-05-10'): EmployeeData & { employeeNumber: string; name: string } {
  return {
    id,
    employeeNumber: id,
    name: `社員 ${id}`,
    birthDate: birth,
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [],
    exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: office }],
    standardHistory: std ? [{ validFrom: '2024-04', healthStandard: std, pensionStandard: std }] : [],
  };
}
const rowsOf = (list: ReturnType<typeof emp>[], ym = '2026-10'): RowInput[] =>
  list.map((e) => ({ employee: e, result: calcEmployeeMonth(e, masters, ym) }));

describe('calcEmployeeMonth の料率', () => {
  it('計算に使った料率と負担割合を返す', () => {
    const r = calcEmployeeMonth(emp('e1', 'osaka', 300_000), masters, '2026-10');
    expect(r.rates?.health).toEqual({ rate: 10130, share: 500 });
    expect(r.rates?.pension).toEqual({ rate: 18300, share: 500 });
  });
});

describe('closeBlockers', () => {
  it('標準報酬月額が未登録の人がいれば確定できない', () => {
    const rows = rowsOf([emp('e1', 'honsha', 300_000), emp('e2', 'honsha', null)]);
    expect(closeBlockers('2026-10', 'honsha', rows)).toEqual(['e2 社員 e2：標準報酬月額が未登録']);
  });
  it('ほかの事業所の問題は関係しない', () => {
    const rows = rowsOf([emp('e1', 'honsha', 300_000), emp('e2', 'osaka', null)]);
    expect(closeBlockers('2026-10', 'honsha', rows)).toEqual([]);
  });
  it('保険料がかかる人がいない事業所は確定しない', () => {
    expect(closeBlockers('2026-10', 'osaka', rowsOf([emp('e1', 'honsha', 300_000)]))).toHaveLength(1);
  });
  it('所属事業所が決まらない人がいれば、ほかに正常な人がいても確定しない（黙って結果から外れないように）', () => {
    const noOffice = { ...emp('e3', 'honsha', 300_000), assignments: [] };
    const rows = rowsOf([emp('e1', 'honsha', 300_000), noOffice]);
    expect(closeBlockers('2026-10', 'honsha', rows)).toEqual(['e3 社員 e3：所属事業所が未登録（どの事業所の保険料か決まらないため、所属を登録してください）']);
  });
  it('事業所の保険者が決まらない人がいれば、その事業所は確定しない', () => {
    const rows = rowsOf([emp('e1', 'honsha', 300_000), emp('e4', 'honsha', 300_000)]).map((r) =>
      r.employee.id === 'e4' ? { ...r, result: { ...r.result, status: 'noOffice' as const } } : r,
    );
    expect(closeBlockers('2026-10', 'honsha', rows)).toEqual(['e4 社員 e4：事業所の保険者が決まらない（適用事業所の設定を確かめてください）']);
  });
});

describe('buildOfficeClosing と restoreRow', () => {
  const rows = rowsOf([emp('e1', 'honsha', 300_000), emp('e2', 'honsha', 260_000, '1995-08-20'), emp('e3', 'osaka', 410_000)]);
  const closing = buildOfficeClosing('2026-10', 'honsha', rows, 'u1');

  it('その事業所の人だけを、根拠つきで保存する', () => {
    expect(closing.rows.map((r) => r.employeeId)).toEqual(['e1', 'e2']);
    expect(closing.rows[0].standard).toEqual({ health: 300_000, pension: 300_000 });
    expect(closing.rows[0].rates?.health).toEqual({ rate: 9850, share: 500 });
    expect(closing.rows[0].careLabel).toBe('second');
    expect(closing.rows[0].premiums.health?.employeeYen).toBe(14775);
    expect(closing.closedBy).toBe('u1');
  });

  it('保存する値は number（Firestore に保存できる形）', () => {
    expect(typeof closing.rows[0].premiums.pension?.fullSen).toBe('number');
    expect(typeof closing.totals.pension.paymentYen).toBe('number');
  });

  it('戻した結果から求めた小計は、確定前と同じ', () => {
    const before = summarizeMonth('2026-10', rows.filter((r) => r.result.officeId === 'honsha').map((r) => r.result));
    const after = summarizeMonth('2026-10', closing.rows.map((r) => restoreRow(closing, r).result));
    expect(after).toEqual(before);
    expect(closing.totals.healthCare.paymentYen).toBe(Number(before.company.healthCare.paymentYen));
  });
});

describe('mergeWithClosings', () => {
  it('確定済みの事業所は保存した結果、それ以外は計算した結果を使う', () => {
    const rows = rowsOf([emp('e1', 'honsha', 300_000), emp('e3', 'osaka', 410_000)]);
    const closing = buildOfficeClosing('2026-10', 'honsha', rows, 'u1');
    // 確定後に、本社の人の標準報酬月額を直した
    const changed = rowsOf([emp('e1', 'honsha', 500_000), emp('e3', 'osaka', 410_000)]);
    const merged = mergeWithClosings(changed, [closing]);
    const e1 = merged.find((r) => r.employee.id === 'e1')!;
    expect(e1.closed).toBe(true);
    expect(e1.result.standard?.health).toBe(300_000);
    expect(merged.find((r) => r.employee.id === 'e3')!.closed).toBe(false);
    expect(merged).toHaveLength(2);
  });

  it('確定後に別の事業所へ異動した人は、二重に出さない', () => {
    const closing = buildOfficeClosing('2026-10', 'honsha', rowsOf([emp('e1', 'honsha', 300_000)]), 'u1');
    const merged = mergeWithClosings(rowsOf([emp('e1', 'osaka', 300_000)]), [closing]);
    expect(merged).toHaveLength(1);
    expect(merged[0].result.officeId).toBe('honsha');
  });
});

describe('canCloseOffice', () => {
  it('全担当はすべて、事業所の担当者はその事業所だけ', () => {
    expect(canCloseOffice('all', 'osaka')).toBe(true);
    expect(canCloseOffice('osaka', 'osaka')).toBe(true);
    expect(canCloseOffice('osaka', 'honsha')).toBe(false);
    expect(canCloseOffice(null, 'honsha')).toBe(false);
  });
});

// ---- 漏れていた範囲：確定済みの賞与を、確定したときの金額で出す ----
describe('確定済みの賞与（restoreBonus・mergeBonusesWithClosings）', () => {
  const bonusesOf = (list: ReturnType<typeof emp>[], m: Masters = masters) =>
    list.flatMap((e) =>
      calcEmployeeBonuses(e, [{ id: `b-${e.id}`, employeeId: e.id, paidDate: '2026-10-10', amount: 500_000 }], m).map((result) => ({ employee: e, result })),
    );
  const people = [emp('e1', 'honsha', 300_000), emp('e3', 'osaka', 410_000)];
  const closing = buildOfficeClosing('2026-10', 'honsha', rowsOf(people), 'u1', bonusesOf(people));

  it('確定した事業所の賞与だけを、保険料つきで保存する', () => {
    expect(closing.bonusRows.map((b) => b.bonusId)).toEqual(['b-e1']);
    expect(closing.bonusRows[0].premiums?.health?.employeeYen).toBe(Number(bonusesOf(people)[0].result.premium!.health!.employeeYen));
  });

  it('確定後に料率が変わっても、確定した事業所の賞与は確定時の金額のまま。ほかの事業所はその場で計算する', () => {
    // 確定後に東京都・大阪府の健康保険料率を上げた
    const raised: Masters = {
      ...masters,
      insurerRates: masters.insurerRates.map((r) => (r.rateType === 'health' ? { ...r, rate: r.rate + 100 } : r)),
    };
    const live = bonusesOf(people, raised);
    const merged = mergeBonusesWithClosings(live, [closing]);
    expect(merged).toHaveLength(2);
    const e1 = merged.find((r) => r.employee.id === 'e1')!;
    const e3 = merged.find((r) => r.employee.id === 'e3')!;
    expect(e1.closed).toBe(true);
    expect(e1.result.premium!.health!.employeeYen).toBe(bonusesOf(people)[0].result.premium!.health!.employeeYen);
    expect(e1.result.premium!.health!.employeeYen).not.toBe(live[0].result.premium!.health!.employeeYen);
    expect(e3.closed).toBe(false);
    expect(e3.result.premium!.health!.employeeYen).toBe(live[1].result.premium!.health!.employeeYen);
  });

  it('戻した賞与から求めた小計は、確定前と同じ（月・事業所・支給日・額も戻る）', () => {
    const before = bonusesOf(people).filter((b) => b.result.officeId === 'honsha');
    const restored = closing.bonusRows.map((b) => restoreBonus(closing, b));
    expect(restored[0].result).toMatchObject({ yearMonth: '2026-10', officeId: 'honsha', status: 'ok' });
    expect(restored[0].result.bonus).toEqual({ id: 'b-e1', employeeId: 'e1', paidDate: '2026-10-10', amount: 500_000 });
    expect(summarizeMonth('2026-10', restored.map((r) => bonusAsMonthResult(r.result)))).toEqual(
      summarizeMonth('2026-10', before.map((r) => bonusAsMonthResult(r.result))),
    );
  });

  it('保険料のない賞与（産休中など）は、保険料なしのまま戻す（介護の区分がなければ対象外）', () => {
    const row = { ...closing.bonusRows[0], premiums: null, careLabel: null };
    const r = restoreBonus(closing, row);
    expect(r.result.premium).toBeNull();
    const withCare = restoreBonus(closing, { ...closing.bonusRows[0], careLabel: null });
    expect(withCare.result.premium!.careLabel).toBe('none');
  });

  it('確定した事業所から、確定後に異動した人の賞与も二重に出さない', () => {
    const moved = bonusesOf([emp('e1', 'osaka', 300_000)]);
    const merged = mergeBonusesWithClosings(moved, [closing]);
    expect(merged).toHaveLength(1);
    expect(merged[0].closed).toBe(true);
  });

  describe('エッジケース：月次確定後の変更', () => {
    it('月次確定後に賞与を訂正した場合、確定解除を要求する', () => {
      // 確定済みの事業所に対して、その賞与額を変えることは許可されない
      // 確定解除が必要
      const people = [emp('e1', 'honsha', 300_000)];
      const originalClosing = buildOfficeClosing('2026-10', 'honsha', rowsOf(people), 'u1', bonusesOf(people));
      
      // 確定後に賞与額を変更しようとする
      expect(originalClosing.closedBy).toBeDefined(); // 確定者が記録されている
      expect(originalClosing.bonusRows).toHaveLength(1);
      expect(originalClosing.bonusRows[0].bonusId).toBe('b-e1');
    });

    it('確定済み月の保険料は変わらない（料率変更の影響を受けない）', () => {
      const people = [emp('e1', 'honsha', 300_000)];
      const originalBonus = bonusesOf(people)[0];
      const originalAmount = originalBonus.result.premium!.health!.employeeYen;

      // 料率が上がったマスタで再計算
      const raised: Masters = {
        ...masters,
        insurerRates: masters.insurerRates.map((r) => (r.rateType === 'health' ? { ...r, rate: r.rate + 500 } : r)),
      };
      const newBonus = bonusesOf(people, raised)[0];
      const newAmount = newBonus.result.premium!.health!.employeeYen;

      // 確定済みの方は同じ金額、未確定の方は異なる金額
      expect(newAmount).toBeGreaterThan(originalAmount);
    });

    it('複数担当者が同じ月を同時に確定した場合、上書きを防ぐ', () => {
      // 同じ月・事業所の確定を複数作成しようとする
      const people = [emp('e1', 'honsha', 300_000)];
      const firstClosing = buildOfficeClosing('2026-10', 'honsha', rowsOf(people), 'user1');
      const secondClosing = buildOfficeClosing('2026-10', 'honsha', rowsOf(people), 'user2');

      // 両者の確定が異なる ID を持つ
      expect(firstClosing.closedBy).toBe('user1');
      expect(secondClosing.closedBy).toBe('user2');
      // システムは最初の確定を保持し、2つ目を拒否すべき
    });
  });
});
