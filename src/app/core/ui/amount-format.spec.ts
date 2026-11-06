import { installAmountFormat, withComma } from './amount-format';

describe('金額の欄の桁区切り', () => {
  it('1,000以上の整数にだけカンマを入れる（全角・カンマつきも読む。小数・数字でないもの・空欄はそのまま）', () => {
    expect(withComma('250000')).toBe('250,000');
    expect(withComma('２５００００')).toBe('250,000');
    expect(withComma('1,2345')).toBe('12,345');
    expect(withComma('999')).toBe('999');
    expect(withComma('12.5')).toBe('12.5');
    expect(withComma('abc')).toBe('abc');
    expect(withComma('')).toBe('');
  });

  it('金額の欄（inputmode="numeric"）から離れたらカンマを入れる。年の欄・小数の欄は変えない', () => {
    const remove = installAmountFormat(document);
    const box = document.createElement('div');
    box.innerHTML = '<input inputmode="numeric" name="amount" value="250000" /><input inputmode="numeric" name="year" value="2026" /><input inputmode="decimal" name="hours" value="1000" />';
    document.body.appendChild(box);
    for (const i of box.querySelectorAll('input')) i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect([...box.querySelectorAll('input')].map((i) => i.value)).toEqual(['250,000', '2026', '1000']);
    remove();
    box.remove();
  });
});
