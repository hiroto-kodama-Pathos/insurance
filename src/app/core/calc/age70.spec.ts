import { age70Notice, Age70Employee } from './age70';
import { buildKyokaiGrades } from './grade-suggest';
import { SalaryRecord } from './salary';

const grades = buildKyokaiGrades('2020-09');
// 1956-11-20 生まれ：70歳到達日は 2026-11-19
const person = (over: Partial<Age70Employee> = {}): Age70Employee => ({
  id: 'e1',
  birthDate: '1956-11-20',
  qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
  assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2020-04', healthStandard: 300_000, pensionStandard: 300_000, remuneration: 300_000 }],
  ...over,
});
const pay = (ym: string, fixed: number, nonFixed = 0): SalaryRecord => ({
  id: ym, employeeId: 'e1', paidDate: `${ym}-25`, fixedWages: fixed, nonFixedWages: nonFixed, paymentBaseDays: 30, retroactiveDiff: null, inKindWages: null,
});

describe('70歳到達届の要否', () => {
  it('直近の給与から求めた相当額が前日の標準報酬月額と同じなら不要', () => {
    const n = age70Notice(person(), [pay('2026-09', 300_000), pay('2026-10', 290_000, 10_000)], grades)!;
    expect(n.reachedDate).toBe('2026-11-19');
    expect(n.deadline).toBe('2026-11-24');
    expect(n.status).toBe('notRequired');
    expect(n.basis).toBe('2026年10月の給与');
    expect(n.message).toContain('70歳到達届：不要（相当額が同額');
  });

  it('報酬が下がって相当額が違う等級なら、期限つきで要', () => {
    const n = age70Notice(person(), [pay('2026-10', 240_000)], grades)!;
    expect(n.status).toBe('required');
    expect(n.equivalent).toBe(240_000);
    expect(n.message).toContain('70歳到達届：要（2026年11月24日まで）');
    expect(n.message).toContain('30万円 → 24万円');
  });

  it('給与がなければ、登録した報酬月額で判定する。どちらもなければ要確認', () => {
    expect(age70Notice(person(), [], grades)!.status).toBe('notRequired');
    const none = person({ standardHistory: [{ validFrom: '2020-04', healthStandard: 300_000, pensionStandard: 300_000 }] });
    expect(age70Notice(none, [], grades)!.status).toBe('unknown');
    // 到達日より後・3か月より前の給与は使わない
    expect(age70Notice(none, [pay('2026-12', 300_000), pay('2026-07', 300_000)], grades)!.status).toBe('unknown');
  });

  it('70歳到達日の前後で適用事業所が変わる人・到達日に資格を取った人は要', () => {
    const moved = person({ assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }, { validFrom: '2026-11-19', officeId: 'osaka' }] });
    expect(age70Notice(moved, [pay('2026-10', 300_000)], grades)!.message).toContain('適用事業所が変わります');
    const hired = person({ qualifications: [{ acquiredDate: '2026-11-19', lostDate: null }] });
    expect(age70Notice(hired, [], grades)!.status).toBe('required');
  });

  it('70歳到達日に資格がない人は出さない', () => {
    expect(age70Notice(person({ qualifications: [{ acquiredDate: '2020-04-01', lostDate: '2026-10-01' }] }), [], grades)).toBeNull();
  });
});
