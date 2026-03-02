import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'crashes',
    loadComponent: () => import('./features/crashes/crashes.component').then(m => m.CrashesComponent)
  },
  {
    path: 'config',
    loadComponent: () => import('./features/config/config.component').then(m => m.ConfigComponent)
  }
];
