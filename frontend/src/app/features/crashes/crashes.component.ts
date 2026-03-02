import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

interface Crash {
  id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  timestamp: string;
  prUrl?: string;
}

@Component({
  selector: 'app-crashes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6 p-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold">Crashes</h2>
          <p class="text-base-content/60">All reported crashes</p>
        </div>
        <button (click)="refresh()" class="btn btn-primary btn-sm">Refresh</button>
      </div>

      <div class="card bg-base-200">
        <div class="card-body">
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Date</th>
                  <th>PR</th>
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
                    <td>
                      @if (crash.severity === 'ERROR') {
                        <span class="badge badge-error badge-sm">{{ crash.severity }}</span>
                      }
                      @if (crash.severity === 'WARNING') {
                        <span class="badge badge-warning badge-sm">{{ crash.severity }}</span>
                      }
                      @if (crash.severity === 'INFO') {
                        <span class="badge badge-info badge-sm">{{ crash.severity }}</span>
                      }
                    </td>
                    <td class="text-base-content/60">{{ crash.timestamp | date:'short' }}</td>
                    <td>
                      @if (crash.prUrl) {
                        <a [href]="crash.prUrl" target="_blank" class="link link-primary">View PR</a>
                      }
                      @if (!crash.prUrl) {
                        <span class="text-base-content/40">-</span>
                      }
                    </td>
                  </tr>
                }
                @if (crashes.length === 0) {
                  <tr>
                    <td colspan="5" class="text-center py-8 text-base-content/60">
                      No crashes recorded yet
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
export class CrashesComponent implements OnInit {
  crashes: Crash[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadCrashes();
  }

  loadCrashes() {
    this.http.get<Crash[]>('http://localhost:3000/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => this.crashes = crashes.reverse(),
        error: () => console.log('Backend not available')
      });
  }

  refresh() {
    this.loadCrashes();
  }
}
