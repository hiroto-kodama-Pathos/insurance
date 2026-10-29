import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Offices } from './offices';

describe('Offices', () => {
  let component: Offices;
  let fixture: ComponentFixture<Offices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Offices],
    }).compileComponents();

    fixture = TestBed.createComponent(Offices);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
