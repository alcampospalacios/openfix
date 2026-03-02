import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface LogEntry {
  time: string;
  message: string;
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
          
          <div class="mt-4 flex items-center justify-between flex-wrap gap-2">
            <div><span class="opacity-60 text-sm">Current: </span><span class="text-primary font-medium">{{ getCurrentModelName() }}</span></div>
            <div class="flex gap-2 h-10">
              <button (click)="checkAgent()" [disabled]="checkingAgent" class="btn btn-info">
                @if (checkingAgent) { <span class="loading loading-spinner loading-sm"></span> Checking... } @else { 🧪 Check Agent }
              </button>
              <button (click)="saveAndRestart()" [disabled]="!hasChanges || saving" class="btn btn-primary">
                @if (saving) { <span class="loading loading-spinner loading-sm"></span> Saving... } @else { 💾 Save & Restart }
              </button>
            </div>
          </div>
          
          @if (agentResponse) {
            <div class="mt-4 bg-base-300 rounded p-3 text-sm whitespace-pre-wrap">{{ agentResponse }}</div>
          }
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
          
          <div class="mt-4">
            <button (click)="saveFirebaseConfig()" [disabled]="!firebaseProjectId" class="btn btn-primary">Save</button>
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

      <!-- Logs Panel -->
      <div class="card bg-base-200">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <h3 class="card-title">📋 API Logs</h3>
            <button (click)="clearLogs()" class="btn btn-ghost btn-xs">Clear</button>
          </div>
          <div class="bg-base-300 rounded p-2 h-48 overflow-y-auto font-mono text-xs space-y-1">
            @for (log of logs; track log.time) {
              <div><span class="opacity-50">{{ log.time }}</span> {{ log.message }}</div>
            }
            @if (logs.length === 0) {
              <div class="opacity-50">No logs yet...</div>
            }
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
  
  agentStatus = 'unknown';
  saving = false;
  hasChanges = false;
  showApiKey = false;
  
  checkingAgent = false;
  agentResponse = '';
  currentMessageId = '';
  pollInterval: any;
  statusInterval: any;
  
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  
  logs: LogEntry[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadConfig();
    this.checkAgentStatus();
    
    // Auto-refresh status every 10 seconds
    this.statusInterval = setInterval(() => this.checkAgentStatus(), 10000);
  }

  ngOnDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.statusInterval) clearInterval(this.statusInterval);
  }

  addLog(message: string) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift({ time, message });
    if (this.logs.length > 50) this.logs.pop();
  }

  clearLogs() {
    this.logs = [];
  }

  onFieldChange() {
    this.hasChanges = this.apiKey !== this.originalApiKey;
  }

  checkAgentStatus() {
    this.http.get<any>('/api/agent/status').subscribe({
      next: (res) => {
        this.agentStatus = res.status || 'unknown';
      },
      error: () => {
        this.agentStatus = 'unknown';
      }
    });
  }

  refreshStatus() {
    this.checkAgentStatus();
  }

  checkAgent() {
    this.checkingAgent = true;
    this.agentResponse = '';
    
    const message = 'Hola';
    this.addLog(`POST /api/agent/test { text: "${message}" }`);
    
    this.http.post<any>('/api/agent/test', { text: message }).subscribe({
      next: (res) => {
        this.currentMessageId = res.messageId;
        this.addLog(`RESPONSE: message sent, id = ${res.messageId}`);
        
        // Poll for response
        this.pollInterval = setInterval(() => this.pollResponse(), 1000);
      },
      error: (err) => {
        this.addLog(`ERROR: ${err.message}`);
        this.checkingAgent = false;
      }
    });
  }

  pollResponse() {
    if (!this.currentMessageId) return;
    
    this.http.get<any>(`/api/agent/test/${this.currentMessageId}`).subscribe({
      next: (res) => {
        if (res.hasResponse) {
          clearInterval(this.pollInterval);
          this.agentResponse = res.response;
          this.addLog(`RESPONSE: ${res.response}`);
          this.checkingAgent = false;
        }
      },
      error: () => {
        clearInterval(this.pollInterval);
        this.checkingAgent = false;
      }
    });
  }

  saveAndRestart() {
    this.saving = true;
    this.addLog(`POST /api/config/model { model: ${this.selectedModel} }`);
    this.http.post('/api/config/model', { model: this.selectedModel, api_key: this.apiKey }).subscribe({
      next: () => {
        this.originalApiKey = this.apiKey;
        this.hasChanges = false;
        this.addLog('RESPONSE: model saved successfully');
        this.showToast('Model saved! Agent restarting...', 'success');
        setTimeout(() => this.saving = false, 10000);
      },
      error: (err) => {
        this.addLog(`ERROR: ${err.message}`);
        this.showToast('Error saving', 'error');
        this.saving = false;
      }
    });
  }

  loadConfig() {
    this.addLog('GET /api/repos');
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
          this.addLog('RESPONSE: config loaded');
        } else {
          this.addLog('RESPONSE: no existing config');
        }
      },
      error: (err) => this.addLog(`ERROR: ${err.message}`)
    });
  }

  saveGitHubConfig() {
    this.addLog(`POST /api/config { repo: ${this.githubRepo} }`);
    this.http.post('/api/config', {
      repo_id: 'default',
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials,
      model: this.selectedModel
    }).subscribe({
      next: () => {
        this.addLog('RESPONSE: config saved');
        this.showToast('Configuration saved!', 'success');
      },
      error: (err) => {
        this.addLog(`ERROR: ${err.message}`);
        this.showToast('Error saving', 'error');
      }
    });
  }

  getCurrentModelName() {
    const model = this.models.find(m => m.id === this.selectedModel);
    return model ? model.name : this.selectedModel;
  }

  copyUrl() {
    navigator.clipboard.writeText('/api/webhook/firebase');
    this.addLog('Copied webhook URL to clipboard');
    this.showToast('Copied!', 'success');
  }

  saveFirebaseConfig() {
    this.addLog(`POST /api/config { firebase: ${this.firebaseProjectId} }`);
    this.http.post('/api/config', {
      repo_id: 'default',
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials,
      model: this.selectedModel
    }).subscribe({
      next: () => {
        this.addLog('RESPONSE: firebase config saved');
        this.showToast('Firebase config saved!', 'success');
      },
      error: (err) => {
        this.addLog(`ERROR: ${err.message}`);
        this.showToast('Error saving', 'error');
      }
    });
  }

  showToast(msg: string, type: 'success' | 'error') {
    this.toastMessage = msg;
    this.toastType = type;
    setTimeout(() => this.toastMessage = '', 5000);
  }
}
