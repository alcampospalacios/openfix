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

interface SyncStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
}

interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
}

interface Pipeline {
  crashId: string;
  crashTitle: string;
  steps: PipelineStep[];
  errorMessage?: string;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
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
        <div class="flex gap-2">
          <button (click)="refresh()" class="btn btn-primary btn-sm">Refresh</button>
          <button (click)="syncBigQuery()" class="btn btn-secondary btn-sm" [disabled]="syncing">
            @if (syncing) {
              <span class="loading loading-spinner loading-xs"></span>
              Syncing...
            } @else {
              Sync BigQuery
            }
          </button>
        </div>
      </div>

      <!-- Sync BQ Pipeline -->
      @if (showSyncPipeline) {
        <div class="card bg-base-200">
          <div class="card-body p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                @if (syncPipelineRunning) {
                  <span class="loading loading-spinner loading-sm text-info"></span>
                }
                @if (syncPipelineDone && !syncPipelineError) {
                  <span class="text-success text-lg">&#10003;</span>
                }
                @if (syncPipelineError) {
                  <span class="text-error text-lg">&#10007;</span>
                }
                <span class="font-medium text-sm">BigQuery Sync</span>
              </div>
              @if (!syncPipelineRunning) {
                <button (click)="dismissSyncPipeline()" class="btn btn-ghost btn-xs">&#10005;</button>
              }
            </div>
            <div class="flex items-start gap-0">
              @for (step of syncSteps; track step.id; let last = $last; let i = $index) {
                <div class="flex flex-col items-center" style="min-width: 110px;">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300"
                       [class.border-base-content]="step.status === 'pending'"
                       [class.opacity-30]="step.status === 'pending'"
                       [class.border-info]="step.status === 'running'"
                       [class.bg-info]="step.status === 'running'"
                       [class.text-info-content]="step.status === 'running'"
                       [class.border-success]="step.status === 'success'"
                       [class.bg-success]="step.status === 'success'"
                       [class.text-success-content]="step.status === 'success'"
                       [class.border-error]="step.status === 'error'"
                       [class.bg-error]="step.status === 'error'"
                       [class.text-error-content]="step.status === 'error'">
                    @if (step.status === 'running') { <span class="loading loading-spinner loading-xs"></span> }
                    @if (step.status === 'success') { &#10003; }
                    @if (step.status === 'error') { &#10007; }
                    @if (step.status === 'pending') { {{ i + 1 }} }
                  </div>
                  <span class="text-xs mt-1 text-center leading-tight"
                        [class.opacity-30]="step.status === 'pending'"
                        [class.text-info]="step.status === 'running'"
                        [class.font-semibold]="step.status === 'running'">
                    {{ step.label }}
                  </span>
                  @if (step.message && step.status !== 'pending') {
                    <span class="text-xs mt-0.5 opacity-60 text-center max-w-[140px] truncate">{{ step.message }}</span>
                  }
                </div>
                @if (!last) {
                  <div class="flex-1 h-0.5 mt-4 min-w-[20px] transition-all duration-300"
                       [class.bg-success]="step.status === 'success'"
                       [class.bg-info]="step.status === 'running'"
                       [class.bg-base-content]="step.status === 'pending' || step.status === 'error'"
                       [class.opacity-20]="step.status === 'pending'">
                  </div>
                }
              }
            </div>
          </div>
        </div>
      }

      <!-- Agent Processing Pipelines -->
      @for (pipeline of pipelines; track pipeline.crashId) {
        <div class="card bg-base-200">
          <div class="card-body p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                @if (getPipelineStatus(pipeline) === 'running') {
                  <span class="loading loading-spinner loading-sm text-info"></span>
                }
                @if (getPipelineStatus(pipeline) === 'success') {
                  <span class="text-success text-lg">&#10003;</span>
                }
                @if (getPipelineStatus(pipeline) === 'error') {
                  <span class="text-error text-lg">&#10007;</span>
                }
                <span class="font-medium text-sm truncate max-w-[300px]">{{ pipeline.crashTitle }}</span>
                <span class="text-xs opacity-40">{{ pipeline.crashId }}</span>
              </div>
              @if (getPipelineStatus(pipeline) !== 'running') {
                <button (click)="dismissPipeline(pipeline.crashId)" class="btn btn-ghost btn-xs">&#10005;</button>
              }
            </div>
            <div class="flex items-start gap-0">
              @for (step of pipeline.steps; track step.id; let last = $last; let i = $index) {
                <div class="flex flex-col items-center" style="min-width: 100px;">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300"
                       [class.border-base-content]="step.status === 'pending'"
                       [class.opacity-30]="step.status === 'pending'"
                       [class.border-info]="step.status === 'running'"
                       [class.bg-info]="step.status === 'running'"
                       [class.text-info-content]="step.status === 'running'"
                       [class.border-success]="step.status === 'success'"
                       [class.bg-success]="step.status === 'success'"
                       [class.text-success-content]="step.status === 'success'"
                       [class.border-error]="step.status === 'error'"
                       [class.bg-error]="step.status === 'error'"
                       [class.text-error-content]="step.status === 'error'">
                    @if (step.status === 'running') { <span class="loading loading-spinner loading-xs"></span> }
                    @if (step.status === 'success') { &#10003; }
                    @if (step.status === 'error') { &#10007; }
                    @if (step.status === 'pending') { {{ i + 1 }} }
                  </div>
                  <span class="text-xs mt-1 text-center leading-tight"
                        [class.opacity-30]="step.status === 'pending'"
                        [class.text-info]="step.status === 'running'"
                        [class.font-semibold]="step.status === 'running'">
                    {{ step.label }}
                  </span>
                  @if (step.message && step.status !== 'pending') {
                    <span class="text-xs mt-0.5 opacity-60 text-center max-w-[120px] truncate">{{ step.message }}</span>
                  }
                </div>
                @if (!last) {
                  <div class="flex-1 h-0.5 mt-4 min-w-[20px] transition-all duration-300"
                       [class.bg-success]="step.status === 'success'"
                       [class.bg-info]="step.status === 'running'"
                       [class.bg-base-content]="step.status === 'pending' || step.status === 'error'"
                       [class.opacity-20]="step.status === 'pending'">
                  </div>
                }
              }
            </div>
            @if (pipeline.errorMessage) {
              <div class="mt-3 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">{{ pipeline.errorMessage }}</div>
            }
          </div>
        </div>
      }

      <!-- Crashes Table -->
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (crash of crashes; track crash.id) {
                  <tr class="cursor-pointer hover" (click)="toggleCrash(crash)">
                    <td>
                      @if (crash.status === 'pending') {
                        <span class="badge badge-warning">pending</span>
                      }
                      @if (crash.status === 'processing') {
                        <span class="badge badge-info gap-1">
                          <span class="loading loading-spinner loading-xs"></span>
                          processing
                        </span>
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
                    <td>
                      @if (crash.status === 'pending' || crash.status === 'failed') {
                        <button (click)="processCrash(crash, $event)"
                                [disabled]="processingId === crash.id"
                                class="btn btn-outline btn-primary btn-xs">
                          @if (processingId === crash.id) {
                            <span class="loading loading-spinner loading-xs"></span>
                          } @else {
                            Process
                          }
                        </button>
                      }
                    </td>
                  </tr>
                  @if (selectedCrash?.id === crash.id) {
                    <tr>
                      <td colspan="8">
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
                    <td colspan="8" class="text-center py-8 opacity-60">
                      No crashes recorded yet
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Logs Panel (always visible) -->
      <div class="card bg-base-200">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <h3 class="card-title text-sm">Logs</h3>
            <button (click)="clearLogs()" class="btn btn-ghost btn-xs">Clear</button>
          </div>
          <div class="bg-base-300 rounded p-2 h-40 overflow-y-auto font-mono text-xs space-y-1">
            @for (log of logs; track log.time) {
              <div>
                <span class="opacity-50">{{ log.time }}</span>
                <span [class.text-success]="log.type === 'success'"
                      [class.text-error]="log.type === 'error'"
                      [class.text-info]="log.type === 'info'"> {{ log.message }}</span>
              </div>
            }
            @if (logs.length === 0) {
              <div class="opacity-50">No activity yet.</div>
            }
          </div>
        </div>
      </div>

      @if (toastMessage) {
        <div class="toast toast-end">
          <div [class]="toastError ? 'alert alert-error' : 'alert alert-success'">
            <span>{{ toastMessage }}</span>
          </div>
        </div>
      }
    </div>
  `
})
export class CrashesComponent implements OnInit, OnDestroy {
  crashes: Crash[] = [];
  selectedCrash: Crash | null = null;
  syncing = false;
  processingId = '';
  logs: LogEntry[] = [];
  toastMessage = '';
  toastError = false;
  private subs: Subscription[] = [];

  // Sync BQ pipeline
  showSyncPipeline = false;
  syncPipelineRunning = false;
  syncPipelineDone = false;
  syncPipelineError = false;
  syncSteps: SyncStep[] = [];

  // Agent processing pipelines (per crash)
  pipelines: Pipeline[] = [];

  constructor(private http: HttpClient, private ws: WebSocketService) {}

  private initSyncSteps(): SyncStep[] {
    return [
      { id: 'connect',  label: 'Connect BQ',     status: 'pending' },
      { id: 'discover', label: 'Discover Tables', status: 'pending' },
      { id: 'fetch',    label: 'Fetch Crashes',   status: 'pending' },
      { id: 'enrich',   label: 'Enrich',          status: 'pending' },
    ];
  }

  ngOnInit() {
    this.loadCrashes();
    this.checkSyncStatus();

    this.subs.push(
      this.ws.on('new_crash').subscribe((crash: Crash) => {
        if (!this.crashes.find(c => c.id === crash.id)) {
          this.crashes.unshift(crash);
        }
        this.addLog(`New crash: ${crash.title}`, 'info');
      }),
      this.ws.on('crash_updated').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          if (data.status) found.status = data.status;
          if (data.prUrl) found.prUrl = data.prUrl;
        }
        this.addLog(`Crash ${data.crashId}: status=${data.status || '-'}`, 'info');
      }),
      this.ws.on('crash_enriched').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          found.stacktrace = data.stacktrace;
          found.device = data.device;
          found.os_version = data.os_version;
          found.blame_file = data.blame_file;
          found.blame_symbol = data.blame_symbol;
          found.enriched = true;
        }
        this.addLog(`Enriched: ${data.crashId}`, 'success');
      }),

      // Agent processing pipeline (crash_progress from agent)
      this.ws.on('crash_progress').subscribe((data: any) => {
        this.handleCrashProgress(data);
      }),

      // Sync BQ pipeline events
      this.ws.on('bq_sync_started').subscribe(() => {
        this.setSyncStep('connect', 'running', 'Connecting...');
        this.addLog('Connecting to BigQuery...', 'info');
      }),
      this.ws.on('bq_sync_log').subscribe((data: any) => {
        this.addLog(data.message, 'info');
        const msg = data.message as string;
        if (msg.includes('Discovering tables') || msg.includes('Using app')) {
          this.setSyncStep('connect', 'success');
          this.setSyncStep('discover', 'running', msg.includes('Discovering') ? 'Scanning...' : undefined);
        }
        if (msg.includes('Found') && msg.includes('table')) {
          this.setSyncStep('discover', 'success', msg);
        }
        if (msg.includes('Querying')) {
          this.setSyncStep('discover', 'success');
          this.setSyncStep('fetch', 'running', 'Querying...');
        }
        if (msg.includes('issue(s)')) {
          this.setSyncStep('fetch', 'running', msg);
        }
      }),
      this.ws.on('bq_sync_fetched').subscribe((data: any) => {
        const msg = `${data.total_found} found, ${data.new_inserted} new`;
        this.setSyncStep('fetch', 'success', msg);
        this.addLog(`BigQuery: ${msg}`, 'info');
        if (data.total_found === 0 && data.new_inserted === 0) {
          this.setSyncStep('enrich', 'success', 'Nothing to enrich');
          this.finishSyncPipeline(false);
        }
      }),
      this.ws.on('enrich_queue_progress').subscribe((data: any) => {
        const msg = `${data.completed}/${data.total}`;
        this.setSyncStep('enrich', 'running', msg);
        this.addLog(`Enriching ${data.current_crash_id} (${msg})`, 'info');
      }),
      this.ws.on('enrich_queue_done').subscribe((data: any) => {
        this.setSyncStep('enrich', 'success', `${data.completed}/${data.total} done`);
        this.addLog(`Sync complete. ${data.completed}/${data.total} enriched.`, 'success');
        this.finishSyncPipeline(false);
        this.loadCrashes();
      }),
      this.ws.on('bq_sync_error').subscribe((data: any) => {
        this.addLog(data.error, 'error');
        const running = this.syncSteps.find(s => s.status === 'running');
        if (running) {
          running.status = 'error';
          running.message = data.error;
        }
        this.finishSyncPipeline(true);
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  // ── Crash progress pipeline (same as Dashboard) ─────────────────────────

  handleCrashProgress(data: any) {
    let pipeline = this.pipelines.find(p => p.crashId === data.crashId);

    if (!pipeline) {
      const crashInList = this.crashes.find(c => c.id === data.crashId);
      const steps: PipelineStep[] = (data.steps || []).map((s: any) => ({
        id: s.id,
        label: s.label,
        status: 'pending' as const,
      }));
      pipeline = {
        crashId: data.crashId,
        crashTitle: crashInList?.title || data.crashId,
        steps,
      };
      this.pipelines.unshift(pipeline);
      this.addLog(`Agent processing: ${pipeline.crashTitle}`, 'info');

      // Update crash status in table
      if (crashInList) crashInList.status = 'processing';
    }

    if (data.status === 'error' && data.step === 'error') {
      pipeline.errorMessage = data.message;
      for (const step of pipeline.steps) {
        if (step.status === 'running') {
          step.status = 'error';
          step.message = data.message;
          break;
        }
      }
      this.addLog(`Agent error on ${pipeline.crashTitle}: ${data.message}`, 'error');
      return;
    }

    const step = pipeline.steps.find(s => s.id === data.step);
    if (step) {
      step.status = data.status;
      step.message = data.message;
      if (data.status === 'running') {
        this.addLog(`${pipeline.crashTitle}: ${step.label}...`, 'info');
      }
      if (data.status === 'success') {
        this.addLog(`${pipeline.crashTitle}: ${step.label} done`, 'success');
      }
    }
  }

  getPipelineStatus(pipeline: Pipeline): string {
    if (pipeline.errorMessage) return 'error';
    if (pipeline.steps.some(s => s.status === 'running')) return 'running';
    if (pipeline.steps.every(s => s.status === 'success')) return 'success';
    return 'running';
  }

  dismissPipeline(crashId: string) {
    this.pipelines = this.pipelines.filter(p => p.crashId !== crashId);
  }

  // ── Sync BQ pipeline ────────────────────────────────────────────────────

  private setSyncStep(stepId: string, status: SyncStep['status'], message?: string) {
    const step = this.syncSteps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (message !== undefined) step.message = message;
    }
  }

  private finishSyncPipeline(isError: boolean) {
    this.syncing = false;
    this.syncPipelineRunning = false;
    this.syncPipelineDone = true;
    this.syncPipelineError = isError;
  }

  dismissSyncPipeline() {
    this.showSyncPipeline = false;
    this.syncPipelineDone = false;
    this.syncPipelineError = false;
  }

  // ── Logs ────────────────────────────────────────────────────────────────

  addLog(message: string, type: 'info' | 'success' | 'error' = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift({ time, message, type });
    if (this.logs.length > 100) this.logs.pop();
  }

  clearLogs() {
    this.logs = [];
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  checkSyncStatus() {
    this.http.get<any>('/api/crashes/sync-bq/status').subscribe({
      next: (res) => {
        if (res.running) {
          this.syncing = true;
          this.showSyncPipeline = true;
          this.syncPipelineRunning = true;
          this.syncSteps = this.initSyncSteps();
          this.setSyncStep('connect', 'success');
          this.setSyncStep('discover', 'running', 'In progress...');
          this.addLog('Sync already running (recovered state)', 'info');
        }
      },
      error: () => {}
    });
  }

  loadCrashes() {
    this.http.get<Crash[]>('/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => this.crashes = crashes.reverse(),
        error: () => this.addLog('Backend not available', 'error')
      });
  }

  refresh() {
    this.loadCrashes();
  }

  syncBigQuery() {
    if (this.syncing) return;
    this.syncing = true;
    this.showSyncPipeline = true;
    this.syncPipelineRunning = true;
    this.syncPipelineDone = false;
    this.syncPipelineError = false;
    this.syncSteps = this.initSyncSteps();
    this.addLog('POST /api/crashes/sync-bq', 'info');

    this.http.post<any>('/api/crashes/sync-bq', {})
      .subscribe({
        next: (res) => {
          this.addLog(`Response: ${res.status}`, 'info');
          if (res.status === 'already_running') {
            this.addLog('Sync already in progress', 'info');
          }
        },
        error: (err) => {
          const detail = err.error?.detail || err.message || 'Unknown error';
          this.addLog(`Error: ${detail}`, 'error');
          this.setSyncStep('connect', 'error', detail);
          this.finishSyncPipeline(true);
        }
      });
  }

  processCrash(crash: Crash, event: Event) {
    event.stopPropagation();
    this.processingId = crash.id;
    this.http.post<any>(`/api/crashes/${crash.id}/process`, {})
      .subscribe({
        next: () => {
          this.processingId = '';
          crash.status = 'processing';
          this.addLog(`Sent to agent: ${crash.title}`, 'success');
          this.showToast('Sent to agent for processing');
        },
        error: (err) => {
          this.processingId = '';
          const detail = err.error?.detail || err.message || 'Unknown error';
          this.addLog(`Error: ${detail}`, 'error');
          this.showToast(detail, true);
        }
      });
  }

  showToast(msg: string, isError = false) {
    this.toastMessage = msg;
    this.toastError = isError;
    setTimeout(() => this.toastMessage = '', 4000);
  }

  toggleCrash(crash: Crash) {
    this.selectedCrash = this.selectedCrash?.id === crash.id ? null : crash;
  }
}
