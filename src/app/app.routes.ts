import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin-guard';
import { authGuard } from './core/auth/auth-guard';
import { unsavedChangesGuard } from './core/ui/unsaved-guard';

// title：ブラウザのタブ・履歴に出す画面の名前（AppTitleStrategy が「｜社会保険管理システム」を添える）
export const routes: Routes = [
  {
    path: '',
    title: '要確認',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'login',
    title: 'ログイン',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'monthly',
    title: '月次保険料一覧',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/monthly/monthly-list/monthly-list').then((m) => m.MonthlyList),
  },
  {
    path: 'employees',
    title: '従業員一覧',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./pages/employees/employee-list/employee-list').then((m) => m.EmployeeList),
  },
  {
    path: 'employees/:id',
    title: '従業員の詳細',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./pages/employees/employee-detail/employee-detail').then((m) => m.EmployeeDetail),
  },
  {
    path: 'bonuses',
    title: '賞与',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/bonuses/bonus-list').then((m) => m.BonusList),
  },
  {
    path: 'salaries',
    title: '給与',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/salaries/salary-list').then((m) => m.SalaryList),
  },
  {
    path: 'salaries/import',
    title: '給与のCSV取り込み',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/salaries/salary-import').then((m) => m.SalaryImport),
  },
  {
    path: 'revisions',
    title: '随時改定',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/revisions/revision-list').then((m) => m.RevisionList),
  },
  {
    path: 'decisions/import',
    title: '決定通知書の取り込み',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/decisions/decision-import').then((m) => m.DecisionImport),
  },
  {
    path: 'regular',
    title: '定時決定',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/regular/regular-list').then((m) => m.RegularList),
  },
  {
    path: 'adjustments',
    title: '差額',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/adjustments/adjustment-list').then((m) => m.AdjustmentList),
  },
  {
    path: 'filings',
    title: '届出の期限',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/filings/filing-list').then((m) => m.FilingList),
  },
  {
    path: 'reconcile',
    title: '照合',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/reconcile/reconcile-page').then((m) => m.ReconcilePage),
  },
  {
    path: 'totals',
    title: '集計',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/totals/period-totals').then((m) => m.PeriodTotals),
  },
  {
    path: 'imports',
    title: 'CSV取り込み',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/imports/master-import-page').then((m) => m.MasterImportPage),
  },
  {
    path: 'settings/accounts',
    title: 'アカウントと権限',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/accounts/account-list').then((m) => m.AccountList),
  },
  {
    path: 'settings',
    title: '設定',
    canActivate: [adminGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
