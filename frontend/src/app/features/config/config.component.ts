import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface Model {
  id: string;
  name: string;
  provider: string;
}

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-2xl font-bold">Configuration</h2>
        <p class="opacity-60">Configure your repositories, AI model, and Firebase projects</p>
      </div>

      <!-- Agent Status -->
      <div class="card bg-base-200">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-3 h-3 rounded-full" 
                   [class.bg-success]="agentStatus === 'running'"
                   [class.bg-error]="agentStatus !== 'running'"></div>
              <span class="font-medium">Agent Status</span>
              <span class="opacity-60">{{ agentStatus === 'running' ? 'Running' : 'Stopped' }}</span>
            </div>
            <button (click)="restartAgent()"
                    [disabled]="agentRestarting"
                    class="btn btn-warning btn-sm">
              {{ agentRestarting ? 'Restarting...' : 'Restart Agent' }}
            </button>
          </div>
        </div>
      </div>

      <!-- AI Model Selection -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">🤖 AI Model</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">Select Model</span>
              </label>
              <select [(ngModel)]="selectedModel"
                      (ngModelChange)="onFieldChange()"
                      class="select select-bordered">
                @for (model of models; track model.id) {
                  <option [value]="model.id">{{ model.name }} ({{ model.provider }})</option>
                }
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">API Key</span>
              </label>
              <div class="flex gap-2">
                <input [type]="showApiKey ? 'text' : 'password'"
                       [(ngModel)]="apiKey"
                       (ngModelChange)="onFieldChange()"
                       placeholder="Enter API key for selected model"
                       class="input input-bordered flex-1">
                <button (click)="toggleApiKeyVisibility()"
                        class="btn btn-ghost btn-square">
                  @if (showApiKey) {
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  } @else {
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  }
                </button>
              </div>
            </div>
          </div>
          
          <div class="mt-4 flex items-center justify-between">
            <div>
              <span class="opacity-60 text-sm">Current model: </span>
              <span class="text-primary font-medium">{{ getCurrentModelName() }}</span>
            </div>
            <button (click)="saveAndRestart()"
                    [disabled]="!hasChanges || saving"
                    class="btn btn-primary">
              @if (saving) {
                <span class="loading loading-spinner loading-sm"></span>
                Saving...
              } @else {
                Save & Restart
              }
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- GitHub Config -->
        <div class="card bg-base-200">
          <div class="card-body">
            <h3 class="card-title">GitHub Repository</h3>
            
            <div class="space-y-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text opacity-60">Repository URL</span>
                </label>
                <input type="text" 
                       [(ngModel)]="githubRepo"
                       placeholder="owner/repo or https://github.com/owner/repo"
                       class="input input-bordered">
              </div>
              
              <div class="form-control">
                <label class="label">
                  <span class="label-text opacity-60">GitHub Token</span>
                </label>
                <input type="password" 
                       [(ngModel)]="githubToken"
                       placeholder="ghp_xxxxx"
                       class="input input-bordered">
              </div>

              <button (click)="saveConfig()"
                      [disabled]="!githubRepo || !githubToken"
                      class="btn btn-primary">
                Save Configuration
              </button>
            </div>
          </div>
        </div>

        <!-- Download Repo -->
        <div class="card bg-base-200">
          <div class="card-body">
            <h3 class="card-title">Repository Status</h3>
            
            <div class="flex items-center justify-between p-4 bg-base-300 rounded-lg">
              <div>
                <div class="font-medium">Repository Downloaded</div>
                <div class="opacity-60 text-sm">{{ repoStatus.downloaded ? 'Ready for agent' : 'Not downloaded' }}</div>
              </div>
              <button (click)="downloadRepo()"
                      [disabled]="!githubRepo || downloading"
                      class="btn btn-success btn-sm">
                {{ downloading ? 'Downloading...' : (repoStatus.downloaded ? 'Re-download' : 'Download') }}
              </button>
            </div>

            @if (repoStatus.downloaded) {
              <div class="opacity-60 text-sm">Files: {{ repoStatus.files }}</div>
            }
          </div>
        </div>

        <!-- Firebase Config -->
        <div class="card bg-base-200 lg:col-span-2">
          <div class="card-body">
            <h3 class="card-title">Firebase Project</h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text opacity-60">Project ID</span>
                </label>
                <input type="text" 
                       [(ngModel)]="firebaseProjectId"
                       placeholder="my-app-prod"
                       class="input input-bordered">
              </div>
              
              <div class="form-control">
                <label class="label">
                  <span class="label-text opacity-60">Service Account JSON</span>
                </label>
                <textarea 
                       [(ngModel)]="firebaseCredentials"
                       placeholder='{"type": "service_account", ...}'
                       rows="3"
                       class="textarea textarea-bordered font-mono text-sm"></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Webhook URL -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">Firebase Webhook URL</h3>
          <p class="opacity-60 text-sm mb-4">
            Configure this URL in Firebase Crashlytics to receive crash notifications:
          </p>
          <div class="flex items-center gap-2">
            <code class="flex-1 bg-base-300 px-4 py-2 rounded text-primary">
              '/api'/api/webhook/firebase
            </code>
            <button (click)="copyUrl()" class="btn btn-ghost btn-sm">
              Copy
            </button>
          </div>
        </div>
      </div>

      <!-- Toast -->
      @if (showToast) {
        <div class="toast toast-end">
          <div [class]="toastType === 'success' ? 'alert alert-success' : 'alert alert-error'">
            <span>{{ toastMessage }}</span>
          </div>
        </div>
      }

      <!-- Logs -->
      @if (logs.length > 0) {
        <div class="card bg-base-200">
          <div class="card-body">
            <h3 class="card-title">Logs</h3>
            <div class="bg-base-300 p-4 rounded-lg max-h-60 overflow-auto font-mono text-xs">
              @for (log of logs; track $index) {
                <div [class]="log.includes('ERROR') ? 'text-error' : (log.includes('SUCCESS') ? 'text-success' : '')">
                  {{ log }}
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class ConfigComponent implements OnInit, OnDestroy {
  models: Model[] = [
    { id: 'minimax/MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'minimax' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
  ];
  
  selectedModel = 'minimax/MiniMax-M2.5';
  apiKey = '';
  originalApiKey = '';
  
  githubRepo = '';
  githubToken = '';
  firebaseProjectId = '';
  firebaseCredentials = '';
  downloading = false;
  
  agentStatus = 'unknown';
  agentRestarting = false;
  saving = false;
  
  hasChanges = false;
  showApiKey = false;
  
  showToast = false;
  toastType: 'success' | 'error' = 'success';
  toastMessage = '';
  
  logs: string[] = [];
  
  repoStatus = {
    downloaded: false,
    files: 0
  };

  private statusInterval: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadExistingConfig();
    this.checkAgentStatus();
    this.statusInterval = setInterval(() => this.checkAgentStatus(), 5000);
  }

  ngOnDestroy() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
  }

  addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.unshift(`[${timestamp}] ${message}`);
    if (this.logs.length > 50) {
      this.logs.pop();
    }
  }

  onFieldChange() {
    this.hasChanges = this.apiKey !== this.originalApiKey;
  }

  toggleApiKeyVisibility() {
    this.showApiKey = !this.showApiKey;
  }

  checkAgentStatus() {
    this.http.get<any>('/api/agent/status')
      .subscribe({
        next: (res) => {
          this.agentStatus = res.status || 'unknown';
          this.addLog(`Agent status: ${this.agentStatus}`);
        },
        error: (err) => {
          this.addLog(`ERROR getting agent status: ${err.message}`);
        }
      });
  }

  restartAgent() {
    this.addLog('Restarting agent...');
    this.agentRestarting = true;
    this.http.post('/api/agent/restart', {})
      .subscribe({
        next: () => {
          this.addLog('SUCCESS: Agent restart command sent');
          setTimeout(() => {
            this.agentRestarting = false;
            this.checkAgentStatus();
          }, 10000);
        },
        error: (err) => {
          this.addLog(`ERROR restarting agent: ${err.message}`);
          this.agentRestarting = false;
        }
      });
  }

  saveAndRestart() {
    this.addLog(`Saving model: ${this.selectedModel}...`);
    this.saving = true;
    
    this.http.post('/api/config/model', {
      model: this.selectedModel,
      api_key: this.apiKey
    }).subscribe({
      next: () => {
        this.addLog('SUCCESS: Model config saved');
        this.originalApiKey = this.apiKey;
        this.hasChanges = false;
        
        setTimeout(() => {
          this.restartAgent();
        }, 500);
        
        this.showToastMessage(`Model updated to ${this.getCurrentModelName()}! Agent restarting...`, 'success');
        
        setTimeout(() => {
          this.saving = false;
          this.checkAgentStatus();
        }, 12000);
      },
      error: (err) => {
        this.addLog(`ERROR saving model: ${err.message}`);
        this.showToastMessage('Error saving configuration', 'error');
        this.saving = false;
      }
    });
  }

  loadExistingConfig() {
    this.addLog('Loading existing configuration...');
    this.http.get<any>('/api/repos')
      .subscribe({
        next: (repos) => {
          const keys = Object.keys(repos);
          if (keys.length > 0) {
            const repo = repos[keys[0]];
            this.githubRepo = repo.github_repo;
            this.githubToken = repo.github_token;
            this.firebaseProjectId = repo.firebase_project;
            this.selectedModel = repo.model || 'minimax/MiniMax-M2.5';
            this.apiKey = repo.api_key || '';
            this.originalApiKey = this.apiKey;
            this.hasChanges = false;
            this.addLog('SUCCESS: Configuration loaded');
            this.checkRepoStatus(keys[0]);
          } else {
            this.addLog('No existing configuration found');
          }
        },
        error: (err) => {
          this.addLog(`ERROR loading config: ${err.message}`);
        }
      });
  }

  saveConfig() {
    this.addLog('Saving GitHub + Firebase config...');
    const repo_id = 'default';
    
    this.http.post('/api/config', {
      repo_id,
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials,
      model: this.selectedModel
    }).subscribe({
      next: () => {
        this.addLog('SUCCESS: Configuration saved');
        this.showToastMessage('Configuration saved!', 'success');
        this.checkRepoStatus(repo_id);
      },
      error: (err) => {
        this.addLog(`ERROR saving config: ${err.message}`);
        this.showToastMessage('Error saving configuration', 'error');
      }
    });
  }

  checkRepoStatus(repoId: string) {
    this.http.get<any>(`'/api'/api/repos/${repoId}/status`)
      .subscribe({
        next: (status) => {
          this.repoStatus = {
            downloaded: status.downloaded,
            files: status.files || 0
          };
          this.addLog(`Repo status: downloaded=${status.downloaded}, files=${status.files}`);
        },
        error: (err) => {
          this.addLog(`ERROR getting repo status: ${err.message}`);
        }
      });
  }

  downloadRepo() {
    this.addLog('Starting repo download...');
    this.downloading = true;
    const repo_id = 'default';
    
    this.http.post(`'/api'/api/repos/${repo_id}/download`, {})
      .subscribe({
        next: () => {
          this.addLog('SUCCESS: Download started');
          const interval = setInterval(() => {
            this.checkRepoStatus(repo_id);
            if (this.repoStatus.downloaded) {
              this.downloading = false;
              clearInterval(interval);
              this.addLog('SUCCESS: Repository downloaded');
            }
          }, 2000);
        },
        error: (err) => {
          this.addLog(`ERROR downloading repo: ${err.message}`);
          this.downloading = false;
        }
      });
  }

  getCurrentModelName() {
    const model = this.models.find(m => m.id === this.selectedModel);
    return model ? model.name : this.selectedModel;
  }

  copyUrl() {
    navigator.clipboard.writeText('/api/webhook/firebase');
    this.addLog('Webhook URL copied to clipboard');
  }

  showToastMessage(msg: string, type: 'success' | 'error') {
    this.toastMessage = msg;
    this.toastType = type;
    this.showToast = true;
    setTimeout(() => {
      this.showToast = false;
      this.toastMessage = '';
    }, 5000);
  }
}
