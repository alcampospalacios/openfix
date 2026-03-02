import { Component, OnInit } from '@angular/core';
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
            <button (click)="refreshStatus()" class="btn btn-ghost btn-sm">Refresh</button>
          </div>
        </div>
      </div>

      <!-- AI Model -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">🤖 AI Model</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">Select Model</span></label>
              <select [(ngModel)]="selectedModel" (ngModelChange)="onFieldChange()" class="select select-bordered">
                @for (model of models; track model.id) {
                  <option [value]="model.id">{{ model.name }} ({{ model.provider }})</option>
                }
              </select>
            </div>

            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">API Key</span></label>
              <input [type]="showApiKey ? 'text' : 'password'" 
                     [(ngModel)]="apiKey" (ngModelChange)="onFieldChange()"
                     placeholder="Enter API key" class="input input-bordered">
            </div>
          </div>
          
          <div class="mt-4 flex items-center justify-between">
            <div><span class="opacity-60 text-sm">Current: </span><span class="text-primary font-medium">{{ getCurrentModelName() }}</span></div>
            <button (click)="saveAndRestart()" [disabled]="!hasChanges || saving" class="btn btn-primary">
              @if (saving) { <span class="loading loading-spinner loading-sm"></span> Saving... } @else { Save & Restart }
            </button>
          </div>
        </div>
      </div>

      <!-- GitHub Config -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">GitHub Repository</h3>
          <div class="space-y-4">
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">Repository URL</span></label>
              <input type="text" [(ngModel)]="githubRepo" placeholder="owner/repo" class="input input-bordered">
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">GitHub Token</span></label>
              <input type="password" [(ngModel)]="githubToken" placeholder="ghp_xxxxx" class="input input-bordered">
            </div>
            <button (click)="saveGitHubConfig()" [disabled]="!githubRepo || !githubToken" class="btn btn-primary">Save</button>
          </div>
        </div>
      </div>

      <!-- Firebase Config -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">Firebase Project</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">Project ID</span></label>
              <input type="text" [(ngModel)]="firebaseProjectId" placeholder="my-app-prod" class="input input-bordered">
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">Service Account JSON</span></label>
              <textarea [(ngModel)]="firebaseCredentials" placeholder='{"type": "service_account"}' rows="3" class="textarea textarea-bordered font-mono text-sm"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">Firebase Webhook URL</h3>
          <p class="opacity-60 text-sm mb-4">Configure in Firebase Crashlytics:</p>
          <div class="flex gap-2">
            <code class="flex-1 bg-base-300 px-4 py-2 rounded text-primary">/api/webhook/firebase</code>
            <button (click)="copyUrl()" class="btn btn-ghost btn-sm">Copy</button>
          </div>
        </div>
      </div>

      @if (toastMessage) {
        <div class="toast toast-end">
          <div [class]="toastType === 'success' ? 'alert alert-success' : 'alert alert-error'">
            <span>{{ toastMessage }}</span>
          </div>
        </div>
      }
    </div>
  `
})
export class ConfigComponent implements OnInit {
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
  
  agentStatus = 'unknown';
  saving = false;
  hasChanges = false;
  showApiKey = false;
  
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadConfig();
    this.checkAgentStatus();
  }

  onFieldChange() {
    this.hasChanges = this.apiKey !== this.originalApiKey;
  }

  checkAgentStatus() {
    this.http.get<any>('/api/agent/status').subscribe({
      next: (res) => this.agentStatus = res.status || 'unknown',
      error: () => this.agentStatus = 'unknown'
    });
  }

  refreshStatus() {
    this.checkAgentStatus();
  }

  saveAndRestart() {
    this.saving = true;
    this.http.post('/api/config/model', { model: this.selectedModel, api_key: this.apiKey }).subscribe({
      next: () => {
        this.originalApiKey = this.apiKey;
        this.hasChanges = false;
        this.showToast('Model saved! Agent restarting...', 'success');
        setTimeout(() => this.saving = false, 10000);
      },
      error: () => {
        this.showToast('Error saving', 'error');
        this.saving = false;
      }
    });
  }

  loadConfig() {
    this.http.get<any>('/api/repos').subscribe({
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
        }
      }
    });
  }

  saveGitHubConfig() {
    this.http.post('/api/config', {
      repo_id: 'default',
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials,
      model: this.selectedModel
    }).subscribe({
      next: () => this.showToast('Configuration saved!', 'success'),
      error: () => this.showToast('Error saving', 'error')
    });
  }

  getCurrentModelName() {
    const model = this.models.find(m => m.id === this.selectedModel);
    return model ? model.name : this.selectedModel;
  }

  copyUrl() {
    navigator.clipboard.writeText('/api/webhook/firebase');
    this.showToast('Copied!', 'success');
  }

  showToast(msg: string, type: 'success' | 'error') {
    this.toastMessage = msg;
    this.toastType = type;
    setTimeout(() => this.toastMessage = '', 5000);
  }
}
