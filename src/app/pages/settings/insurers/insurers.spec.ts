import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Insurers } from './insurers';

describe('Insurers', () => {
  let component: Insurers;
  let fixture: ComponentFixture<Insurers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Insurers],
    }).compileComponents();

    fixture = TestBed.createComponent(Insurers);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
