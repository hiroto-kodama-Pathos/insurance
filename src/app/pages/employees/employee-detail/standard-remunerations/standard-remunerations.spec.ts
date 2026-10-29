import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StandardRemunerations } from './standard-remunerations';

describe('StandardRemunerations', () => {
  let component: StandardRemunerations;
  let fixture: ComponentFixture<StandardRemunerations>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StandardRemunerations],
    }).compileComponents();

    fixture = TestBed.createComponent(StandardRemunerations);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
