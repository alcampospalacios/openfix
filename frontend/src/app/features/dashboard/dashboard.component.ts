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
    <div class="space-y-6 p-4">
      <div>
        <h2 class="text-2xl font-bold">Dashboard</h2>
        <p class="opacity-60">Monitor your crashes and fixes</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="card bg-base-200">
          <div class="card-body">
            <div class="opacity-60 text-sm">Total Crashes</div>
            <div class="text-3xl font-bold">{{ stats.total }}</div>
          </div>
        </div>
        
        <div class="card bg-base-200 border-l-4 border-warning">
          <div class="card-body">
            <div class="text-warning text-sm">Pending</div>
            <div class="text-3xl font-bold text-warning">{{ stats.pending }}</div>
          </div>
        </div>
        
        <div class="card bg-base-200 border-l-4 border-success">
          <div class="card-body">
            <div class="text-success text-sm">Fixed</div>
            <div class="text-3xl font-bold text-success">{{ stats.fixed }}</div>
          </div>
        </div>
        
        <div class="card bg-base-200 border-l-4 border-error">
          <div class="card-body">
            <div class="text-error text-sm">Failed</div>
            <div class="text-3xl font-bold text-error">{{ stats.failed }}</div>
          </div>
        </div>
      </div>

      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">Recent Activity</h3>
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                @for (crash of crashes; track crash.id) {
                  <tr>
                    <td>
                      @if (crash.status === 'pending') {
                        <span class="badge badge-warning">pending</span>
                      }
                      @if (crash.status === 'fixed') {
                        <span class="badge badge-success">fixed</span>
                      }
                      @if (crash.status === 'failed') {
                        <span class="badge badge-error">failed</span>
                      }
                    </td>
                    <td>{{ crash.title }}</td>
                    <td class="opacity-60">{{ crash.id }}</td>
                  </tr>
                }
                @if (crashes.length === 0) {
                  <tr>
                    <td colspan="3" class="text-center py-8 opacity-60">
                      No crashes yet. Configure your repository to start monitoring.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
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
