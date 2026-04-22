import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { DashboardLayoutComponent } from './shared/layouts/dashboard-layout/dashboard-layout.component';
import { DashboardComponent } from './features/dashboard/main/dashboard.component';
import { SystemPressureComponent } from './features/dashboard/system-pressure/system-pressure.component';
import { FtoListComponent } from './features/bills/fto-list/fto-list.component';
import { BillListComponent } from './features/bills/bill-list/bill-list.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'auth/login', component: LoginComponent },
  {
    path: '',
    component: DashboardLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'system-pressure', component: SystemPressureComponent },
      { path: 'bills/fto-list', component: FtoListComponent },
      { path: 'bills/bill-list', component: BillListComponent },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  { path: '**', redirectTo: 'auth/login' }
];
