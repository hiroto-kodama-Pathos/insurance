import { UsablePipe } from './usable.pipe';

describe('UsablePipe（使わないにしたマスタを選択肢から外す）', () => {
  const list = [{ id: 'a' }, { id: 'b', archived: true }, { id: 'c', archived: false }];
  it('使わないにしたものは外し、今選ばれているものは残す', () => {
    expect(new UsablePipe().transform(list).map((x) => x.id)).toEqual(['a', 'c']);
    expect(new UsablePipe().transform(list, 'b').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(new UsablePipe().transform(null)).toEqual([]);
  });
});
