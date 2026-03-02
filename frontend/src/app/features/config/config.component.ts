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
                      (ngModelChange)="onModelChange()"
                      class="select select-bordered">
                @for (model of models; track model.id) {
                  <option [value]="model.id">{{ model.name }} ({{ model.provider }})</option>
                }
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">API Key (optional)</span>
              </label>
              <input type="password" 
                     [(ngModel)]="apiKey"
                     (blur)="saveModel()"
                     placeholder="Your API key for selected model"
                     class="input input-bordered">
            </div>
          </div>
          
          <div class="mt-4 flex items-center justify-between">
            <div>
              <span class="opacity-60 text-sm">Current model: </span>
              <span class="text-primary font-medium">{{ getCurrentModelName() }}</span>
            </div>
            @if (agentRestarting) {
              <span class="text-warning animate-pulse">Agent restarting with new model...</span>
            }
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
              http://localhost:3000/api/webhook/firebase
            </code>
            <button (click)="copyUrl()" class="btn btn-ghost btn-sm">
              Copy
            </button>
          </div>
        </div>
      </div>

      @if (message) {
        <div class="alert alert-success">
          <span>{{ message }}</span>
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
  
  githubRepo = '';
  githubToken = '';
  firebaseProjectId = '';
  firebaseCredentials = '';
  downloading = false;
  message = '';
  
  agentStatus = 'unknown';
  agentRestarting = false;
  
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

  checkAgentStatus() {
    this.http.get<any>('http://localhost:3000/api/agent/status')
      .subscribe({
        next: (res) => this.agentStatus = res.status || 'unknown'
      });
  }

  restartAgent() {
    this.agentRestarting = true;
    this.http.post('http://localhost:3000/api/agent/restart', {})
      .subscribe({
        next: () => {
          this.showMessage('Agent restarting...');
          setTimeout(() => {
            this.agentRestarting = false;
            this.checkAgentStatus();
          }, 10000);
        },
        error: () => {
          this.agentRestarting = false;
        }
      });
  }

  loadExistingConfig() {
    this.http.get<any>('http://localhost:3000/api/repos')
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
            this.checkRepoStatus(keys[0]);
          }
        },
        error: () => console.log('No config yet')
      });
  }

  onModelChange() {
    this.saveModel();
  }

  saveModel() {
    this.agentRestarting = true;
    
    this.http.post('http://localhost:3000/api/config/model', {
      model: this.selectedModel,
      api_key: this.apiKey
    }).subscribe({
      next: () => {
        this.showMessage(`Model updated to ${this.getCurrentModelName()}! Agent restarting...`);
        
        setTimeout(() => {
          this.checkAgentStatus();
          this.agentRestarting = false;
        }, 8000);
      },
      error: () => {
        this.agentRestarting = false;
      }
    });
  }

  saveConfig() {
    const repo_id = 'default';
    
    this.http.post('http://localhost:3000/api/config', {
      repo_id,
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials,
      model: this.selectedModel
    }).subscribe({
      next: () => {
        this.showMessage('Configuration saved!');
        this.checkRepoStatus(repo_id);
      },
      error: () => console.log('Error saving config')
    });
  }

  checkRepoStatus(repoId: string) {
    this.http.get<any>(`http://localhost:3000/api/repos/${repoId}/status`)
      .subscribe({
        next: (status) => {
          this.repoStatus = {
            downloaded: status.downloaded,
            files: status.files || 0
          };
        }
      });
  }

  downloadRepo() {
    this.downloading = true;
    const repo_id = 'default';
    
    this.http.post(`http://localhost:3000/api/repos/${repo_id}/download`, {})
      .subscribe({
        next: () => {
          const interval = setInterval(() => {
            this.checkRepoStatus(repo_id);
            if (this.repoStatus.downloaded) {
              this.downloading = false;
              clearInterval(interval);
            }
          }, 2000);
        },
        error: () => {
          this.downloading = false;
        }
      });
  }

  getCurrentModelName() {
    const model = this.models.find(m => m.id === this.selectedModel);
    return model ? model.name : this.selectedModel;
  }

  copyUrl() {
    navigator.clipboard.writeText('http://localhost:3000/api/webhook/firebase');
  }

  showMessage(msg: string) {
    this.message = msg;
    setTimeout(() => this.message = '', 5000);
  }
}
