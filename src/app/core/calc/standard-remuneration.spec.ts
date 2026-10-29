import { TestBed } from '@angular/core/testing';
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
