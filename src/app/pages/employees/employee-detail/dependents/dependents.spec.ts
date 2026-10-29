import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dependents } from './dependents';

describe('Dependents', () => {
  let component: Dependents;
  let fixture: ComponentFixture<Dependents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dependents],
    }).compileComponents();

    fixture = TestBed.createComponent(Dependents);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
