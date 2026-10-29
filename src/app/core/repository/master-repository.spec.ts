import { TestBed } from '@angular/core/testing';
import { MasterRepository } from './master-repository';

describe('MasterRepository', () => {
  let service: MasterRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MasterRepository);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
