import { TestBed } from '@angular/core/testing';
import { Bonus } from './bonus';

describe('Bonus', () => {
  let service: Bonus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Bonus);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
