import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompanySettings } from './company-settings';

describe('CompanySettings', () => {
  let component: CompanySettings;
  let fixture: ComponentFixture<CompanySettings>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanySettings],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanySettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
