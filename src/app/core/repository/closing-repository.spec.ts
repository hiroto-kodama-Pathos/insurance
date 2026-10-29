import { TestBed } from '@angular/core/testing';
import { ClosingRepository } from './closing-repository';

describe('ClosingRepository', () => {
  let service: ClosingRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClosingRepository);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
