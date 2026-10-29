import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegularEstimates } from './regular-estimates';

describe('RegularEstimates', () => {
  let component: RegularEstimates;
  let fixture: ComponentFixture<RegularEstimates>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegularEstimates],
    }).compileComponents();

    fixture = TestBed.createComponent(RegularEstimates);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
