// ログインしていて、第三課題の権限（siRole）がある人だけを通す
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.canUse()) return true;
  return router.createUrlTree(['/login'], {
    queryParams: auth.user() ? { denied: 1 } : { returnUrl: state.url },
  });
};
