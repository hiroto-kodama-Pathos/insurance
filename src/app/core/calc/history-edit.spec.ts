import {
  checkAssignmentDelete,
  checkAssignmentEdit,
  checkBirthDateChange,
  checkDatedEdit,
  checkLeaveOverlap,
  checkQualificationDelete,
  checkQualificationEdit,
  checkStandardDelete,
  dependentMoves,
  dependentsLeftOutside,
  officeIdsOf,
  prevDay,
  toQualificationEdit,
} from './history-edit';

describe('登録した履歴の訂正・削除のチェック', () => {
  it('生年月日：正しい日付で、今日より後・今と同じ・資格取得日以降は入れない', () => {
    expect(checkBirthDateChange('1980-05-10', '1980-02-30', '2026-11-05', '2024-04-01')['birthDate']).toContain('正しく');
    expect(checkBirthDateChange('1980-05-10', '2026-11-06', '2026-11-05', null)['birthDate']).toContain('今日より後');
    expect(checkBirthDateChange('1980-05-10', '1980-05-10', '2026-11-05', null)['birthDate']).toContain('同じ');
    expect(checkBirthDateChange('1980-05-10', '2024-04-01', '2026-11-05', '2024-04-01')['birthDate']).toContain('資格取得日');
    expect(checkBirthDateChange('1980-05-10', '1980-06-10', '2026-11-05', '2024-04-01')).toEqual({});
  });

  it('資格：登録した退職は、資格喪失日の前日（退職日）で入力欄に出す。加入中は空', () => {
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(toQualificationEdit({ acquiredDate: '2024-04-01', lostDate: '2026-04-01', lostReason: 'retirement' })).toEqual({
      acquiredDate: '2024-04-01', lostReason: 'retirement', endDate: '2026-03-31',
    });
    expect(toQualificationEdit({ acquiredDate: '2024-04-01', lostDate: '2026-04-10', lostReason: 'death' }).endDate).toBe('2026-04-10');
    expect(toQualificationEdit({ acquiredDate: '2024-04-01', lostDate: null })).toEqual({ acquiredDate: '2024-04-01', lostReason: '', endDate: '' });
  });

  it('資格：退職日の翌日を喪失日にし、取得日より前の喪失・ほかの期間との重なりは入れない', () => {
    const all = [
      { id: 'q0', acquiredDate: '2020-04-01', lostDate: '2022-04-01' },
      { id: 'q1', acquiredDate: '2024-04-01', lostDate: null },
    ];
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2024-04-01', lostReason: 'retirement', endDate: '2026-03-31' })).toEqual({ errors: {}, lostDate: '2026-04-01' });
    // 取得日と同じ日の退職は、喪失日が翌日なのでよい（その他の理由は、取得日より後でないといけない）
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2024-04-01', lostReason: 'retirement', endDate: '2024-04-01' }).errors).toEqual({});
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2024-04-01', lostReason: 'other', endDate: '2024-04-01' }).errors['endDate']).toContain('より後');
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2024-04-01', lostReason: 'retirement', endDate: '' }).errors['endDate']).toContain('退職日');
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2022-03-01', lostReason: '', endDate: '' }).errors['acquiredDate']).toContain('重なって');
    // 前の期間の喪失日に取得し直すのは重ならない
    expect(checkQualificationEdit(all, 'q1', { acquiredDate: '2022-04-01', lostReason: '', endDate: '' }).errors).toEqual({});
    // 前の期間の退職を取り消すと、今の加入中の期間と重なる
    expect(checkQualificationEdit(all, 'q0', { acquiredDate: '2020-04-01', lostReason: '', endDate: '' }).errors['acquiredDate']).toContain('重なって');
  });

  it('資格・標準報酬月額の削除：計算できなくなる削除は止める', () => {
    expect(checkQualificationDelete([{ acquiredDate: '2024-04-01', lostDate: null }])).toContain('1つだけ');
    expect(checkQualificationDelete([{ acquiredDate: '2020-04-01', lostDate: '2022-04-01' }, { acquiredDate: '2024-04-01', lostDate: null }])).toBeNull();
    expect(checkStandardDelete(1, true)).toContain('1件は残して');
    expect(checkStandardDelete(1, false)).toBeNull();
    expect(checkStandardDelete(2, true)).toBeNull();
  });

  it('所属：同じ日・前後が同じ事業所になる直し方と削除は止める。officeIds は残った所属から求める', () => {
    const all = [
      { id: 'a1', validFrom: '2020-04-01', officeId: 'honsha' },
      { id: 'a2', validFrom: '2024-04-01', officeId: 'osaka' },
      { id: 'a3', validFrom: '2025-04-01', officeId: 'honsha' },
    ];
    expect(checkAssignmentEdit(all, 'a2', { validFrom: '2024-05-01', officeId: 'osaka' })).toEqual({});
    expect(checkAssignmentEdit(all, 'a2', { validFrom: '2025-04-01', officeId: 'osaka' })['assignmentDate']).toContain('すでに');
    expect(checkAssignmentEdit(all, 'a2', { validFrom: '2024-04-01', officeId: 'honsha' })['assignmentOffice']).toContain('前後の所属と同じ');
    expect(checkAssignmentDelete(all, 'a2')).toContain('同じ事業所で続きます');
    expect(checkAssignmentDelete(all, 'a3')).toBeNull();
    expect(checkAssignmentDelete([all[0]], 'a1')).toContain('1件だけ');
    expect(officeIdsOf(all.filter((a) => a.id !== 'a2'))).toEqual(['honsha']);
  });

  it('区分の履歴：変わった日が正しく、ほかの行と同じ日でない', () => {
    expect(checkDatedEdit([{ validFrom: '2025-04-01' }], '2025-04-01', 'payrollDate', '支払区分')['payrollDate']).toBe('この日からの支払区分はすでに登録されています');
    expect(checkDatedEdit([], '2025-13-01', 'payrollDate', '支払区分')['payrollDate']).toContain('正しく');
    expect(checkDatedEdit([{ validFrom: '2025-04-01' }], '2025-05-01', 'payrollDate', '支払区分')).toEqual({});
  });

  it('休業：ほかの休業と期間が重ならない（終了日のない休業は、終わりがないものとして比べる）', () => {
    const others = [{ type: 'maternity' as const, startDate: '2026-01-01', endDate: '2026-03-31' }];
    expect(checkLeaveOverlap(others, '2026-04-01', '')).toEqual({});
    expect(checkLeaveOverlap(others, '2026-03-31', '2026-09-30')['startDate']).toContain('重なっています');
    expect(checkLeaveOverlap([{ type: 'childcare', startDate: '2026-04-01', endDate: null }], '2027-01-01', '2027-02-01')['startDate']).toContain('休業中');
  });

  it('資格を直したら、同じ日に扶養から外れた被扶養者の外れた日も合わせる（取り消しなら扶養に戻す）', () => {
    const deps = [
      { id: 'd1', removedDate: '2026-04-01' },
      { id: 'd2', removedDate: '2025-01-01' },
      { id: 'd3', removedDate: null },
    ];
    expect(dependentMoves(deps, '2026-04-01', null)).toEqual([{ id: 'd1', removedDate: null }]);
    expect(dependentMoves(deps, '2026-04-01', '2026-05-01')).toEqual([{ id: 'd1', removedDate: '2026-05-01' }]);
    expect(dependentMoves(deps, '2026-04-01', '2026-04-01')).toEqual([]);
    expect(dependentMoves(deps, null, '2026-04-01')).toEqual([]);
  });
});

