import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Confirm, ConfirmRequest } from './confirm';
import { signal } from '@angular/core';
import { FormSnapshot, HasUnsavedChanges, unsavedChangesGuard } from './unsaved-guard';

describe('保存していない入力があるときの、画面を移る前の確認', () => {
  const asked: ConfirmRequest[] = [];
  let answer = true;
  beforeEach(() => {
    asked.length = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: Confirm, useValue: { ask: async (r: ConfirmRequest) => (asked.push(r), answer) } }],
    });
  });
  const run = (n: number) =>
    TestBed.runInInjectionContext(() =>
      unsavedChangesGuard({ unsavedCount: () => n } as HasUnsavedChanges, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot),
    );

  it('保存していない入力がなければ、確認せずに移る', () => {
    expect(run(0)).toBe(true);
    expect(asked).toEqual([]);
  });

  it('あれば件数を添えて確認し、「保存せずに移る」なら移る・やめたら移らない', async () => {
    answer = true;
    expect(await run(3)).toBe(true);
    expect(asked[0].message).toContain('3件の入力をまだ保存していません');
    answer = false;
    expect(await run(1)).toBe(false);
  });
});

describe('フォームを開いたときの入力と比べる（FormSnapshot）', () => {
  it('覚えたときから入力を変えたかを見る。元に戻せば変えていないことになる。覚える前は false', async () => {
    const form = signal({ name: '', amount: null as number | null });
    const snap = new FormSnapshot(() => form());
    expect(snap.changed()).toBe(false);
    snap.take();
    form.set({ name: '山田', amount: null }); // 開く処理が続けて入れた値も、変えていない状態に含める
    await Promise.resolve();
    expect(snap.changed()).toBe(false);
    form.set({ name: '山田', amount: 300000 });
    expect(snap.changed()).toBe(true);
    form.set({ name: '山田', amount: null });
    expect(snap.changed()).toBe(false);
  });
});
