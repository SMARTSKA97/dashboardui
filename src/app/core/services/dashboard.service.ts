import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { tap } from 'rxjs';

/**
 * Universal Source of Truth Model (Dynamic FY Support)
 */
export interface DashboardStatus {
  is_allowed: boolean;
  last_refresh_at: string | null;
  next_refresh_at: string;
  remaining_seconds: number;
  message: string;
  current_fy: number;      // e.g., 2627
  fiscal_year_label: string; // e.g., "FY 2026-27"
}

export interface DashboardPulse {
  sc?: string; // scope
  rf?: number; // rcvdFto
  pf?: number; // procFto
  gb?: number; // genBill
  ft?: number; // fwdTrz
  ar?: number; // appRcvd
  rb?: number; // rejBill
  sl?: number; // systemLoad
  c?: number;  // cpu
  m?: number;  // mem
  d?: number;  // db
}

export interface DashboardMetrics {
  receivedFto: number;
  processedFto: number;
  generatedBills: number;
  forwardedToTreasury: number;
  receivedByApprover: number;
  rejectedByApprover: number;
  systemLoad: number;
  cpu?: number;
  mem?: number;
  db?: number;
  context: string;
  lastUpdateEvent?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/Dashboard`;

  // Global Reactive State: Source of Truth for Fiscal Identity
  activeStatus = signal<DashboardStatus | null>(null);
  activeFy = computed(() => this.activeStatus()?.current_fy ?? 2627);
  activeFyLabel = computed(() => this.activeStatus()?.fiscal_year_label ?? 'FY 2026-27');

  private timerHandle: any;

  /**
   * Source of Truth: Fetch current system state from Backend (Dynamic FY included)
   */
  getStatus() {
    return this.http.get<DashboardStatus>(`${this.apiUrl}/status`).pipe(
      tap(status => {
        this.activeStatus.set(status);
        this.startLocalTicker();
      })
    );
  }

  private startLocalTicker() {
    if (this.timerHandle) clearInterval(this.timerHandle);

    this.timerHandle = setInterval(() => {
      const status = this.activeStatus();
      if (status && status.remaining_seconds > 0) {
        this.activeStatus.set({
          ...status,
          remaining_seconds: Math.max(0, status.remaining_seconds - 1)
        });

        // Auto-Sync when cooldown expires
        if (this.activeStatus()?.remaining_seconds === 0) {
          this.getStatus().subscribe();
        }
      } else if (status && status.remaining_seconds === 0 && !status.is_allowed) {
        // Guard for edge cases where backend hasn't updated yet
        clearInterval(this.timerHandle);
      }
    }, 1000);
  }

  getMetrics(fy: number, start: Date, end: Date) {
    const params = new HttpParams()
      .set('fy', fy)
      .set('start', start.toISOString())
      .set('end', end.toISOString());

    return this.http.get<DashboardMetrics>(`${this.apiUrl}/metrics`, { params });
  }

  refreshBaseline() {
    return this.http.post(`${this.apiUrl}/refresh-baseline`, {});
  }

  getComparison(fy: number, ddoCode: string, userid: string, start: Date, end: Date) {
    const params = new HttpParams()
      .set('fy', fy)
      .set('ddoCode', ddoCode)
      .set('userid', userid)
      .set('start', start.toISOString())
      .set('end', end.toISOString());

    return this.http.get<DashboardMetrics[]>(`${this.apiUrl}/comparison`, { params });
  }

  // Simulation Methods
  seedFtos(count: number = 10) {
    return this.http.post(`${environment.apiUrl}/Simulation/seed?count=${count}`, {});
  }

  autoBill() {
    return this.http.post(`${environment.apiUrl}/Simulation/auto-bill`, {});
  }

  runCycle() {
    return this.http.post(`${environment.apiUrl}/Simulation/run-cycle`, {});
  }

  getMetricsGap(groupName: string, lastId: number, currentId: number) {
    const params = new HttpParams()
      .set('groupName', groupName)
      .set('lastId', lastId)
      .set('currentId', currentId);

    return this.http.get<any[]>(`${this.apiUrl}/metrics-gap`, { params });
  }
}
