import { addDays, FilingEmployee, filingState, findFilings, urgentFilings } from './filing';
import { buildKyokaiGrades } from './grade-suggest';

const grades = buildKyokaiGrades('2020-09');
const TODAY = '2026-10-29';
const person = (over: Partial<FilingEmployee> = {}): FilingEmployee => ({
  id: 'e1',
  birthDate: '1990-01-01',
  qualifications: [{ acquiredDate: '2026-10-01', lostDate: null }],
  assignments: [{ validFrom: '2026-10-01', officeId: 'honsha' }],
  standardHistory: [{ validFrom: '2026-10', healthStandard: 300_000, pensionStandard: 300_000 }],
  leaves: [],
  exemptions: [],
  dependents: [],
  ...over,
});
const find = (es: FilingEmployee[], extra: Partial<{ bonuses: { employeeId: string; paidDate: string }[]; candidates: Parameters<typeof findFilings>[4] }> = {}, today = TODAY) =>
  findFilings(es, extra.bonuses ?? [], [], grades, extra.candidates ?? [], [{ id: 'honsha' }], today);

describe('届出の一覧', () => {
  it('日をずらす', () => {
    expect(addDays('2026-10-29', 5)).toBe('2026-11-03');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('資格取得届・資格喪失届・被扶養者異動届は、その日から5日以内', () => {
    const list = find([
      person({
        qualifications: [{ acquiredDate: '2026-10-01', lostDate: '2026-11-01' }],
        dependents: [{ name: '山田 花子', birthDate: '1992-01-01', certifiedDate: '2026-10-01', removedDate: null }],
      }),
    ]);
    expect(list.map((f) => [f.kind, f.deadline])).toEqual([
      ['acquisition', '2026-10-06'],
      ['dependent', '2026-10-06'],
      ['loss', '2026-11-06'],
    ]);
    expect(list[0].id).toBe('e1_acquisition_2026-10-01');
    expect(list[1].name).toContain('山田 花子・扶養に入った');
  });

  it('被扶養者が75歳の誕生日を迎えたら、外れた日を登録していなくても被扶養者異動届（誕生日から5日以内）を出す。31日より先は出さない', () => {
    const mother = { name: '山田 キヨ', birthDate: '1951-11-15', certifiedDate: '2020-04-01', removedDate: null };
    const deps = find([person({ dependents: [mother] })]).filter((f) => f.kind === 'dependent' && f.name.includes('外れた'));
    expect(deps.map((f) => [f.name, f.triggerLabel, f.deadline])).toEqual([
      ['被扶養者異動届（山田 キヨ・75歳到達で扶養から外れた）', '75歳の誕生日 2026年11月15日', '2026-11-20'],
    ]);
    // 外れた日に75歳の誕生日を登録しても、届出は1件（同じID）
    const same = find([person({ dependents: [{ ...mother, removedDate: '2026-11-15' }] })]).filter((f) => f.kind === 'dependent' && f.name.includes('外れた'));
    expect(same.map((f) => f.id)).toEqual([deps[0].id]);
    // 誕生日がまだ先（31日より後）なら出さない
    expect(find([person({ dependents: [{ ...mother, birthDate: '1952-03-01' }] })]).filter((f) => f.kind === 'dependent' && f.name.includes('外れた'))).toEqual([]);
  });

  it('180日より前のきっかけは出さない', () => {
    expect(find([person({ qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }] })])).toEqual([]);
  });

  it('賞与支払届（同じ日の賞与は1件。資格のない日の支給は除く）', () => {
    const list = find([person()], { bonuses: [{ employeeId: 'e1', paidDate: '2026-12-10' }, { employeeId: 'e1', paidDate: '2026-12-10' }, { employeeId: 'e1', paidDate: '2026-09-10' }] });
    expect(list.filter((f) => f.kind === 'bonus').map((f) => f.deadline)).toEqual(['2026-12-15']);
  });

  it('休業は申出書、適用除外は種類ごとの届出', () => {
    const list = find([
      person({
        leaves: [{ type: 'childcare', startDate: '2026-10-10', endDate: null }],
        exemptions: [{ type: 'healthNhiUnion', startDate: '2026-10-05', endDate: null }],
      }),
    ]);
    expect(list.find((f) => f.kind === 'leave')!.name).toBe('育児休業等取得者申出書');
    const ex = list.find((f) => f.kind === 'exemption')!;
    expect(ex.name).toBe('健康保険被保険者適用除外承認申請書');
    expect(ex.deadline).toBe('2026-10-19');
  });

  it('70歳到達届は、不要と判定した人を除いて、到達日が来月までの人を出す', () => {
    const e = person({ birthDate: '1956-11-20', qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }], assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }], standardHistory: [{ validFrom: '2020-04', healthStandard: 300_000, pensionStandard: 300_000 }] });
    const f = find([e]).find((x) => x.kind === 'age70')!;
    expect(f.name).toContain('要否を確かめる');
    expect(f.deadline).toBe('2026-11-24');
  });

  it('月額変更届は候補の状態で届出済みを決める（休業終了時改定は届出済みにした候補だけ）', () => {
    const list = find([person()], {
      candidates: [
        { id: 'c1', employeeId: 'e1', type: 'revision', changeMonth: '2026-08', expectedFrom: '2026-11', status: 'open' },
        { id: 'c2', employeeId: 'e1', type: 'leaveEnd', changeMonth: '2026-07', expectedFrom: '2026-10', status: 'open' },
        { id: 'c3', employeeId: 'e1', type: 'revision', changeMonth: '2026-07', expectedFrom: '2026-10', status: 'filed' },
      ],
    });
    const revs = list.filter((f) => f.kind === 'revision');
    expect(revs.map((f) => f.deadlineLabel)).toEqual(['速やかに', '速やかに']);
    expect(revs.map((f) => filingState(f, new Set(), TODAY)).sort()).toEqual(['filed', 'open']);
  });

  it('休業終了時改定の月額変更届は、終わった休業で届書の名前を変える（産休：産前産後休業終了時、育休：育児休業等終了時）', () => {
    const list = find([person()], {
      candidates: [
        { id: 'c1', employeeId: 'e1', type: 'leaveEnd', leaveType: 'maternity', changeMonth: '2026-07', expectedFrom: '2026-10', status: 'filed' },
        { id: 'c2', employeeId: 'e1', type: 'leaveEnd', leaveType: 'childcare', changeMonth: '2026-08', expectedFrom: '2026-11', status: 'filed' },
      ],
    });
    expect(list.filter((f) => f.kind === 'revision').map((f) => f.name)).toEqual(['産前産後休業終了時報酬月額変更届', '育児休業等終了時報酬月額変更届']);
  });

  it('算定基礎届は、7月1日に資格がある人がいる事業所ごとに出す', () => {
    const e = person({ qualifications: [{ acquiredDate: '2026-04-01', lostDate: null }], assignments: [{ validFrom: '2026-04-01', officeId: 'honsha' }] });
    const f = find([e], {}, '2026-06-15').find((x) => x.kind === 'regular')!;
    expect(f.id).toBe('honsha_regular_2026-07-01');
    expect(f.deadline).toBe('2026-07-10');
  });

  it('状態：届出済み・期限切れ・3日以内・未対応。トップの件数は7日以内と期限なし', () => {
    const list = find([
      person({ qualifications: [{ acquiredDate: '2026-10-01', lostDate: null }, { acquiredDate: '2026-10-25', lostDate: null }] }),
    ]);
    const [a, b] = list;
    expect(filingState(a, new Set([a.id]), TODAY)).toBe('filed');
    expect(filingState(a, new Set(), TODAY)).toBe('overdue');
    expect(filingState(b, new Set(), TODAY)).toBe('soon');
    expect(filingState(b, new Set(), '2026-10-20')).toBe('open');
    expect(urgentFilings(list, new Set([a.id]), TODAY).map((f) => f.id)).toEqual([b.id]);
  });
});
