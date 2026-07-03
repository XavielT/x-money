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
  { path: '**', redirectTo: '' },
];
