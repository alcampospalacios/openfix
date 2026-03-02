import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface Repo {
  github_repo: string;
  github_token: string;
  firebase_project: string;
}

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-2xl font-bold text-white">Configuration</h2>
        <p class="text-gray-400">Configure your repositories and Firebase projects</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- GitHub Config -->
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 class="text-lg font-semibold text-white mb-4">GitHub Repository</h3>
          
          <div class="space-y-4">
            <div>
              <label class="block text-gray-400 text-sm mb-2">Repository URL</label>
              <input type="text" 
                     [(ngModel)]="githubRepo"
                     placeholder="owner/repo or https://github.com/owner/repo"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500">
            </div>
            
            <div>
              <label class="block text-gray-400 text-sm mb-2">GitHub Token</label>
              <input type="password" 
                     [(ngModel)]="githubToken"
                     placeholder="ghp_xxxxx"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500">
            </div>

            <button (click)="saveConfig()"
                    [disabled]="!githubRepo || !githubToken"
                    class="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-colors">
              Save Configuration
            </button>
          </div>
        </div>

        <!-- Download Repo -->
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 class="text-lg font-semibold text-white mb-4">Repository Status</h3>
          
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
              <div>
                <div class="text-white font-medium">Repository Downloaded</div>
                <div class="text-gray-400 text-sm">{{ repoStatus.downloaded ? '✅ Ready for agent' : '❌ Not downloaded' }}</div>
              </div>
              <button (click)="downloadRepo()"
                      [disabled]="!githubRepo || downloading"
                      class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors">
                {{ downloading ? 'Downloading...' : (repoStatus.downloaded ? 'Re-download' : 'Download') }}
              </button>
            </div>

            <div *ngIf="repoStatus.downloaded" class="text-gray-400 text-sm">
              Files: {{ repoStatus.files }}
            </div>
          </div>
        </div>

        <!-- Firebase Config -->
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <h3 class="text-lg font-semibold text-white mb-4">Firebase Project</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-gray-400 text-sm mb-2">Project ID</label>
              <input type="text" 
                     [(ngModel)]="firebaseProjectId"
                     placeholder="my-app-prod"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500">
            </div>
            
            <div>
              <label class="block text-gray-400 text-sm mb-2">Service Account JSON</label>
              <textarea 
                     [(ngModel)]="firebaseCredentials"
                     placeholder='{"type": "service_account", ...}'
                     rows="3"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500 font-mono text-sm"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- Webhook URL -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold text-white mb-4">Firebase Webhook URL</h3>
        <p class="text-gray-400 text-sm mb-4">
          Configure this URL in Firebase Crashlytics to receive crash notifications:
        </p>
        <div class="flex items-center space-x-2">
          <code class="bg-gray-700 px-4 py-2 rounded text-primary-400 flex-1 overflow-x-auto">
            http://localhost:3000/api/webhook/firebase
          </code>
          <button (click)="copyUrl()" 
                  class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-white transition-colors">
            Copy
          </button>
        </div>
      </div>

      <!-- Success Message -->
      <div *ngIf="message" 
           class="bg-green-600/20 border border-green-600 text-green-400 px-4 py-3 rounded-lg">
        {{ message }}
      </div>
    </div>
  `
})
export class ConfigComponent implements OnInit {
  githubRepo = '';
  githubToken = '';
  firebaseProjectId = '';
  firebaseCredentials = '';
  downloading = false;
  message = '';
  
  repoStatus = {
    downloaded: false,
    files: 0
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadExistingConfig();
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
            this.checkRepoStatus(keys[0]);
          }
        },
        error: () => console.log('No config yet')
      });
  }

  saveConfig() {
    const repo_id = 'default'; // For now, single repo
    
    this.http.post('http://localhost:3000/api/config', {
      repo_id,
      github_repo: this.githubRepo,
      github_token: this.githubToken,
      firebase_project: this.firebaseProjectId,
      firebase_credentials: this.firebaseCredentials
    }).subscribe({
      next: () => {
        this.message = 'Configuration saved!';
        setTimeout(() => this.message = '', 3000);
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
          // Poll for status
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

  copyUrl() {
    navigator.clipboard.writeText('http://localhost:3000/api/webhook/firebase');
  }
}
