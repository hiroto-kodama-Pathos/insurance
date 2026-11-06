import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Auth } from '../auth/auth';
import { EmployeeRepository } from './employee-repository';

describe('EmployeeRepository', () => {
  it('should be created', () => {
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: { user: signal(null) } }] });
    expect(TestBed.inject(EmployeeRepository)).toBeTruthy();
  });
});

describe('EmployeeRepository.withLog（変更と、その変更の記録）', () => {
  let repo: EmployeeRepository;
  let written: string[];
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: { user: signal({ uid: 'u1', email: 'a@example.com' }) } }] });
    repo = TestBed.inject(EmployeeRepository);
    written = [];
  });

  it('変更が従業員の書き込みを使わなかったときは、変更のあとに記録だけを書く。書けなければ false（変更はそのまま）', async () => {
    const r = repo as unknown as { addChangeLog(id: string, t: string): Promise<void> };
    r.addChangeLog = async (_id, t) => { written.push(t); };
    expect(await repo.withLog('e1', '還付の状態を変えた', async () => undefined)).toBe(true);
    expect(written).toEqual(['還付の状態を変えた']);
    r.addChangeLog = async () => { throw new Error('unavailable'); };
    expect(await repo.withLog('e1', '還付の状態を変えた', async () => undefined)).toBe(false);
  });

  it('変更が失敗したら記録は書かず、エラーをそのまま返す（次の書き込みに記録が紛れ込まない）', async () => {
    const r = repo as unknown as { addChangeLog(id: string, t: string): Promise<void>; pendingLog: unknown };
    r.addChangeLog = async (_id, t) => { written.push(t); };
    await expect(repo.withLog('e1', '直した', async () => { throw new Error('permission-denied'); })).rejects.toThrow('permission-denied');
    expect(written).toEqual([]);
    expect(r.pendingLog).toBeNull();
  });
});
