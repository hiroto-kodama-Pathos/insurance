import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BonusTypes } from './bonus-types';

describe('BonusTypes', () => {
  let component: BonusTypes;
  let fixture: ComponentFixture<BonusTypes>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BonusTypes],
    }).compileComponents();

    fixture = TestBed.createComponent(BonusTypes);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
