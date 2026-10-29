import { TestBed } from '@angular/core/testing';
import { BonusRepository } from './bonus-repository';

describe('BonusRepository', () => {
  let service: BonusRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BonusRepository);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
