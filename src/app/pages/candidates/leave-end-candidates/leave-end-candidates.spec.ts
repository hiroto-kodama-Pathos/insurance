import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LeaveEndCandidates } from './leave-end-candidates';

describe('LeaveEndCandidates', () => {
  let component: LeaveEndCandidates;
  let fixture: ComponentFixture<LeaveEndCandidates>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeaveEndCandidates],
    }).compileComponents();

    fixture = TestBed.createComponent(LeaveEndCandidates);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
