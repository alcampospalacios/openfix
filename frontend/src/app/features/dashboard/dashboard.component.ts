import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../services/websocket.service';

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
  startedAt: Date;
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

      <!-- Active Pipelines -->
      @if (pipelines.length > 0) {
        <div class="space-y-4">
          <h3 class="text-lg font-semibold">Active Pipelines</h3>
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
                    <span class="font-medium text-sm">{{ pipeline.crashTitle }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs opacity-50">{{ pipeline.crashId }}</span>
                    @if (getPipelineStatus(pipeline) !== 'running') {
                      <button (click)="dismissPipeline(pipeline.crashId)" class="btn btn-ghost btn-xs">&#10005;</button>
                    }
                  </div>
                </div>

                <!-- Steps -->
                <div class="flex items-start gap-0">
                  @for (step of pipeline.steps; track step.id; let i = $index; let last = $last) {
                    <!-- Step node -->
                    <div class="flex flex-col items-center" style="min-width: 100px;">
                      <!-- Circle indicator -->
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
                        @if (step.status === 'running') {
                          <span class="loading loading-spinner loading-xs"></span>
                        }
                        @if (step.status === 'success') {
                          &#10003;
                        }
                        @if (step.status === 'error') {
                          &#10007;
                        }
                        @if (step.status === 'pending') {
                          {{ i + 1 }}
                        }
                      </div>
                      <!-- Label -->
                      <span class="text-xs mt-1 text-center leading-tight"
                            [class.opacity-30]="step.status === 'pending'"
                            [class.text-info]="step.status === 'running'"
                            [class.font-semibold]="step.status === 'running'">
                        {{ step.label }}
                      </span>
                      <!-- Message -->
                      @if (step.message && (step.status === 'running' || step.status === 'error')) {
                        <span class="text-xs mt-0.5 opacity-60 text-center max-w-[120px] truncate">
                          {{ step.message }}
                        </span>
                      }
                    </div>
                    <!-- Connector line -->
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

                <!-- Error message -->
                @if (pipeline.errorMessage) {
                  <div class="mt-3 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">
                    {{ pipeline.errorMessage }}
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

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
export class DashboardComponent implements OnInit, OnDestroy {
  stats: Stats = { total: 0, pending: 0, fixed: 0, failed: 0 };
  crashes: Crash[] = [];
  pipelines: Pipeline[] = [];
  private subs: Subscription[] = [];

  constructor(private http: HttpClient, private ws: WebSocketService) {}

  ngOnInit() {
    this.loadData();

    this.subs.push(
      this.ws.on('new_crash').subscribe((crash: Crash) => {
        this.crashes.unshift(crash);
        this.recalcStats();
      }),
      this.ws.on('crash_updated').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          if (data.status) found.status = data.status;
        }
        this.recalcStats();
      }),
      this.ws.on('crash_enriched').subscribe((data: any) => {
        const found = this.crashes.find(c => c.id === data.crashId);
        if (found) {
          Object.assign(found, { enriched: data.enriched });
        }
      }),
      this.ws.on('crash_progress').subscribe((data: any) => {
        this.handlePipelineProgress(data);
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  loadData() {
    this.http.get<Crash[]>('/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => {
          this.crashes = crashes.slice(-10).reverse();
          this.recalcStatsFromAll(crashes);
        },
        error: () => console.log('Backend not available')
      });
  }

  handlePipelineProgress(data: any) {
    let pipeline = this.pipelines.find(p => p.crashId === data.crashId);

    if (!pipeline) {
      // Create new pipeline from the steps the agent sends
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
        startedAt: new Date(),
      };
      this.pipelines.unshift(pipeline);
    }

    if (data.status === 'error' && data.step === 'error') {
      // Global error — mark the first running step as error, rest stay pending
      pipeline.errorMessage = data.message;
      for (const step of pipeline.steps) {
        if (step.status === 'running') {
          step.status = 'error';
          step.message = data.message;
          break;
        }
      }
      return;
    }

    // Update the specific step
    const step = pipeline.steps.find(s => s.id === data.step);
    if (step) {
      step.status = data.status;
      step.message = data.message;
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

  private recalcStatsFromAll(allCrashes: Crash[]) {
    this.stats.total = allCrashes.length;
    this.stats.pending = allCrashes.filter(c => c.status === 'pending').length;
    this.stats.fixed = allCrashes.filter(c => c.status === 'fixed').length;
    this.stats.failed = allCrashes.filter(c => c.status === 'failed').length;
  }

  private recalcStats() {
    this.stats.total = this.crashes.length;
    this.stats.pending = this.crashes.filter(c => c.status === 'pending').length;
    this.stats.fixed = this.crashes.filter(c => c.status === 'fixed').length;
    this.stats.failed = this.crashes.filter(c => c.status === 'failed').length;
  }
}
