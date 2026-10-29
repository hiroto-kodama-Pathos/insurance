import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RevisionCandidates } from './revision-candidates';

describe('RevisionCandidates', () => {
  let component: RevisionCandidates;
  let fixture: ComponentFixture<RevisionCandidates>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RevisionCandidates],
    }).compileComponents();

    fixture = TestBed.createComponent(RevisionCandidates);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
