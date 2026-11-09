import { buildKyokaiGrades } from './grade-suggest';
import {
  bonusDateRange,
  buildBonusImport,
  buildDependentImport,
  buildEmployeeImport,
  buildStandardImport,
  importKindFromQuery,
  importTemplateCsv,
  isTemplateHeaders,
  missingImportColumns,
  parseInsuredType,
  pensionFromHealth,
  templateMapping,
} from './master-import';
import { parseCsv } from './csv';

const offices = [ { id: 'honsha', name: '本社' }, { id: 'osaka', name: '大阪支店' }];

describe('CSV取り込みのテンプレートと対応づけ', () => {
  it('テンプレートの見出しなら、対応づけなしで取り込める', () => {
    const rows = parseCsv(importTemplateCsv('employee'));
    expect(isTemplateHeaders('employee', rows[0])).toBe(true);
    expect(missingImportColumns('employee', templateMapping('employee'), rows[0])).toEqual([]);
  });

  it('必須の項目の列がなければ知らせる', () => {
    const missing = missingImportColumns('bonus', { employeeNumber: '社員番号', paidDate: '', amount: '支給額' }, ['社員番号']);
    expect(missing).toContain('（支給日の列を選んでください）');
    expect(missing).toContain('支給額');
  });
});

describe('従業員のCSV', () => {
  const ctx = {
    existingNumbers: ['0001'],
    offices,
    groups: [{ id: 'monthly', name: '月給者', isDefault: true }, { id: 'part', name: 'パート' }],
    scope: 'all',
  };
  const head = ['社員番号', '氏名', '生年月日', '適用事業所', '入社日', '資格取得日', '被保険者区分', '支払区分'];
  const run = (rows: string[][], scope = 'all') => buildEmployeeImport([head, ...rows], templateMapping('employee'), { ...ctx, scope });

  it('資格取得日に75歳以上の人は加入する人として取り込まない', () => {
    const [r] = run([['0103', '上田 茂', '1950-01-01', '本社', '', '2026-10-01', '', '']]);
    expect(r.status).toBe('error');
    expect(r.errors[0]).toContain('資格取得日に75歳以上の人は');
  });

  it('入社日と資格取得日の両方があれば、所属・支払区分は入社日から。資格取得日が入社日より前ならエラー', () => {
    const [a, b] = run([
      ['0104', '岡田 光', '1990-01-01', '本社', '2024-04-01', '2024-10-01', '', ''],
      ['0105', '加藤 誠', '1990-01-01', '本社', '2024-10-01', '2024-04-01', '', ''],
    ]);
    expect(a.save).toMatchObject({ startDate: '2024-04-01', acquiredDate: '2024-10-01' });
    expect(b.status).toBe('error');
    expect(b.errors.join()).toContain('資格取得日が入社日より前です');
  });

  it('使わないにした事業所・支払区分には、新しく所属させない', () => {
    const run2 = (rows: string[][]) =>
      buildEmployeeImport([head, ...rows], templateMapping('employee'), {
        ...ctx,
        offices: offices.map((o) => (o.id === 'osaka' ? { ...o, archived: true } : o)),
        groups: ctx.groups.map((g) => (g.id === 'part' ? { ...g, archived: true } : g)),
      });
    const [a, b] = run2([
      ['0106', '木村 翼', '1990-01-01', '大阪支店', '', '2024-04-01', '', ''],
      ['0107', '佐々木 光', '1990-01-01', '本社', '', '2024-04-01', '', 'パート'],
    ]);
    expect(a.errors.join()).toContain('使わないにしているため、新しく所属させられません');
    expect(b.errors.join()).toContain('支払区分「パート」は使わないにしているため');
  });

  it('加入する人・未加入の人を登録する内容にする', () => {
    const [a, b] = run([
      ['0101', '青木 健', 'S60.4.1', '本社', '', '2020/4/1', '', 'パート'],
      ['0102', '石井 葵', '2001-02-03', 'osaka', '2026-10-01', '', '短時間労働者', '月給者'],
    ]);
    expect(a.status).toBe('new');
    expect(a.save).toEqual({
      employeeNumber: '0101', name: '青木 健', birthDate: '1985-04-01', officeId: 'honsha', startDate: '2020-04-01',
      acquiredDate: '2020-04-01', insuredType: 'general', payrollGroupId: 'part',
    });
    expect(b.save).toMatchObject({ acquiredDate: null, startDate: '2026-10-01', officeId: 'osaka', insuredType: 'shortTime', payrollGroupId: null });
    expect(b.summary).toContain('未加入');
  });

  it('エラー行・登録済み・担当範囲外', () => {
    const rows = run([
      ['0001', '山田 太郎', '1980-05-10', '本社', '', '2024-04-01', '', ''],
      ['', '名無し', 'x', '名古屋', '', '', '役員', 'アルバイト'],
      ['0103', '上田', '1990-01-01', '大阪支店', '2026-01-01', '', '', ''],
      ['0103', '上田', '1990-01-01', '大阪支店', '2026-01-01', '', '', ''],
    ], 'honsha');
    expect(rows[0].status).toBe('same');
    expect(rows[1].errors).toEqual([
      '社員番号が空欄です', '生年月日を読み取れません（x）', '入社日か資格取得日を入れてください',
      '適用事業所「名古屋」が見つかりません', '被保険者区分「役員」が分かりません', '支払区分「アルバイト」が見つかりません',
    ]);
    expect(rows[2].status).toBe('outOfScope');
    expect(rows[3].errors).toContain('同じ社員番号の行がファイルの中に2つ以上あります');
  });

  it('被保険者区分の書き方', () => {
    expect(parseInsuredType('')).toBe('general');
    expect(parseInsuredType('一般被保険者（短時間就労者）')).toBe('partTime');
    expect(parseInsuredType('specialReduction')).toBe('specialReduction');
    expect(parseInsuredType('不明')).toBeNull();
  });
});

