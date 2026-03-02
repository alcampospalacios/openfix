import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-base-100">
      <!-- Navbar -->
      <div class="navbar bg-base-200">
        <div class="flex-1">
          <a class="btn btn-ghost text-xl">🤖 Openfix</a>
        </div>
        <div class="flex-none">
          <ul class="menu menu-horizontal px-1">
            <li><a routerLink="/dashboard" routerLinkActive="text-primary">Dashboard</a></li>
            <li><a routerLink="/crashes" routerLinkActive="text-primary">Crashes</a></li>
            <li><a routerLink="/config" routerLinkActive="text-primary">Config</a></li>
          </ul>
        </div>
      </div>

      <!-- Main Content -->
      <main class="container mx-auto py-8">
        <router-outlet></router-outlet>
      </main>
    </div>
  `
})
export class AppComponent {}
