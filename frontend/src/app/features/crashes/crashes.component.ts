import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../services/websocket.service';

interface Crash {
  id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  timestamp: string;
  prUrl?: string;
  exception_class?: string;
  app_package?: string;
  platform?: string;
  version?: string;
  stacktrace?: string;
  device?: string;
  os_version?: string;
  enriched?: boolean;
  blame_file?: string;
  blame_symbol?: string;
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
          <p class="opacity-60">All reported crashes</p>
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
                  <th>Platform</th>
                  <th>Version</th>
                  <th>Severity</th>
                  <th>Date</th>
                  <th>PR</th>
                </tr>
              </thead>
              <tbody>
                @for (crash of crashes; track crash.id) {
                  <tr class="cursor-pointer hover" (click)="toggleCrash(crash)">
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
                      @if (crash.enriched) {
                        <span class="badge badge-info badge-sm ml-1">enriched</span>
                      }
                    </td>
                    <td>{{ crash.title }}</td>
                    <td>{{ crash.platform || '-' }}</td>
                    <td>{{ crash.version || '-' }}</td>
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
                    <td class="opacity-60">{{ crash.timestamp | date:'short' }}</td>
                    <td>
                      @if (crash.prUrl) {
                        <a [href]="crash.prUrl" target="_blank" class="link link-primary" (click)="$event.stopPropagation()">View PR</a>
                      }
                      @if (!crash.prUrl) {
                        <span class="opacity-40">-</span>
                      }
                    </td>
                  </tr>
                  @if (selectedCrash?.id === crash.id) {
                    <tr>
                      <td colspan="7">
                        <div class="p-4 bg-base-300 rounded-lg space-y-3">
                          @if (crash.app_package) {
                            <div><span class="font-semibold">App:</span> {{ crash.app_package }}</div>
                          }
                          @if (crash.device) {
                            <div><span class="font-semibold">Device:</span> {{ crash.device }}</div>
                          }
                          @if (crash.os_version) {
                            <div><span class="font-semibold">OS Version:</span> {{ crash.os_version }}</div>
                          }
                          @if (crash.blame_file) {
                            <div><span class="font-semibold">Blame:</span> {{ crash.blame_symbol }} ({{ crash.blame_file }})</div>
                          }
                          @if (crash.stacktrace) {
                            <div>
                              <span class="font-semibold">Stacktrace:</span>
                              <pre class="mt-2 p-3 bg-base-100 rounded text-sm overflow-x-auto max-h-96">{{ crash.stacktrace }}</pre>
                            </div>
                          }
                          @if (!crash.enriched) {
                            <div class="opacity-50 text-sm italic">
                              Detailed crash data not available. BigQuery enrichment pending or not configured.
                            </div>
                          }
                          @if (crash.description && !crash.stacktrace) {
                            <div>
                              <span class="font-semibold">Description:</span>
                              <pre class="mt-2 p-3 bg-base-100 rounded text-sm overflow-x-auto max-h-96">{{ crash.description }}</pre>
                            </div>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
                @if (crashes.length === 0) {
                  <tr>
                    <td colspan="7" class="text-center py-8 opacity-60">
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
export class CrashesComponent implements OnInit, OnDestroy {
  crashes: Crash[] = [];
  selectedCrash: Crash | null = null;
  private subs: Subscription[] = [];

  constructor(private http: HttpClient, private ws: WebSocketService) {}

  ngOnInit() {
    this.loadCrashes();

    this.subs.push(
      this.ws.on('new_crash').subscribe((crash: Crash) => {
        this.crashes.unshift(crash);
      }),
      this.ws.on('crash_updated').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          if (data.status) found.status = data.status;
          if (data.prUrl) found.prUrl = data.prUrl;
        }
      }),
      this.ws.on('crash_enriched').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          found.stacktrace = data.stacktrace;
          found.device = data.device;
          found.os_version = data.os_version;
          found.blame_file = data.blame_file;
          found.blame_symbol = data.blame_symbol;
          found.enriched = data.enriched;
        }
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  loadCrashes() {
    this.http.get<Crash[]>('/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => this.crashes = crashes.reverse(),
        error: () => console.log('Backend not available')
      });
  }

  refresh() {
    this.loadCrashes();
  }

  toggleCrash(crash: Crash) {
    this.selectedCrash = this.selectedCrash?.id === crash.id ? null : crash;
  }
}
