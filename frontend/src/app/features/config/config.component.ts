import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { WebSocketService } from '../../services/websocket.service';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ModelGroup {
  provider: string;
  models: Model[];
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
        <p class="opacity-60">Configure your repositories, AI model, and Slack integration</p>
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

      <!-- AI Model (via OpenClaw) -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">AI Model <span class="badge badge-ghost badge-sm ml-2">via OpenClaw</span></h3>
          <p class="opacity-50 text-xs -mt-2">OpenClaw routes your tasks to the selected model. Choose a provider and enter its API key.</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">Provider / Model</span></label>
              <select [(ngModel)]="selectedModel" (ngModelChange)="onFieldChange()" class="select select-bordered">
                @for (group of modelGroups; track group.provider) {
                  <optgroup [label]="group.provider | uppercase">
                    @for (model of group.models; track model.id) {
                      <option [value]="model.id">{{ model.name }}</option>
                    }
                  </optgroup>
                }
              </select>
            </div>

            <div class="form-control">
              <label class="label"><span class="label-text opacity-60">API Key ({{ getSelectedProvider() }})</span></label>
              <div class="join w-full">
                <input [type]="showApiKey ? 'text' : 'password'"
                       [(ngModel)]="apiKey" (ngModelChange)="onFieldChange()"
                       placeholder="Enter API key for {{ getSelectedProvider() }}" class="input input-bordered join-item w-full">
                <button (click)="showApiKey = !showApiKey" class="btn btn-ghost join-item">
                  {{ showApiKey ? 'Hide' : 'Show' }}
                </button>
              </div>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-between flex-wrap gap-2">
            <div><span class="opacity-60 text-sm">Current: </span><span class="text-primary font-medium">{{ getCurrentModelName() }}</span></div>
            <div class="flex gap-2 h-10">
              <button (click)="checkAgent()" [disabled]="checkingAgent" class="btn btn-info">
                @if (checkingAgent) { <span class="loading loading-spinner loading-sm"></span> Checking... } @else { Check Agent }
              </button>
              <button (click)="saveAndRestart()" [disabled]="!hasChanges || saving" class="btn btn-primary">
                @if (saving) { <span class="loading loading-spinner loading-sm"></span> Saving... } @else { Save & Restart }
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

          <div class="mt-4 flex items-center gap-3">
            <button (click)="saveFirebaseConfig()" [disabled]="!firebaseProjectId" class="btn btn-primary">Save</button>
            <button (click)="helpModal = 'bigquery'" class="btn btn-ghost btn-sm">BigQuery Setup Guide</button>
          </div>

          <!-- BigQuery enrichment status -->
          <div class="mt-4 rounded-lg bg-base-300 p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm">Crash Enrichment (BigQuery)</span>
              @if (firebaseProjectId && firebaseCredentials) {
                <span class="badge badge-success badge-sm">Configured</span>
              } @else {
                <span class="badge badge-warning badge-sm">Not configured</span>
              }
            </div>
            <p class="text-xs opacity-60">
              When configured, crashes from Slack are automatically enriched with stacktrace, device info, and OS version from BigQuery.
            </p>
            <div class="flex flex-wrap gap-2 mt-1">
              <div class="flex items-center gap-1">
                @if (firebaseProjectId) {
                  <span class="text-success text-xs">&#10003;</span>
                } @else {
                  <span class="text-error text-xs">&#10007;</span>
                }
                <span class="text-xs">Project ID</span>
              </div>
              <div class="flex items-center gap-1">
                @if (firebaseCredentials) {
                  <span class="text-success text-xs">&#10003;</span>
                } @else {
                  <span class="text-error text-xs">&#10007;</span>
                }
                <span class="text-xs">Service Account</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="text-warning text-xs">?</span>
                <span class="text-xs">BQ Export enabled</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="text-warning text-xs">?</span>
                <span class="text-xs">IAM roles</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Slack Integration -->
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">Slack Integration</h3>
          <p class="opacity-60 text-sm mb-4">Connect to your Slack channel where Firebase Crashlytics sends alerts. The backend listens via Socket Mode (no public URL needed).</p>

          <div class="space-y-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">App-Level Token</span>
                <button (click)="helpModal = 'appToken'" class="btn btn-ghost btn-xs btn-circle">?</button>
              </label>
              <input type="password" [(ngModel)]="slackAppToken" placeholder="xapp-..." class="input input-bordered">
            </div>
            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">Bot Token</span>
                <button (click)="helpModal = 'botToken'" class="btn btn-ghost btn-xs btn-circle">?</button>
              </label>
              <input type="password" [(ngModel)]="slackBotToken" placeholder="xoxb-..." class="input input-bordered">
            </div>
            <div class="form-control">
              <label class="label">
                <span class="label-text opacity-60">Channel ID</span>
                <button (click)="helpModal = 'channelId'" class="btn btn-ghost btn-xs btn-circle">?</button>
              </label>
              <input type="text" [(ngModel)]="slackChannelId" placeholder="C0XXXXXXX" class="input input-bordered">
            </div>

            <div class="flex items-center gap-3">
              <button (click)="saveSlackConfig()"
                      [disabled]="!slackAppToken || !slackBotToken || !slackChannelId || savingSlack"
                      class="btn btn-primary">
                @if (savingSlack) { <span class="loading loading-spinner loading-sm"></span> Saving... } @else { Save & Connect }
              </button>

              @if (slackConnected) {
                <span class="badge badge-success">Connected</span>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Help Modal: App-Level Token -->
      @if (helpModal === 'appToken') {
        <div class="modal modal-open">
          <div class="modal-box max-w-lg">
            <h3 class="font-bold text-lg mb-4">How to get the App-Level Token</h3>
            <ol class="list-decimal list-inside space-y-3 text-sm">
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" class="link link-primary">api.slack.com/apps</a></li>
              <li>Click <strong>Create New App</strong> > <strong>From scratch</strong></li>
              <li>Give it a name (e.g. "Openfix") and select your workspace</li>
              <li>In the left sidebar, go to <strong>Settings</strong> > <strong>Basic Information</strong></li>
              <li>Scroll down to <strong>App-Level Tokens</strong></li>
              <li>Click <strong>Generate Token and Scopes</strong></li>
              <li>Give the token a name (e.g. "socket-mode")</li>
              <li>Add the scope <code class="bg-base-300 px-1 rounded">connections:write</code></li>
              <li>Click <strong>Generate</strong></li>
              <li>Copy the token that starts with <code class="bg-base-300 px-1 rounded">xapp-</code></li>
            </ol>
            <div class="alert alert-info mt-4 text-sm">
              <span>You also need to enable Socket Mode: go to <strong>Settings</strong> > <strong>Socket Mode</strong> and toggle it <strong>On</strong>.</span>
            </div>
            <div class="modal-action">
              <button (click)="helpModal = ''" class="btn">Close</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="helpModal = ''"></div>
        </div>
      }

      <!-- Help Modal: Bot Token -->
      @if (helpModal === 'botToken') {
        <div class="modal modal-open">
          <div class="modal-box max-w-lg">
            <h3 class="font-bold text-lg mb-4">How to get the Bot Token</h3>
            <ol class="list-decimal list-inside space-y-3 text-sm">
              <li>Go to your app at <a href="https://api.slack.com/apps" target="_blank" class="link link-primary">api.slack.com/apps</a></li>
              <li>In the left sidebar, go to <strong>Features</strong> > <strong>Event Subscriptions</strong></li>
              <li>Toggle <strong>Enable Events</strong> to On</li>
              <li>Under <strong>Subscribe to bot events</strong>, click <strong>Add Bot User Event</strong></li>
              <li>Add <code class="bg-base-300 px-1 rounded">message.channels</code> (for public channels)</li>
              <li>If your channel is private, also add <code class="bg-base-300 px-1 rounded">message.groups</code></li>
              <li>Click <strong>Save Changes</strong></li>
              <li>In the left sidebar, go to <strong>Settings</strong> > <strong>Install App</strong></li>
              <li>Click <strong>Install to Workspace</strong> (or <strong>Reinstall</strong>) and authorize</li>
              <li>Copy the <strong>Bot User OAuth Token</strong> that starts with <code class="bg-base-300 px-1 rounded">xoxb-</code></li>
            </ol>
            <div class="alert alert-warning mt-4 text-sm">
              <span>After installing, invite the bot to your channel by typing <code>/invite &#64;YourAppName</code> in the channel.</span>
            </div>
            <div class="modal-action">
              <button (click)="helpModal = ''" class="btn">Close</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="helpModal = ''"></div>
        </div>
      }

      <!-- Help Modal: Channel ID -->
      @if (helpModal === 'channelId') {
        <div class="modal modal-open">
          <div class="modal-box max-w-lg">
            <h3 class="font-bold text-lg mb-4">How to get the Channel ID</h3>
            <ol class="list-decimal list-inside space-y-3 text-sm">
              <li>Open <strong>Slack</strong> in your browser or desktop app</li>
              <li>Go to the channel where Firebase Crashlytics sends crash alerts</li>
              <li>Click the <strong>channel name</strong> at the top to open channel details</li>
              <li>Scroll to the bottom of the details panel</li>
              <li>You'll see the <strong>Channel ID</strong> (e.g. <code class="bg-base-300 px-1 rounded">C0XXXXXXX</code>)</li>
              <li>Click it to copy, or select and copy manually</li>
            </ol>
            <div class="alert alert-info mt-4 text-sm">
              <span>Make sure your bot has been invited to this channel with <code>/invite &#64;YourAppName</code>, otherwise it won't receive messages.</span>
            </div>
            <div class="modal-action">
              <button (click)="helpModal = ''" class="btn">Close</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="helpModal = ''"></div>
        </div>
      }

      <!-- Help Modal: BigQuery Setup -->
      @if (helpModal === 'bigquery') {
        <div class="modal modal-open">
          <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-lg mb-4">BigQuery Setup for Crash Enrichment</h3>
            <p class="text-sm opacity-70 mb-4">
              Openfix uses BigQuery to enrich crashes with stacktrace, device, and OS details.
              The Crashlytics REST API does not support service accounts, so BigQuery is the only reliable way to get this data programmatically.
            </p>

            <div class="space-y-4">
              <div>
                <h4 class="font-semibold text-sm mb-2">1. Enable Crashlytics export to BigQuery</h4>
                <ol class="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to the <a href="https://console.firebase.google.com" target="_blank" class="link link-primary">Firebase Console</a></li>
                  <li>Select your project</li>
                  <li>Go to <strong>Project Settings</strong> (gear icon)</li>
                  <li>Click the <strong>Integrations</strong> tab</li>
                  <li>Find <strong>BigQuery</strong> and click <strong>Link</strong></li>
                  <li>Enable the <strong>Crashlytics</strong> toggle</li>
                  <li>Choose <strong>Include streaming</strong> for real-time data (recommended)</li>
                </ol>
                <div class="alert alert-info mt-2 text-xs">
                  <span>After enabling, it may take a few hours for the first data to appear in BigQuery. Streaming data appears within minutes.</span>
                </div>
              </div>

              <div>
                <h4 class="font-semibold text-sm mb-2">2. Configure IAM roles for the Service Account</h4>
                <ol class="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to <a href="https://console.cloud.google.com/iam-admin/iam" target="_blank" class="link link-primary">Google Cloud Console > IAM</a></li>
                  <li>Find your service account (the one in the JSON above)</li>
                  <li>Click <strong>Edit</strong> (pencil icon)</li>
                  <li>Add the following roles:</li>
                </ol>
                <div class="flex flex-wrap gap-2 mt-2 ml-6">
                  <code class="bg-base-300 px-2 py-1 rounded text-xs">roles/bigquery.dataViewer</code>
                  <code class="bg-base-300 px-2 py-1 rounded text-xs">roles/bigquery.jobUser</code>
                </div>
              </div>

              <div>
                <h4 class="font-semibold text-sm mb-2">3. Verify the table exists</h4>
                <p class="text-sm">Once the export is active, BigQuery will create a dataset called <code class="bg-base-300 px-1 rounded">firebase_crashlytics</code> in your project with tables like:</p>
                <code class="block bg-base-300 px-3 py-2 rounded text-xs mt-2 font-mono">
                  your-project.firebase_crashlytics.com_example_myapp_ANDROID
                </code>
                <p class="text-xs opacity-60 mt-1">
                  The table name is derived from your app package: dots become underscores, platform is appended in uppercase.
                </p>
              </div>
            </div>

            <div class="alert alert-warning mt-4 text-sm">
              <span>Without these steps, crashes will still appear in the panel but without enriched details (stacktrace, device, OS).</span>
            </div>
            <div class="modal-action">
              <button (click)="helpModal = ''" class="btn">Close</button>
            </div>
          </div>
          <div class="modal-backdrop" (click)="helpModal = ''"></div>
        </div>
      }

      <!-- Webhook (deprecated: now using Slack Socket Mode)
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
      -->

      <!-- Logs Panel -->
      <div class="card bg-base-200">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <h3 class="card-title">API Logs</h3>
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
  models: Model[] = [];
  modelGroups: ModelGroup[] = [];

  selectedModel = 'minimax/MiniMax-M2.5';
  originalModel = 'minimax/MiniMax-M2.5';
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

  // Slack config
  slackAppToken = '';
  slackBotToken = '';
  slackChannelId = '';
  savingSlack = false;
  slackConnected = false;
  helpModal = '';

  toastMessage = '';
  toastType: 'success' | 'error' = 'success';

  logs: LogEntry[] = [];

  private subs: Subscription[] = [];

  constructor(private http: HttpClient, private ws: WebSocketService) {}

  ngOnInit() {
    this.loadModels();
    this.loadConfig();
    this.checkAgentStatus();

    // Subscribe to WS events for real-time updates
    this.subs.push(
      this.ws.on('init').subscribe((data: any) => {
        if (data.agent_status) {
          this.agentStatus = data.agent_status.status || 'unknown';
        }
      }),
      this.ws.on('agent_status').subscribe((data: any) => {
        this.agentStatus = data.status || 'unknown';
      }),
      this.ws.on('test_response').subscribe((data: any) => {
        this.agentResponse = data.response;
        this.addLog(`WS RESPONSE: ${data.response}`);
        this.checkingAgent = false;
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
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
    this.hasChanges = this.apiKey !== this.originalApiKey || this.selectedModel !== this.originalModel;
  }

  getSelectedProvider(): string {
    const slash = this.selectedModel.indexOf('/');
    return slash > 0 ? this.selectedModel.substring(0, slash) : 'unknown';
  }

  loadModels() {
    this.http.get<any>('/api/models').subscribe({
      next: (res) => {
        this.models = res.models || [];
        // Group by provider
        const groups: { [key: string]: Model[] } = {};
        for (const m of this.models) {
          if (!groups[m.provider]) groups[m.provider] = [];
          groups[m.provider].push(m);
        }
        this.modelGroups = Object.keys(groups).map(p => ({ provider: p, models: groups[p] }));
      },
      error: () => {
        // Fallback if backend is unreachable
        this.models = [{ id: 'minimax/MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'minimax' }];
        this.modelGroups = [{ provider: 'minimax', models: this.models }];
      }
    });
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
    this.addLog(`WS test_message: "${message}"`);
    this.ws.send('test_message', { text: message });
  }

  saveAndRestart() {
    this.saving = true;
    this.addLog(`POST /api/config/model { model: ${this.selectedModel} }`);
    this.http.post('/api/config/model', { model: this.selectedModel, api_key: this.apiKey }).subscribe({
      next: () => {
        this.originalApiKey = this.apiKey;
        this.originalModel = this.selectedModel;
        this.hasChanges = false;
        this.addLog('RESPONSE: model saved, OpenClaw config updated');
        this.showToast('Model saved! OpenClaw updated, agent restarting...', 'success');
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
          this.firebaseProjectId = repo.firebase_project || '';
          this.firebaseCredentials = repo.firebase_credentials || '';
          this.selectedModel = repo.model || 'minimax/MiniMax-M2.5';
          this.originalModel = this.selectedModel;
          this.apiKey = repo.api_key || '';
          this.originalApiKey = this.apiKey;
          // Slack config
          this.slackAppToken = repo.slack_app_token || '';
          this.slackBotToken = repo.slack_bot_token || '';
          this.slackChannelId = repo.slack_channel_id || '';
          this.slackConnected = !!(repo.slack_app_token && repo.slack_bot_token && repo.slack_channel_id);
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

  saveSlackConfig() {
    this.savingSlack = true;
    this.addLog(`POST /api/config/slack { channel: ${this.slackChannelId} }`);

    this.http.post('/api/config/slack', {
      slack_app_token: this.slackAppToken,
      slack_bot_token: this.slackBotToken,
      slack_channel_id: this.slackChannelId,
    }).subscribe({
      next: () => {
        this.savingSlack = false;
        this.slackConnected = true;
        this.addLog('RESPONSE: Slack config saved, listener restarting');
        this.showToast('Slack connected!', 'success');
      },
      error: (err) => {
        this.savingSlack = false;
        this.addLog(`ERROR: ${err.message}`);
        this.showToast('Error saving Slack config', 'error');
      }
    });
  }

  showToast(msg: string, type: 'success' | 'error') {
    this.toastMessage = msg;
    this.toastType = type;
    setTimeout(() => this.toastMessage = '', 5000);
  }
}
