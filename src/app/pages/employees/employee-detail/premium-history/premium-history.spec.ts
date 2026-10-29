import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PremiumHistory } from './premium-history';

describe('PremiumHistory', () => {
  let component: PremiumHistory;
  let fixture: ComponentFixture<PremiumHistory>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PremiumHistory],
    }).compileComponents();

    fixture = TestBed.createComponent(PremiumHistory);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