describe('標準報酬月額のCSV', () => {
  const grades = buildKyokaiGrades('2020-09');
  const employees = [
    {
      id: 'e1', employeeNumber: '0001', name: '山田', assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
      qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
      standardHistory: [{ validFrom: '2025-09', healthStandard: 300_000, pensionStandard: 300_000 }],
    },
    {
      id: 'e2', employeeNumber: '0002', name: '佐藤', assignments: [{ validFrom: '2026-04-01', officeId: 'osaka' }],
      qualifications: [{ acquiredDate: '2026-04-01', lostDate: null }], standardHistory: [],
    },
  ];
  const head = ['社員番号', '適用年月', '健康保険の標準報酬月額', '厚生年金の標準報酬月額'];
  const run = (rows: string[][], scope = 'all') => buildStandardImport([head, ...rows], templateMapping('standard'), employees, grades, scope);

  it('適用年月に使える等級表がなければ（等級表より前の月など）、その行は取り込まない', () => {
    const [row] = run([['0001', '2019-04', '300000', '300000']]);
    expect(row.status).toBe('error');
    expect(row.errors.join()).toContain('2019年4月に使える等級表が登録されていないため、登録できません');
  });

  it('厚生年金の欄が空なら、健康保険の額を厚生年金の等級の範囲に収める', () => {
    expect(pensionFromHealth(1_390_000, grades)).toBe(650_000);
    expect(pensionFromHealth(58_000, grades)).toBe(88_000);
    expect(pensionFromHealth(300_000, grades)).toBe(300_000);
  });

  it('登録する内容（理由は資格取得月・9月・それ以外で決める）', () => {
    const rows = run([
      ['1', '2026-09', '360', ''],
      ['0002', 'R8.4', '1,390,000', ''],
      ['0001', '2025-09', '300000', '300000'],
    ]);
    expect(rows[0].save).toMatchObject({ employeeId: 'e1', validFrom: '2026-09', reason: 'regular', healthStandard: 360_000, pensionStandard: 360_000 });
    expect(rows[1].save).toMatchObject({ employeeId: 'e2', validFrom: '2026-04', reason: 'acquisition', pensionStandard: 650_000 });
    expect(rows[2].status).toBe('same');
  });

  it('等級表にない額・資格のない月・同じ月で値が違う・担当範囲外', () => {
    const rows = run([
      ['0001', '2026-10', '301000', ''],
      ['0002', '2026-03', '300000', ''],
      ['0001', '2025-09', '320000', ''],
      ['0002', '2026-10', '300000', ''],
    ], 'honsha');
    expect(rows[0].errors[0]).toContain('301,000円は等級表にありません');
    expect(rows[1].errors).toEqual(['2026年3月に社会保険の資格がありません']);
    expect(rows[2].errors[0]).toContain('値が違います');
    expect(rows[3].status).toBe('outOfScope');
  });
});

