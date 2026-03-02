import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
                     placeholder="https://github.com/user/repo"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500">
            </div>
            
            <div>
              <label class="block text-gray-400 text-sm mb-2">GitHub Token</label>
              <input type="password" 
                     [(ngModel)]="githubToken"
                     placeholder="ghp_xxxxx"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500">
            </div>
          </div>
        </div>

        <!-- Firebase Config -->
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 class="text-lg font-semibold text-white mb-4">Firebase Project</h3>
          
          <div class="space-y-4">
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
                     rows="4"
                     class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary-500 font-mono text-sm"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- Save Button -->
      <div class="flex justify-end">
        <button (click)="saveConfig()"
                class="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
          Save Configuration
        </button>
      </div>

      <!-- Webhook URL -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold text-white mb-4">Firebase Webhook URL</h3>
        <p class="text-gray-400 text-sm mb-4">
          Configure this URL in Firebase Crashlytics to receive crash notifications:
        </p>
        <div class="flex items-center space-x-2">
          <code class="bg-gray-700 px-4 py-2 rounded text-primary-400 flex-1">
            http://YOUR_IP:3000/api/webhook/firebase
          </code>
          <button (click)="copyUrl()" 
                  class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-white transition-colors">
            Copy
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfigComponent {
  githubRepo = '';
  githubToken = '';
  firebaseProjectId = '';
  firebaseCredentials = '';

  saveConfig() {
    // TODO: Save to backend
    console.log('Saving config...');
  }

  copyUrl() {
    navigator.clipboard.writeText('http://localhost:3000/api/webhook/firebase');
  }
}
