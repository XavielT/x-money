import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home';
import { TransactionsComponent } from './pages/transactions/transactions';
import { TransactionFormComponent } from './pages/transaction-form/transaction-form';
import { StatsComponent } from './pages/stats/stats';
import { BudgetsComponent } from './pages/budgets/budgets';
import { SettingsComponent } from './pages/settings/settings';
import { AccountsComponent } from './pages/accounts/accounts';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'transactions', component: TransactionsComponent },
  { path: 'add', component: TransactionFormComponent },
  { path: 'edit/:id', component: TransactionFormComponent },
  { path: 'stats', component: StatsComponent },
  { path: 'budgets', component: BudgetsComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'accounts', component: AccountsComponent },
  { path: 'reconcile/:id', loadComponent: () => import('./pages/reconcile/reconcile').then((m) => m.ReconcileComponent) },
  // heavier pages load on demand to keep the first screen light
  { path: 'income', loadComponent: () => import('./pages/income/income').then((m) => m.IncomeComponent) },
  { path: 'benefits', loadComponent: () => import('./pages/benefits/benefits').then((m) => m.BenefitsComponent) },
  { path: 'card/:id', loadComponent: () => import('./pages/card/card').then((m) => m.CardComponent) },
  { path: 'card/:id/pay', loadComponent: () => import('./pages/card-pay/card-pay').then((m) => m.CardPayComponent) },
  { path: '**', redirectTo: '' },
];