describe('賞与のCSV', () => {
  const ctx = {
    employees: [
      { id: 'e1', employeeNumber: '0001', name: '山田', assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }] },
      { id: 'e2', employeeNumber: '0002', name: '佐藤', assignments: [{ validFrom: '2020-04-01', officeId: 'osaka' }] },
    ],
    existing: [{ employeeId: 'e1', paidDate: '2026-07-10' }],
    types: [
      { id: 'summer', name: '夏季賞与', isRemuneration: false, validFrom: '2020-04' },
      { id: 'quarterly', name: '四半期賞与', isRemuneration: true, validFrom: '2025-04' },
    ],
    closed: new Set(['2026-06|osaka']),
    scope: 'all',
  };
  const head = ['社員番号', '支給日', '賞与額', 'うち現物', '賞与の種類'];
  const run = (rows: string[][], scope = 'all') => buildBonusImport([head, ...rows], templateMapping('bonus'), { ...ctx, scope });

  it('使わないにした種類は新しい賞与では選べない。登録済みの賞与の訂正で種類が前と同じなら通す', () => {
    const c = {
      ...ctx,
      types: ctx.types.map((t) => (t.id === 'summer' ? { ...t, archived: true } : t)),
      existing: [{ id: 'e1_2026-07-10', employeeId: 'e1', paidDate: '2026-07-10', amount: 300_000, inKindAmount: null, bonusTypeId: 'summer' }],
    };
    const [fresh, fix] = buildBonusImport([head, ['0001', '2026-12-10', '300000', '', '夏季賞与'], ['0001', '2026-07-10', '350000', '', '夏季賞与']], templateMapping('bonus'), c);
    expect(fresh.errors.join()).toContain('使わないにしているため');
    expect(fix.errors.join()).not.toContain('使わないにしているため');
  });

  it('登録する内容（報酬扱いは種類と支給日で決める）', () => {
    const rows = run([
      ['0001', '2026/12/10', '500,000', '30000', '夏季賞与'],
      ['0002', '2026-10-10', '120000', '', '四半期賞与'],
    ]);
    expect(rows[0].save).toEqual({
      employeeId: 'e1', paidDate: '2026-12-10', amount: 500_000, inKindAmount: 30_000, bonusTypeId: 'summer', isRemuneration: false, officeId: 'honsha',
    });
    expect(rows[1].save!.isRemuneration).toBe(true);
    expect(rows[1].summary).toContain('報酬扱い');
  });

  it('登録済み・確定済み・担当範囲外・エラー', () => {
    const rows = run([
      ['0001', '2026-07-10', '100000', '', ''],
      ['0002', '2026-06-30', '100000', '', ''],
      ['0002', '2026-12-10', '100000', '', ''],
      ['0001', '2026-12-10', '100000', '200000', '決算賞与'],
      ['0001', '2026-12-10', '100000', '', ''],
    ], 'honsha');
    expect(rows.map((r) => r.status)).toEqual(['same', 'closed', 'outOfScope', 'error', 'error']);
    expect(rows[3].errors).toEqual(['うち現物は賞与額の内数です（賞与額以下にしてください）', '賞与の種類「決算賞与」が見つかりません']);
    expect(rows[4].errors).toContain('同じ社員番号・支給日の行がファイルの中に2つ以上あります');
  });

  it('賞与額は画面と同じチェック（1億円以上・桁の多すぎる額・負の額・うち現物が多い）', () => {
    const one = (amount: string, inKind = '') => run([['0001', '2026-12-10', amount, inKind, '']])[0];
    expect(one('100000000').errors).toContain('賞与額が大きすぎます（1億円未満）。桁を確かめてください');
    expect(one('99999999').status).toBe('new');
    expect(one('9007199254740993').errors).toContain('賞与額を読み取れません');
    expect(one('-1').errors).toContain('賞与額を1円以上の円で入力してください');
    expect(one('100000', '100001').errors).toContain('うち現物は賞与額の内数です（賞与額以下にしてください）');
  });

  it('登録済みの賞与と内容が違う行は「訂正」の候補にする（同じ内容は取り込まない。確定済みの月は訂正しない）', () => {
    const c = { ...ctx, existing: [{ id: 'x1', employeeId: 'e1', paidDate: '2026-12-10', amount: 300_000, inKindAmount: null, bonusTypeId: 'summer' }] };
    const r = buildBonusImport([head, ['0001', '2026-12-10', '350000', '', '夏季賞与'], ['0001', '2026-12-10', '300000', '', '夏季賞与']], templateMapping('bonus'), c);
    expect(r[0].status).toBe('update');
    expect(r[0].summary).toBe('賞与額 300,000円 → 350,000円');
    expect(r[0].save).toMatchObject({ existingId: 'x1', amount: 350_000 });
    const same = buildBonusImport([head, ['0001', '2026-12-10', '300000', '', '夏季賞与']], templateMapping('bonus'), c)[0];
    expect(same.status).toBe('same');
    const closed = buildBonusImport([head, ['0002', '2026-06-30', '1', '', '']], templateMapping('bonus'), {
      ...c, existing: [{ id: 'x2', employeeId: 'e2', paidDate: '2026-06-30', amount: 5, inKindAmount: null, bonusTypeId: null }],
    })[0];
    expect(closed.status).toBe('closed');
  });

  it('支給日の範囲', () => {
    expect(bonusDateRange([head, ['1', '2026-12-10'], ['2', '2026/7/1'], ['3', 'x']], templateMapping('bonus'))).toEqual({ from: '2026-07-01', to: '2026-12-10' });
  });
});

