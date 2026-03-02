import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

interface Crash {
  id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  timestamp: string;
  prUrl?: string;
}

@Component({
  selector: 'app-crashes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-white">Crashes</h2>
          <p class="text-gray-400">All reported crashes</p>
        </div>
        
        <button (click)="refresh()" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-white">
          Refresh
        </button>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table class="w-full">
          <thead class="bg-gray-700">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Title</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Severity</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">Date</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">PR</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            @for (crash of crashes; track crash.id) {
              <tr class="hover:bg-gray-750">
                <td class="px-6 py-4">
                  <span class="px-2 py-1 rounded-full text-xs font-medium bg-yellow-400/20 text-yellow-400" *ngIf="crash.status === 'pending'">
                    {{ crash.status }}
                  </span>
                  <span class="px-2 py-1 rounded-full text-xs font-medium bg-green-400/20 text-green-400" *ngIf="crash.status === 'fixed'">
                    {{ crash.status }}
                  </span>
                  <span class="px-2 py-1 rounded-full text-xs font-medium bg-red-400/20 text-red-400" *ngIf="crash.status === 'failed'">
                    {{ crash.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-white">{{ crash.title }}</td>
                <td class="px-6 py-4">
                  <span class="text-sm text-red-400" *ngIf="crash.severity === 'ERROR'">{{ crash.severity }}</span>
                  <span class="text-sm text-yellow-400" *ngIf="crash.severity === 'WARNING'">{{ crash.severity }}</span>
                  <span class="text-sm text-blue-400" *ngIf="crash.severity === 'INFO'">{{ crash.severity }}</span>
                </td>
                <td class="px-6 py-4 text-gray-400 text-sm">{{ crash.timestamp | date:'short' }}</td>
                <td class="px-6 py-4">
                  <a *ngIf="crash.prUrl" [href]="crash.prUrl" target="_blank" class="text-primary-400 hover:text-primary-300">
                    View PR →
                  </a>
                  <span *ngIf="!crash.prUrl" class="text-gray-500">—</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
        
        <div class="p-8 text-center text-gray-500" *ngIf="crashes.length === 0">
          No crashes recorded yet
        </div>
      </div>
    </div>
  `
})
export class CrashesComponent implements OnInit {
  crashes: Crash[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadCrashes();
  }

  loadCrashes() {
    this.http.get<Crash[]>('http://localhost:3000/api/crashes')
      .subscribe({
        next: (crashes: Crash[]) => this.crashes = crashes.reverse(),
        error: () => console.log('Backend not available')
      });
  }

  refresh() {
    this.loadCrashes();
  }
}
