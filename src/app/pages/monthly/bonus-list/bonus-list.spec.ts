import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BonusList } from './bonus-list';

describe('BonusList', () => {
  let component: BonusList;
  let fixture: ComponentFixture<BonusList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BonusList],
    }).compileComponents();

    fixture = TestBed.createComponent(BonusList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
