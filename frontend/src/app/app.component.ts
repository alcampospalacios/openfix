import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-gray-900">
      <!-- Header -->
      <header class="bg-gray-800 border-b border-gray-700">
        <div class="container mx-auto px-4 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
                <span class="text-white font-bold text-xl">O</span>
              </div>
              <h1 class="text-xl font-bold text-white">Openfix</h1>
            </div>
            
            <nav class="flex space-x-6">
              <a routerLink="/dashboard" 
                 routerLinkActive="text-primary-400 border-b-2 border-primary-400"
                 class="text-gray-300 hover:text-white transition-colors py-2">
                Dashboard
              </a>
              <a routerLink="/crashes" 
                 routerLinkActive="text-primary-400 border-b-2 border-primary-400"
                 class="text-gray-300 hover:text-white transition-colors py-2">
                Crashes
              </a>
              <a routerLink="/config" 
                 routerLinkActive="text-primary-400 border-b-2 border-primary-400"
                 class="text-gray-300 hover:text-white transition-colors py-2">
                Config
              </a>
            </nav>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="container mx-auto px-4 py-8">
        <router-outlet></router-outlet>
      </main>
    </div>
  `
})
export class AppComponent {}
