import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BonusInput } from './bonus-input';

describe('BonusInput', () => {
  let component: BonusInput;
  let fixture: ComponentFixture<BonusInput>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BonusInput],
    }).compileComponents();

    fixture = TestBed.createComponent(BonusInput);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
