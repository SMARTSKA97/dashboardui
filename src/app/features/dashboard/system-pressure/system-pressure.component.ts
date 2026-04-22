import { Component, OnInit, OnDestroy, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { DashboardService, DashboardMetrics } from '../../../core/services/dashboard.service';
import { Card } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { Tag } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { environment } from '../../../../environments/environment';
import { SignalrService } from '../../../core/services/signalr.service';

@Component({
  selector: 'app-system-pressure',
  standalone: true,
  imports: [CommonModule, Card, ButtonModule, ChartModule, Tag, TooltipModule],
  templateUrl: './system-pressure.component.html',
  styleUrl: './system-pressure.component.scss'
})
export class SystemPressureComponent implements OnInit, OnDestroy {
  private dashService = inject(DashboardService);
  private signalrService = inject(SignalrService);

  metrics = signal<DashboardMetrics[]>([]);
  systemLoad = signal<number>(0);
  isSimulating = signal<boolean>(false);

  // Real-time update tracker for "pulse" effect
  pulseStates = signal<Record<string, boolean>>({});

  private syncPoller: any;

  constructor() {
    // Reactive Pulse Engine: Targeted Chart Synchronization
    effect(() => {
      const pulse = this.signalrService.pressureUpdates$();
      const status = this.dashService.activeStatus();

      // Targeted Pressure Monitoring (Independent from KPI traffic)
      if (pulse && status) {
        this.metrics.update((prev: DashboardMetrics[]) => {
          if (prev.length < 3) return prev;
          const next = [...prev];
          const val = pulse;

          // SCOPE INDEXING: Precise mapping for large-scale dashboard
          let idx = -1;
          const scope = val.sc;
          if (scope === 'Admin') idx = 0;
          else if (scope === 'Approver') idx = 1;
          else if (scope === 'Operator') idx = 2;

          if (idx !== -1) {
            const current = next[idx];
            const updated = { ...current };

            // MERGE DELTA: No API call needed
            if (val.rf !== undefined) updated.receivedFto = val.rf;
            if (val.pf !== undefined) updated.processedFto = val.pf;
            if (val.gb !== undefined) updated.generatedBills = val.gb;
            if (val.ar !== undefined) updated.receivedByApprover = val.ar;
            if (val.rb !== undefined) updated.rejectedByApprover = val.rb;
            if (val.ft !== undefined) updated.forwardedToTreasury = val.ft;

            if (scope === 'Admin' && val.sl !== undefined) {
              this.systemLoad.set(val.sl);
              updated.systemLoad = val.sl;
            }

            next[idx] = updated;
          }

          return next;
        });
        this.triggerPulse((pulse.sc || 'Pulse').toLowerCase());
      }
    });

    // Reactive Load: Refresh data when global FY changes
    effect(() => {
      if (this.dashService.activeStatus()) {
        this.loadData();
      }
    });
  }

  ngOnInit() {
    // Surgical Group Engagement
    this.signalrService.joinGroup('Pressure', 'Admin');
    this.signalrService.joinGroup('Dashboard', 'Admin');
    this.signalrService.joinGroup('Dashboard', 'DDO:DDO001');
    this.signalrService.joinGroup('Dashboard', 'DDO:DDO001:OP:DDO001_OP1');

    this.syncPoller = setInterval(async () => {
      console.log('System Pressure Poller: Checking connection heartbeat...');
      const didReconnect = await this.signalrService.checkAndReconnect();
      if (didReconnect) {
        console.log('System Pressure Poller: Syncing Truth...');
        this.loadData();
      }
    }, environment.signalR.pollerIntervalMs);
  }

  ngOnDestroy() {
    this.stopSimulation();
    this.signalrService.leaveGroup('Pressure', 'Admin');
    this.signalrService.leaveGroup('Dashboard', 'Admin');
    this.signalrService.leaveGroup('Dashboard', 'DDO:DDO001');
    this.signalrService.leaveGroup('Dashboard', 'DDO:DDO001:OP:DDO001_OP1');
    if (this.syncPoller) clearInterval(this.syncPoller);
  }

  loadData() {
    const fy = this.dashService.activeFy();
    // Dynamic Date Mapping
    const startYear = 2000 + Math.floor(fy / 100);
    const startDate = new Date(startYear, 3, 1);

    this.dashService.getComparison(fy, 'DDO001', 'DDO001_OP1', startDate, new Date()).subscribe(res => {
      this.metrics.set(res);
      if (res.length > 0) {
        this.systemLoad.set(res[0].systemLoad);
      }
    });
  }

  private pulseTimeouts = new Map<string, any>();

  triggerPulse(key: string) {
    if (this.pulseTimeouts.has(key)) {
      clearTimeout(this.pulseTimeouts.get(key));
    }

    this.pulseStates.update((s: Record<string, boolean>) => ({ ...s, [key]: true }));
    const timeout = setTimeout(() => {
      this.pulseStates.update((s: Record<string, boolean>) => ({ ...s, [key]: false }));
      this.pulseTimeouts.delete(key);
    }, 1000);

    this.pulseTimeouts.set(key, timeout);
  }

  startSimulation() {
    this.isSimulating.set(true);
    this.runCycle();
  }

  stopSimulation() {
    this.isSimulating.set(false);
  }

  runCycle() {
    if (!this.isSimulating()) return;

    this.dashService.runCycle().subscribe({
      next: () => {
        setTimeout(() => this.runCycle(), 2000);
      },
      error: () => this.isSimulating.set(false)
    });
  }

  getLoadColor() {
    const load = this.systemLoad();
    if (load < 50) return 'success';
    if (load < 150) return 'warn';
    return 'danger';
  }

  getChartData(m: DashboardMetrics) {
    return {
      labels: ['Processed', 'Backlog'],
      datasets: [
        {
          data: [m.processedFto, m.receivedFto - m.processedFto],
          backgroundColor: ['#4ade80', '#f87171'],
          hoverBackgroundColor: ['#22c55e', '#ef4444']
        }
      ]
    };
  }

  chartOptions = {
    plugins: {
      legend: { display: false }
    },
    cutout: '70%'
  };

  private mapMetricField(ev: string): string {
    switch (ev) {
      case 'FTO_RCVD': return 'receivedFto';
      case 'FTO_PROCESSED': return 'processedFto';
      case 'BILL_GEN': return 'generatedBills';
      case 'BILL_FWD': return 'forwardedToTreasury';
      case 'BILL_REJ': return 'rejectedByApprover';
      default: return 'receivedFto';
    }
  }
}
