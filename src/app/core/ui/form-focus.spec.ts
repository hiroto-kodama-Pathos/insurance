import { focusFormSoon } from './form-focus';

describe('開いた入力欄の最初の欄にカーソルを置く', () => {
  afterEach(() => document.querySelectorAll('app-test').forEach((x) => x.remove()));

  it('開いたあとに出たフォームの、最初の入力欄（隠し項目・チェックボックスは飛ばす）にカーソルを置く', async () => {
    const host = document.createElement('app-test');
    host.innerHTML = '<form class="form"><input name="old" /></form>';
    document.body.appendChild(host);
    focusFormSoon('app-test', true);
    host.insertAdjacentHTML('beforeend', '<form class="form"><input type="hidden" name="h" /><input type="checkbox" name="c" /><input name="first" /></form>');
    await new Promise((r) => setTimeout(r));
    expect((document.activeElement as HTMLInputElement).name).toBe('first');
  });

  it('前からあるフォームだけなら、onlyNew では移らない', async () => {
    const host = document.createElement('app-test');
    host.innerHTML = '<form class="form"><input name="old" /></form>';
    document.body.appendChild(host);
    (document.activeElement as HTMLElement | null)?.blur();
    focusFormSoon('app-test', true);
    await new Promise((r) => setTimeout(r));
    expect((document.activeElement as HTMLInputElement | null)?.name).not.toBe('old');
  });
});
