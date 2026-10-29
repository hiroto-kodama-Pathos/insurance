import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin-guard';
import { authGuard } from './core/auth/auth-guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'monthly',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/monthly/monthly-list/monthly-list').then((m) => m.MonthlyList),
  },
  {
    path: 'employees',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/employees/employee-list/employee-list').then((m) => m.EmployeeList),
  },
  {
    path: 'employees/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/employees/employee-detail/employee-detail').then((m) => m.EmployeeDetail),
  },
  {
    path: 'bonuses',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/bonuses/bonus-list').then((m) => m.BonusList),
  },
  {
    path: 'salaries',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/salaries/salary-list').then((m) => m.SalaryList),
  },
  {
    path: 'salaries/import',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/salaries/salary-import').then((m) => m.SalaryImport),
  },
  {
    path: 'revisions',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/revisions/revision-list').then((m) => m.RevisionList),
  },
  {
    path: 'regular',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/regular/regular-list').then((m) => m.RegularList),
  },
  {
    path: 'adjustments',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/adjustments/adjustment-list').then((m) => m.AdjustmentList),
  },
  {
    path: 'settings',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
