import { signal } from '@angular/core';
import { Auth } from '../auth/auth';
import { employeeScopeWhere, scopedOffice, scopeWhere } from './scope';

const authOf = (siScope: string | null) => ({ user: signal({ uid: 'u', email: '', siRole: 'staff', siScope }) }) as unknown as Auth;

describe('担当範囲でのクエリの絞り込み', () => {
  it('全担当（と担当範囲のない古いアカウント）は絞り込まない', () => {
    expect(scopedOffice(authOf('all'))).toBeNull();
    expect(scopedOffice(authOf(null))).toBeNull();
    expect(scopeWhere(authOf('all'))).toEqual([]);
    expect(employeeScopeWhere(authOf('all'))).toEqual([]);
  });

  it('特定の事業所の担当者は、その事業所で絞り込む', () => {
    expect(scopedOffice(authOf('osaka'))).toBe('osaka');
    expect(scopeWhere(authOf('osaka'))).toHaveLength(1);
    expect(employeeScopeWhere(authOf('osaka'))).toHaveLength(1);
  });
});