describe('被扶養者のCSV', () => {
  const employees = [
    {
      id: 'e1', employeeNumber: '0001', name: '山田', assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
      qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
      dependents: [{ name: '山田 花子', birthDate: '1982-03-03', certifiedDate: '2020-04-01', removedDate: null }],
    },
    {
      id: 'e2', employeeNumber: '0002', name: '佐藤', assignments: [{ validFrom: '2024-04-01', officeId: 'osaka' }],
      qualifications: [{ acquiredDate: '2024-04-01', lostDate: null }],
    },
  ];
  const head = ['社員番号', '被扶養者の氏名', '被扶養者の生年月日', '扶養に入った日', '扶養から外れた日'];

  it('同じ本人の被扶養者を複数行で登録する内容にする', () => {
    const rows = buildDependentImport([head,
      ['1', '山田 一郎', 'H24.5.1', '2020/4/1', ''],
      ['0001', '山田 次郎', '2015-07-07', '2020-04-01', '2026-03-31'],
    ], templateMapping('dependent'), employees, 'all');
    expect(rows[0].save).toEqual({ employeeId: 'e1', name: '山田 一郎', birthDate: '2012-05-01', certifiedDate: '2020-04-01', removedDate: null });
    expect(rows[1].save!.removedDate).toBe('2026-03-31');
    expect(rows[0].summary).toContain('扶養中');
  });

  it('登録済み・資格のない日・日付の誤り・重複・担当範囲外', () => {
    const rows = buildDependentImport([head,
      ['0001', '山田　花子', '1982-03-03', '2020-04-01', ''],
      ['0002', '佐藤 太郎', '1990-01-01', '2023-04-01', ''],
      ['0002', '佐藤 次郎', '2020-01-01', '2019-12-01', '2019-11-01'],
      ['0001', '山田 三郎', '2018-01-01', '2020-04-01', ''],
      ['0001', '山田 三郎', '2018-01-01', '2021-04-01', ''],
      ['0002', '佐藤 四郎', '2018-01-01', '2024-05-01', ''],
    ], templateMapping('dependent'), employees, 'honsha');
    expect(rows.map((r) => r.status)).toEqual(['same', 'error', 'error', 'new', 'error', 'outOfScope']);
    expect(rows[1].errors).toEqual(['扶養に入った日（2023年4月1日）に、本人の社会保険の資格がありません']);
    expect(rows[2].errors).toContain('扶養に入った日は生年月日以降の日にしてください');
    expect(rows[2].errors).toContain('扶養から外れた日は、扶養に入った日より後の日にしてください');
    expect(rows[4].errors).toContain('同じ本人・同じ被扶養者の行がファイルの中に2つ以上あります');
  });
});

