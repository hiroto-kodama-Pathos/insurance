import { TestBed } from '@angular/core/testing';
import { buildKyokaiGrades } from './grade-suggest';
import { StandardRemuneration } from './standard-remuneration';

describe('StandardRemuneration', () => {
  let service: StandardRemuneration;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StandardRemuneration);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('StandardRemuneration.suggestGrade：厚生年金の額', () => {
  const grades = buildKyokaiGrades('2020-09');
  it('厚生年金の範囲より下・上の報酬月額は、厚生年金のいちばん下・上の等級（健康保険の額を入れない）', () => {
    const s = new StandardRemuneration();
    expect(s.suggestGrade(60_000, grades as never, '2026-10')).toMatchObject({ healthStandard: 58_000, pensionStandard: 88_000, pensionGrade: 1 });
    expect(s.suggestGrade(2_000_000, grades as never, '2026-10')).toMatchObject({ healthStandard: 1_390_000, pensionStandard: 650_000, pensionGrade: 32 });
    expect(s.suggestGrade(320_000, grades as never, '2026-10')).toMatchObject({ healthStandard: 320_000, pensionStandard: 320_000 });
  });
});
