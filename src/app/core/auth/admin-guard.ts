// 管理者（siRole: 'admin'）だけを通す。設定画面に使う
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.isAdmin()) return true;
  return router.createUrlTree(auth.canUse() ? ['/'] : ['/login']);
};
