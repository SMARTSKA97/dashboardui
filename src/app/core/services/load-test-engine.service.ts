import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface LoadTestMetrics {
  status: string;
  rps: number;
  avgLatency: number;
  dbTimeMs: number;
  apiTimeMs: number;
  successCount: number;
  errorCount: number;
  activeWorkers: number;
  bottleneck: string;
}

@Injectable({
  providedIn: 'root'
})
export class LoadTestEngineService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/LoadTest`;

  status = signal<LoadTestMetrics | null>(null);

  start(concurrency: number = 5, autoScale: boolean = false) {
    return this.http.post(`${this.apiUrl}/start?concurrency=${concurrency}&autoScale=${autoScale}`, {});
  }

  stop() {
    return this.http.post(`${this.apiUrl}/stop`, {});
  }

  getStatus() {
    return this.http.get<LoadTestMetrics>(`${this.apiUrl}/status`).subscribe(res => {
      this.status.set(res);
    });
  }
}
