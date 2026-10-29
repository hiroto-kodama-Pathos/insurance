import { TestBed } from '@angular/core/testing';
import { Closing } from './closing';

describe('Closing', () => {
  let service: Closing;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Closing);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
