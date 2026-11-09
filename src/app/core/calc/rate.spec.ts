import { TestBed } from '@angular/core/testing';
import { Rate } from './rate';

describe('Rate', () => {
  let service: Rate;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Rate);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('Rate.findRate：協会けんぽの健康保険料率は都道府県で選ぶ', () => {
  const rates = [{ insurerId: 'kyokai', rateType: 'health' as const, prefecture: '千葉県', validFrom: '2026-03', rate: 9730, employeeShare: 500 },
    { insurerId: 'kyokai', rateType: 'health' as const, prefecture: '東京都', validFrom: '2026-03', rate: 9850, employeeShare: 500 }];
  const kyokai = { id: 'kyokai', type: 'kyokai' as const, name: '協会けんぽ' };
  it('都道府県が分からなければ選ばない（ほかの都道府県の料率を返さない）', () => {
    const r = new Rate();
    expect(r.findRate(rates, kyokai, 'health', '2026-10', null)).toBeNull();
    expect(r.findRate(rates, kyokai, 'health', '2026-10', '千葉県')).toEqual({ rate: 9730, employeeShare: 500 });
  });
});
