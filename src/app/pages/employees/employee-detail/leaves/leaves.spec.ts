import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leaves } from './leaves';

describe('Leaves', () => {
  let component: Leaves;
  let fixture: ComponentFixture<Leaves>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Leaves],
    }).compileComponents();

    fixture = TestBed.createComponent(Leaves);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
