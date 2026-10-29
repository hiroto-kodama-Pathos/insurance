import { TestBed } from '@angular/core/testing';
import { EmployeeRepository } from './employee-repository';

describe('EmployeeRepository', () => {
  let service: EmployeeRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EmployeeRepository);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