describe('最初に開く取り込みの種類', () => {
  it('URL の ?kind= が種類なら、その種類で開く。それ以外は null（従業員で開く）', () => {
    expect(importKindFromQuery('bonus')).toBe('bonus');
    expect(importKindFromQuery('salary')).toBeNull();
    expect(importKindFromQuery(null)).toBeNull();
  });
});

// ---- 漏れていた範囲：CSVのエラーの分岐 ----
describe('従業員のCSV：エラーの分岐', () => {
  const ctx = { existingNumbers: [], offices, groups: [{ id: 'monthly', name: '月給者', isDefault: true }], scope: 'all' };
  const head = ['社員番号', '氏名', '生年月日', '適用事業所', '入社日', '資格取得日', '被保険者区分', '支払区分'];
  const run = (...rows: string[][]) => buildEmployeeImport([head, ...rows], templateMapping('employee'), ctx);

  it('全角の社員番号は半角にして登録する。半角英数字でない番号はエラー', () => {
    expect(run(['０１０４', '上野 一', '1990-01-01', '本社', '', '2026-04-01', '', ''])[0].save!.employeeNumber).toBe('0104');
    expect(run(['01 05', '上野 二', '1990-01-01', '本社', '', '2026-04-01', '', ''])[0].errors).toEqual(['社員番号は半角英数字20文字以内にしてください']);
  });

  it('氏名・生年月日・適用事業所が空欄、氏名が50文字を超える', () => {
    expect(run(['0106', '', '', '', '', '2026-04-01', '', ''])[0].errors).toEqual(['氏名が空欄です', '生年月日が空欄です', '適用事業所が空欄です']);
    expect(run(['0107', 'あ'.repeat(51), '1990-01-01', '本社', '', '2026-04-01', '', ''])[0].errors).toEqual(['氏名は50文字以内にしてください']);
  });

  it('資格取得日が生年月日より前。入社日を読み取れないときは「どちらかを入れて」を重ねて出さない', () => {
    expect(run(['0108', '上野 三', '1990-01-01', '本社', '', '1989-12-31', '', ''])[0].errors).toEqual(['資格取得日が生年月日と同じか、それより前です']);
    expect(run(['0109', '上野 四', '2000-04-01', '本社', '', '2000-04-01', '', ''])[0].errors).toEqual(['資格取得日が生年月日と同じか、それより前です']);
    expect(run(['0110', '上野 五', '2000-04-01', '本社', '2000-04-01', '', '', ''])[0].errors).toEqual(['入社日が生年月日と同じか、それより前です']);
    expect(buildEmployeeImport([head, ['0111', '上野 六', '2027-04-01', '本社', '', '', '', '']], templateMapping('employee'), { ...ctx, today: '2026-11-09' })[0].errors).toContain('生年月日に、今日より後の日は入れられません');
    expect(run(['0109', '上野 四', '1990-01-01', '本社', '2026-13-01', '', '', ''])[0].errors).toEqual(['入社日を読み取れません（2026-13-01）']);
  });

  it('被保険者区分の略した書き方（短時間就労者・短時間）', () => {
    expect(parseInsuredType('短時間就労者')).toBe('partTime');
    expect(parseInsuredType('短時間')).toBe('shortTime');
    expect(parseInsuredType('一般')).toBe('general');
  });
});