describe('資格の期間の訂正：生年月日・75歳・被扶養者との整合（設計書 3.1）', () => {
  const quals = [{ id: 'q1', acquiredDate: '2024-04-01', lostDate: null, lostReason: null }];
  const edit = (acquiredDate: string) => checkQualificationEdit(quals, 'q1', { acquiredDate, lostReason: '', endDate: '' }, '1980-05-10');

  it('資格取得日は生年月日より後で、75歳の誕生日より前', () => {
    expect(edit('1979-04-01').errors['acquiredDate']).toBe('資格取得日は生年月日より後の日付にしてください');
    expect(edit('2055-05-10').errors['acquiredDate']).toContain('資格取得日に75歳以上の人は');
    expect(edit('2055-05-09').errors).toEqual({});
  });

  it('直すと扶養に入った日が資格の期間の外になる被扶養者を返す（直す前から外にいた人は返さない）', () => {
    const deps = [
      { id: 'd1', name: '花子', certifiedDate: '2024-04-01' },
      { id: 'd2', name: '一郎', certifiedDate: '2024-06-01' },
      { id: 'd3', name: '次郎', certifiedDate: '2020-01-01' },
    ];
    const before = [{ acquiredDate: '2024-04-01', lostDate: null }];
    expect(dependentsLeftOutside(deps, before, [{ acquiredDate: '2024-05-01', lostDate: null }]).map((x) => x.id)).toEqual(['d1']);
    expect(dependentsLeftOutside(deps, before, [{ acquiredDate: '2024-04-01', lostDate: '2024-05-01' }]).map((x) => x.id)).toEqual(['d2']);
    expect(dependentsLeftOutside(deps, before, before)).toEqual([]);
  });
});

describe('生年月日の訂正：75歳', () => {
  it('新しい生年月日で、どれかの資格取得日に75歳以上になるなら止める', () => {
    expect(checkBirthDateChange('1980-05-10', '1945-05-10', '2026-11-06', '2020-04-01', ['2020-04-01', '2024-04-01'])['birthDate']).toContain('資格取得日（2024年4月1日）に75歳以上');
    expect(checkBirthDateChange('1980-05-10', '1950-05-10', '2026-11-06', '2020-04-01', ['2020-04-01'])).toEqual({});
  });
});
