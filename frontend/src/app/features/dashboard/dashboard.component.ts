import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

interface Crash {
  id: string;
  title: string;
  status: string;
  severity: string;
}

interface Stats {
  total: number;
  pending: number;
  fixed: number;
  failed: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-2xl font-bold text-white">Dashboard</h2>
        <p class="text-gray-400">Monitor your crashes and fixes</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-gray-400 text-sm">Total Crashes</div>
          <div class="text-3xl font-bold text-white mt-2">{{ stats.total }}</div>
        </div>
        
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-yellow-400 text-sm">Pending</div>
          <div class="text-3xl font-bold text-yellow-400 mt-2">{{ stats.pending }}</div>
        </div>
        
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-green-400 text-sm">Fixed</div>
          <div class="text-3xl font-bold text-green-400 mt-2">{{ stats.fixed }}</div>
        </div>
        
        <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div class="text-red-400 text-sm">Failed</div>
          <div class="text-3xl font-bold text-red-400 mt-2">{{ stats.failed }}</div>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="px-6 py-4 border-b border-gray-700">
          <h3 class="text-lg font-semibold text-white">Recent Activity</h3>
        </div>
        
        <div class="divide-y divide-gray-700">
          @for (crash of crashes; track crash.id) {
            <div class="px-6 py-4 flex items-center justify-between">
              <div class="flex items-center space-x-4">
                <div class="w-2 h-2 rounded-full" 
                     [class.bg-yellow-400]="crash.status === 'pending'"
                     [class.bg-green-400]="crash.status === 'fixed'"
                     [class.bg-red-400]="crash.status === 'failed'"></div>
                <div>
                  <div class="text-white">{{ crash.title }}</div>
                  <div class="text-gray-500 text-sm">{{ crash.id }}</div>
                </div>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-medium"
                    [class.bg-yellow-400/20]="crash.status === 'pending'"
                    [class.text-yellow-400]="crash.status === 'pending'"
                    [class.bg-green-400/20]="crash.status === 'fixed'"
                    [class.text-green-400]="crash.status === 'fixed'"
                    [class.bg-red-400/20]="crash.status === 'failed'"
                    [class.text-red-400]="crash.status === 'failed'">
                {{ crash.status }}
              </span>
            </div>
          }
          
          @if (crashes.length === 0) {
            <div class="px-6 py-8 text-center text-gray-500">
              No crashes yet. Configure your repository to start monitoring.
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class DashboardComponent implements OnInit {
  stats: Stats = { total: 0, pending: 0, fixed: 0, failed: 0 };
  crashes: Crash[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.http.get<Crash[]>('http://localhost:3000/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => {
          this.crashes = crashes.slice(-10).reverse();
          this.stats.total = crashes.length;
          this.stats.pending = crashes.filter((c: Crash) => c.status === 'pending').length;
          this.stats.fixed = crashes.filter((c: Crash) => c.status === 'fixed').length;
          this.stats.failed = crashes.filter((c: Crash) => c.status === 'failed').length;
        },
        error: () => console.log('Backend not available')
      });
  }
}
