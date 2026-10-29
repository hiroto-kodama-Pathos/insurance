import { TestBed } from '@angular/core/testing';
import { SalaryRepository } from './salary-repository';

describe('SalaryRepository', () => {
  let service: SalaryRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SalaryRepository);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
