import { TestBed } from '@angular/core/testing';
import { Rate } from './rate';

describe('Rate', () => {
  let service: Rate;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Rate);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
