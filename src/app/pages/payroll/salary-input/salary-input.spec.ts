import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SalaryInput } from './salary-input';

describe('SalaryInput', () => {
  let component: SalaryInput;
  let fixture: ComponentFixture<SalaryInput>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalaryInput],
    }).compileComponents();

    fixture = TestBed.createComponent(SalaryInput);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
