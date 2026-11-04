import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home';
import { TransactionsComponent } from './pages/transactions/transactions';
import { TransactionFormComponent } from './pages/transaction-form/transaction-form';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'transactions', component: TransactionsComponent },
  { path: 'add', component: TransactionFormComponent },
  { path: 'edit/:id', component: TransactionFormComponent },
  // secondary screens load on demand (the service worker prefetches them, so they still work offline)
  { path: 'stats', loadComponent: () => import('./pages/stats/stats').then((m) => m.StatsComponent) },
  { path: 'budgets', loadComponent: () => import('./pages/budgets/budgets').then((m) => m.BudgetsComponent) },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsComponent) },
  { path: 'accounts', loadComponent: () => import('./pages/accounts/accounts').then((m) => m.AccountsComponent) },
  { path: 'reconcile/:id', loadComponent: () => import('./pages/reconcile/reconcile').then((m) => m.ReconcileComponent) },
  // heavier pages load on demand to keep the first screen light
  { path: 'business', loadComponent: () => import('./pages/business/business').then((m) => m.BusinessComponent) },
  { path: 'goals', loadComponent: () => import('./pages/goals/goals').then((m) => m.GoalsComponent) },
  { path: 'analysis', loadComponent: () => import('./pages/analysis/analysis').then((m) => m.AnalysisComponent) },
  { path: 'budgets/plan', loadComponent: () => import('./pages/budget-plan/budget-plan').then((m) => m.BudgetPlanComponent) },
  { path: 'fixed', loadComponent: () => import('./pages/fixed-expenses/fixed-expenses').then((m) => m.FixedExpensesComponent) },
  { path: 'income', loadComponent: () => import('./pages/income/income').then((m) => m.IncomeComponent) },
  { path: 'benefits', loadComponent: () => import('./pages/benefits/benefits').then((m) => m.BenefitsComponent) },
  { path: 'card/:id', loadComponent: () => import('./pages/card/card').then((m) => m.CardComponent) },
  { path: 'card/:id/pay', loadComponent: () => import('./pages/card-pay/card-pay').then((m) => m.CardPayComponent) },
  { path: '**', redirectTo: '' },
];
