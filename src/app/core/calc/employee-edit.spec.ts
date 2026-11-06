import { buildKyokaiGrades } from './grade-suggest';
import {
  checkNameChange,
  checkNumberChange,
  checkLeave,
  checkLoss,
  checkReacquire,
  checkRetirement,
  checkStandard,
  checkTransfer,
  isValidMonth,
} from './employee-edit';

const open = [{ acquiredDate: '2024-04-01', lostDate: null }];
const closed = [{ acquiredDate: '2024-04-01', lostDate: '2026-05-01' }];

describe('退職・喪失・再加入', () => {
  it('退職日の翌日を資格喪失日にする（月末退職は翌月1日）', () => {
    expect(checkRetirement(open, '2026-10-31').lostDate).toBe('2026-11-01');
    expect(checkRetirement(open, '2026-10-15').lostDate).toBe('2026-10-16');
  });

  it('加入中の資格がない人は退職を登録できない', () => {
    expect(checkRetirement(closed, '2026-10-31').errors['retirementDate']).toBeDefined();
  });

  it('退職日が資格取得日より前ならエラー', () => {
    expect(checkRetirement(open, '2024-03-31').errors['retirementDate']).toBeDefined();
  });

  it('退職以外の喪失は、理由が必須', () => {
    expect(checkLoss(open, '2026-10-01', '')['reason']).toBeDefined();
    expect(checkLoss(open, '2026-10-01', 'conditions')).toEqual({});
  });

  it('再加入は、加入中なら不可・前の喪失日以降なら可', () => {
    expect(checkReacquire(open, '2026-10-01')['acquiredDate']).toBeDefined();
    expect(checkReacquire(closed, '2026-04-30')['acquiredDate']).toBeDefined();
    expect(checkReacquire(closed, '2026-10-01')).toEqual({});
  });
});

describe('異動', () => {
  const a = [{ validFrom: '2024-04-01', officeId: 'honsha' }];
  it('今と同じ事業所や、今の所属の開始日以前は不可', () => {
    expect(checkTransfer(a, '2026-10-15', 'honsha')['officeId']).toBeDefined();
    expect(checkTransfer(a, '2024-04-01', 'osaka')['transferDate']).toBeDefined();
    expect(checkTransfer(a, '2026-10-15', 'osaka')).toEqual({});
  });
});

describe('標準報酬月額の履歴の追加', () => {
  it('同じ適用開始月の二重登録は不可', () => {
    const e = checkStandard(['2026-09'], {
      validFrom: '2026-09',
      reason: 'regular',
      healthStandard: 340_000,
      pensionStandard: 340_000,
    });
    expect(e['validFrom']).toBeDefined();
  });

  it('適用開始月の形', () => {
    expect(isValidMonth('2026-09')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
  });
});

describe('休業', () => {
  it('終了日は空でもよいが、開始日より前は不可', () => {
    expect(checkLeave({ type: 'childcare', startDate: '2026-10-01', endDate: '', workedDays: null })).toEqual({});
    expect(
      checkLeave({ type: 'childcare', startDate: '2026-10-01', endDate: '2026-09-30', workedDays: null })['endDate'],
    ).toBeDefined();
  });

  it('就業した日数は育休だけ', () => {
    expect(
      checkLeave({ type: 'maternity', startDate: '2026-10-01', endDate: '', workedDays: 2 })['workedDays'],
    ).toBeDefined();
  });
});

describe('氏名の変更', () => {
  it('空欄・50文字を超える・今と同じ氏名は入れない。前後の空白は無視する', () => {
    expect(checkNameChange('山田 花子', '')).toEqual({ name: '氏名を入力してください' });
    expect(checkNameChange('山田 花子', '　 ')).toEqual({ name: '氏名を入力してください' });
    expect(checkNameChange('山田 花子', 'あ'.repeat(51))).toEqual({ name: '氏名は50文字以内で入力してください' });
    expect(checkNameChange('山田 花子', ' 山田 花子 ')).toEqual({ name: '今の氏名と同じです' });
    expect(checkNameChange('山田 花子', '佐藤 花子')).toEqual({});
    expect(checkNameChange('山田 花子', 'あ'.repeat(50))).toEqual({});
  });
});

describe('社員番号の変更', () => {
  const others = ['0002', 'T0010'];
  it('全角は半角にそろえ、前後の空白を除いて保存する', () => {
    expect(checkNumberChange('0001', ' Ａ－００１ ', others)).toEqual({ errors: {}, number: 'A-001' });
    expect(checkNumberChange('0001', 'Aー001', others).number).toBe('A-001'); // 日本語入力の「ー」も「-」に
  });

  it('空欄・形の違う番号・今と同じ・ほかの人と同じは入れない', () => {
    expect(checkNumberChange('0001', '', others).errors).toEqual({ employeeNumber: '社員番号を入力してください' });
    expect(checkNumberChange('0001', '山田', others).errors).toEqual({ employeeNumber: '社員番号は半角英数字20文字以内で入力してください' });
    expect(checkNumberChange('0001', '1'.repeat(21), others).errors['employeeNumber']).toContain('20文字以内');
    expect(checkNumberChange('0001', '1'.repeat(20), others).errors).toEqual({});
    expect(checkNumberChange('0001', '０００１', others).errors).toEqual({ employeeNumber: '今の社員番号と同じです' });
    expect(checkNumberChange('0001', 'T0010', others).errors).toEqual({ employeeNumber: 'この社員番号はほかの従業員が使っています' });
  });
});

describe('標準報酬月額の履歴：等級の額', () => {
  it('等級表にない額は、追加・訂正・異動のどれでも入れない', () => {
    const grades = buildKyokaiGrades('2020-09');
    const input = { validFrom: '2026-09', reason: 'regular' as const, healthStandard: 299_000, pensionStandard: 300_000 };
    const e = checkStandard([], input, grades);
    expect(e['healthStandard']).toContain('近い等級');
    expect(e['pensionStandard']).toBeUndefined();
    expect(checkStandard([], { ...input, healthStandard: 300_000 }, grades)).toEqual({});
  });
});

describe('標準報酬月額の履歴：その月の等級表がないとき', () => {
  it('等級表がない月（等級表より前の月・読み込めなかった）は、等級の額でも登録できない', () => {
    const grades = buildKyokaiGrades('2020-09');
    const input = { validFrom: '2019-04', reason: 'regular' as const, healthStandard: 300_000, pensionStandard: 300_000 };
    expect(checkStandard([], input, grades)['healthStandard']).toContain('使える等級表が登録されていないため、登録できません');
    expect(checkStandard([], { ...input, validFrom: '2026-09' }, [])['pensionStandard']).toContain('使える等級表が登録されていない');
  });
});
