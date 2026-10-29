import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RatesGrades } from './rates-grades';

describe('RatesGrades', () => {
  let component: RatesGrades;
  let fixture: ComponentFixture<RatesGrades>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RatesGrades],
    }).compileComponents();

    fixture = TestBed.createComponent(RatesGrades);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
