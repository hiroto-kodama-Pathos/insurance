import { TestBed } from '@angular/core/testing';
import { PremiumFacade } from './premium-facade';

describe('PremiumFacade', () => {
  let service: PremiumFacade;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PremiumFacade);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
