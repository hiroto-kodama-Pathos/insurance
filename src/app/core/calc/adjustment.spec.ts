import { buildOfficeClosing, OfficeClosing } from './closing';
import { calcEmployeeMonth, EmployeeData, Masters } from './employee-month';
import { findAdjustments, settledAmountFor, trackAdjustments } from './adjustment';

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

function yamada(over: Partial<EmployeeData> = {}): EmployeeData & { employeeNumber: string; name: string } {
  return {
    id: 'e1', employeeNumber: '0001', name: '山田 太郎', birthDate: '1995-05-10',
    qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    leaves: [], exemptions: [],
    assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }],
    standardHistory: [{ validFrom: '2024-04', healthStandard: 280_000, pensionStandard: 280_000 }],
    ...over,
  };
}

/** 今のデータで7月分を確定したときの結果 */
function close(e: ReturnType<typeof yamada>, officeId = 'honsha', ym = '2026-07'): OfficeClosing {
  const rows = [{ employee: e, result: calcEmployeeMonth(e, masters, ym) }];
  return { ...buildOfficeClosing(ym, officeId, rows, 'u1'), closedAt: '2026-08-01T00:00:00Z' };
}

describe('findAdjustments（さかのぼる改定の差額）', () => {
  it('確定後に、確定済みの月にさかのぼって標準報酬月額が変わったら、保険ごとの差額を出す（設計書 2.20 の例）', () => {
    const closing = close(yamada());
    const after = yamada();
    after.standardHistory.push({ validFrom: '2026-07', healthStandard: 340_000, pensionStandard: 340_000 });
    const [a] = findAdjustments([after], masters, [closing]);
    expect(a.cause).toBe('standard');
    expect(a.beforeStandard).toEqual({ health: 280_000, pension: 280_000 });
    expect(a.afterStandard).toEqual({ health: 340_000, pension: 340_000 });
    // 健康保険 60,000 × 9.85% ÷ 2 = 2,955円、厚生年金 60,000 × 18.3% ÷ 2 = 5,490円
    expect(a.diffs.health.employeeYen).toBe(2_955);
    expect(a.diffs.pension.employeeYen).toBe(5_490);
    expect(a.employeeTotal).toBe(2_955 + 69 + 5_490);
  });

  it('何も変わらなければ差額は出ない。確定後に料率のマスタを直しても、確定時の料率で計算するので差額は出ない', () => {
    const closing = close(yamada());
    expect(findAdjustments([yamada()], masters, [closing])).toEqual([]);
    const fixed = { ...masters, insurerRates: masters.insurerRates.map((r) => (r.rateType === 'health' && r.prefecture === '東京都' ? { ...r, rate: 9900 } : r)) };
    expect(findAdjustments([yamada()], fixed, [closing])).toEqual([]);
  });

  it('確定後に異動を登録したら、元の事業所にマイナス、確定済みの異動先にプラスの差額を出す', () => {
    const closing = close(yamada());
    const osakaClosing = { ...buildOfficeClosing('2026-07', 'osaka', [], 'u1'), closedAt: '2026-08-01T00:00:00Z' };
    const moved = yamada({ assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-07-15', officeId: 'osaka' }] });
    const list = findAdjustments([moved], masters, [closing, osakaClosing]);
    expect(list.map((a) => [a.officeId, a.cause])).toEqual([['honsha', 'transfer'], ['osaka', 'transfer']]);
    expect(list[0].diffs.health.employeeYen).toBe(-closing.rows[0].premiums.health!.employeeYen);
    // 本人からは2件の合計（大阪と東京の料率の違いの分）を追加で控除する
    expect(list[0].employeeTotal + list[1].employeeTotal).toBeGreaterThan(0);
  });

  it('異動先が未確定なら、異動先には差額を出さない（異動先を確定するときに一緒に保存される）', () => {
    const closing = close(yamada());
    const moved = yamada({ assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-07-15', officeId: 'osaka' }] });
    expect(findAdjustments([moved], masters, [closing]).map((a) => a.officeId)).toEqual(['honsha']);
  });

  it('確定後に休業を登録したら「休業」の差額、確定に含まれない人の資格を後から登録したら「追加」の差額', () => {
    const closing = close(yamada());
    const leave = yamada({ leaves: [{ type: 'childcare', startDate: '2026-07-01', endDate: null, workedDays: null }] });
    const [a] = findAdjustments([leave], masters, [closing]);
    expect(a.cause).toBe('leave');
    expect(a.employeeTotal).toBeLessThan(0);
    const late = { ...yamada(), id: 'e2', employeeNumber: '0002', name: '遅れ さん' };
    const added = findAdjustments([yamada(), late], masters, [closing]);
    expect(added.map((x) => [x.employeeId, x.cause])).toEqual([['e2', 'added']]);
  });
});

describe('trackAdjustments・settledAmountFor（精算の記録）', () => {
  const closing = close(yamada());
  const after = yamada();
  after.standardHistory.push({ validFrom: '2026-07', healthStandard: 340_000, pensionStandard: 340_000 });
  const [a] = findAdjustments([after], masters, [closing]);

  it('精算月を記録すると精算済み。精算後にまた変わったら、残りの差額を未精算に戻す', () => {
    expect(trackAdjustments([a], [])[0].settledMonth).toBeNull();
    const done = trackAdjustments([a], [{ id: a.id, entries: [{ settledMonth: '2026-09', diffs: a.diffs }] }])[0];
    expect(done.settledMonth).toBe('2026-09');
    expect(done.remainingEmployeeTotal).toBe(0);

    const again = yamada();
    again.standardHistory.push({ validFrom: '2026-07', healthStandard: 360_000, pensionStandard: 360_000 });
    const [b] = findAdjustments([again], masters, [closing]);
    const re = trackAdjustments([b], [{ id: a.id, entries: [{ settledMonth: '2026-09', diffs: a.diffs }] }])[0];
    expect(re.settledMonth).toBeNull();
    expect(re.remainingEmployeeTotal).toBe(b.employeeTotal - a.employeeTotal);
  });

  it('精算した給与の月の差額を合計する（控除不足の判定に含める）', () => {
    const rec = [{ id: a.id, entries: [{ settledMonth: '2026-09', diffs: a.diffs }] }];
    expect(settledAmountFor('e1', '2026-09', rec)).toBe(a.employeeTotal);
    expect(settledAmountFor('e1', '2026-10', rec)).toBe(0);
  });
});