describe('被扶養者のCSV：エラーの分岐', () => {
  const employees = [{
    id: 'e1', employeeNumber: '0001', name: '山田', assignments: [{ validFrom: '2020-04-01', officeId: 'honsha' }],
    qualifications: [{ acquiredDate: '2020-04-01', lostDate: null }],
  }];
  const head = ['社員番号', '被扶養者の氏名', '被扶養者の生年月日', '扶養に入った日', '扶養から外れた日'];
  const run = (...rows: string[][]) => buildDependentImport([head, ...rows], templateMapping('dependent'), employees, 'all');

  it('本人の社員番号が見つからない・空欄', () => {
    expect(run(['9999', '山田 一郎', '2012-05-01', '2020-04-01', ''])[0].errors).toEqual(['社員番号「9999」の従業員が見つかりません']);
    expect(run(['', '山田 一郎', '2012-05-01', '2020-04-01', ''])[0].errors).toEqual(['社員番号「空欄」の従業員が見つかりません']);
  });

  it('詳細の追加と同じく、75歳以上・未来の生年月日・1年以上先・75歳の誕生日より後に外れた・本人と同じ人を止める', () => {
    const today = '2026-11-06';
    const one = (row: string[]) => buildDependentImport([head, row], templateMapping('dependent'), [{ ...employees[0], birthDate: '1980-05-10' }], 'all', today)[0];
    expect(one(['0001', 'a', '1940-01-01', '2024-04-01', '']).errors).toContain('75歳以上の人は後期高齢者医療制度の対象のため、被扶養者として登録できません');
    expect(one(['0001', 'a', '2027-01-01', '2027-01-01', '']).errors).toContain('生年月日に、今日より後の日は入れられません');
    expect(one(['0001', 'a', '2010-01-01', '2028-04-01', '']).errors).toContain('扶養に入った日が1年以上先です。年を確かめてください');
    expect(one(['0001', 'b', '1950-01-01', '2024-04-01', '2026-01-01']).errors[0]).toContain('75歳の誕生日（2025年1月1日）に扶養から外れています');
    expect(one(['0001', '山田', '1980-05-10', '2024-04-01', '']).errors[0]).toContain('本人を被扶養者にはできません');
    expect(one(['0001', '山田 一郎', '2012-05-01', '2024-04-01', '']).status).toBe('new');
  });

  it('氏名・生年月日・扶養に入った日が空欄（行はエラーで、内容の要約は出さない）', () => {
    const [r] = run(['0001', '', '', '', '']);
    expect(r.status).toBe('error');
    expect(r.errors).toEqual(['被扶養者の生年月日が空欄です', '扶養に入った日が空欄です', '氏名を入力してください']);
    expect(r.summary).toBe('');
  });

  it('日付を読み取れない（生年月日・扶養から外れた日）', () => {
    expect(run(['0001', '山田 一郎', '2012/13/01', '2020-04-01', ''])[0].errors).toEqual(['被扶養者の生年月日を読み取れません（2012/13/01）']);
    expect(run(['0001', '山田 一郎', '2012-05-01', '2020-04-01', '昨日'])[0].errors).toEqual(['扶養から外れた日を読み取れません（昨日）']);
  });

  it('扶養から外れた日がある行は、「○○まで」と要約する', () => {
    expect(run(['0001', '山田 一郎', '2012-05-01', '2020-04-01', '2026-03-31'])[0].summary).toBe('山田 一郎（2012年5月1日生）2020年4月1日から2026年3月31日まで');
  });
});
