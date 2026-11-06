import { insurerUsage, inUseMessage, officeUsage, payrollGroupUsage } from './master-usage';

describe('適用事業所・支払区分が使われているか', () => {
  const employees = [
    { assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }, { validFrom: '2026-04-01', officeId: 'osaka' }], payrollAssignments: [{ validFrom: '2024-04-01', payrollGroupId: 'g1' }] },
    { assignments: [{ validFrom: '2024-04-01', officeId: 'honsha' }] },
  ];
  it('今の所属だけでなく、過去の所属も数える', () => {
    expect(officeUsage(employees, 'honsha')).toBe(2); // 1人目は大阪へ異動したが、過去に所属
    expect(officeUsage(employees, 'osaka')).toBe(1);
    expect(officeUsage(employees, 'nagoya')).toBe(0);
    expect(payrollGroupUsage(employees, 'g1')).toBe(1);
    expect(payrollGroupUsage(employees, 'g2')).toBe(0);
  });
  it('使用中なら知らせの文、使われていなければ null', () => {
    expect(inUseMessage('適用事業所', '本社', { isDefault: true })).toContain('新規登録の初期値として使用中なので、削除できません');
    expect(inUseMessage('適用事業所', '大阪支店', { isDefault: false, employees: 3 })).toBe(
      '適用事業所「大阪支店」は使用中なので、削除できません（従業員3人が所属しています。過去の所属を含みます）。',
    );
    expect(inUseMessage('賞与の種類', '夏季賞与', { isDefault: false, bonuses: true })).toContain('この種類の賞与が登録されています');
    expect(inUseMessage('適用事業所', '名古屋支店', { isDefault: false, employees: 0 })).toBeNull();
  });

  it('健康保険組合：適用事業所の保険者・二以上事業所勤務で選んだ保険者になっていれば使用中', () => {
    const offices = [{ insurerId: 'k1' }, { insurerId: 'kyokai' }];
    const employees = [{ standardHistory: [{ selectedInsurerId: 'k2' }] }, { standardHistory: [{}] }];
    expect(insurerUsage(offices, employees, 'k1')).toEqual({ offices: 1, employees: 0 });
    expect(insurerUsage(offices, employees, 'k2')).toEqual({ offices: 0, employees: 1 });
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 1, employees: 0 })).toContain('適用事業所1件の保険者');
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 0, employees: 1 })).toContain('二以上事業所勤務の保険者として選んでいます');
    expect(inUseMessage('健康保険組合', 'A組合', { isDefault: false, offices: 0, employees: 0 })).toBeNull();
  });
});
