import { Component, OnInit, OnDestroy, effect, inject, signal, computed } from '@angular/core';
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
import { AuthService } from '../../../core/services/auth.service';

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
  private auth = inject(AuthService);

  historicalBase = signal<DashboardMetrics[]>([]);
  todayMetrics = signal<DashboardMetrics[]>([]);

  metrics = computed<DashboardMetrics[]>(() => {
    const hist = this.historicalBase();
    const live = this.todayMetrics();

    if (hist.length === 0) return live;
    if (live.length === 0) return hist;

    const result = hist.map((h, i) => {
      const l = live[i] || { receivedFto: 0, processedFto: 0, generatedBills: 0, forwardedToTreasury: 0, receivedByApprover: 0, rejectedByApprover: 0, systemLoad: 0, context: h.context };
      const merged = {
        ...h,
        receivedFto: (h.receivedFto || 0) + (l.receivedFto || 0),
        processedFto: (h.processedFto || 0) + (l.processedFto || 0),
        generatedBills: (h.generatedBills || 0) + (l.generatedBills || 0),
        forwardedToTreasury: (h.forwardedToTreasury || 0) + (l.forwardedToTreasury || 0),
        receivedByApprover: (h.receivedByApprover || 0) + (l.receivedByApprover || 0),
        rejectedByApprover: (h.rejectedByApprover || 0) + (l.rejectedByApprover || 0),
        systemLoad: l.systemLoad || h.systemLoad || 0
      };

      console.debug(`Pressure: Merged [${h.context}]`, {
        histRcvd: h.receivedFto,
        liveRcvd: l.receivedFto,
        total: merged.receivedFto
      });

      return merged;
    });

    return result;
  });

  systemLoad = signal<number>(0);
  cpu = signal<number>(0);
  ram = signal<number>(0);
  db = signal<number>(0);

  // Sparkline History (Limit to 20 points)
  resourceHistory = signal<{ cpu: number[], ram: number[], db: number[] }>({ cpu: [], ram: [], db: [] });

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
        console.debug('Pressure: Applying Pulse to Today Metrics', pulse);
        this.todayMetrics.update((prev: DashboardMetrics[]) => {
          const next = [...prev];
          const val = pulse;
          const scope = val.sc || 'Pulse';

          let idx = next.findIndex(m => m.context === scope);
          if (idx === -1) {
            next.push({ 
              receivedFto: 0, processedFto: 0, generatedBills: 0, forwardedToTreasury: 0, 
              receivedByApprover: 0, rejectedByApprover: 0, systemLoad: 0, context: scope 
            });
            idx = next.length - 1;
            // Keep Admin/Approver at top
            next.sort((a, b) => {
              if (a.context === 'Admin') return -1;
              if (b.context === 'Admin') return 1;
              if (a.context === 'Approver') return -1;
              if (b.context === 'Approver') return 1;
              return a.context.localeCompare(b.context);
            });
            idx = next.findIndex(m => m.context === scope);
          }

          const updated = { ...next[idx] };
          if (val.rf != null) updated.receivedFto = val.rf;
          if (val.pf != null) updated.processedFto = val.pf;
          if (val.gb != null) updated.generatedBills = val.gb;
          if (val.ar != null) updated.receivedByApprover = val.ar;
          if (val.rb != null) updated.rejectedByApprover = val.rb;
          if (val.ft != null) updated.forwardedToTreasury = val.ft;

          if (scope === 'Admin' && val.sl != null) {
            updated.systemLoad = val.sl;
          }

          next[idx] = updated;
          return next;
        });

        // RESOURCE UPDATE: Move outside of update() to prevent Signal Cycle/State errors
        if (pulse.sc === 'Admin') {
          if (pulse.sl != null) this.systemLoad.set(pulse.sl);
          if (pulse.c != null) this.cpu.set(pulse.c);
          if (pulse.m != null) this.ram.set(pulse.m);
          if (pulse.d != null) this.db.set(pulse.d);

          this.resourceHistory.update(h => ({
            cpu: [...h.cpu, pulse.c ?? 0].slice(-20),
            ram: [...h.ram, pulse.m ?? 0].slice(-20),
            db: [...h.db, pulse.d ?? 0].slice(-20)
          }));
        }

        this.triggerPulse(pulse.sc || 'Pulse');
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
    // Surgical Group Engagement: System Pressure
    const user = this.auth.currentUser();
    if (user) {
      const scope = user.role === 'Admin' ? 'Admin' : `DDO:${user.ddoCode}`;
      this.signalrService.joinGroup('Pressure', scope);
    }

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(today.getTime() - 1);

    import('rxjs').then(({ forkJoin }) => {
      forkJoin({
        hist: this.dashService.getComparison(fy, 'DDO001', 'DDO001_OP1', startDate, yesterdayEnd),
        live: this.dashService.getComparison(fy, 'DDO001', 'DDO001_OP1', today, new Date())
      }).subscribe(({ hist, live }) => {
        console.debug('Pressure: Split Comparison Loaded', { hist, live });
        this.historicalBase.set(hist);

        // MERGE LOGIC: Targeted scope merging for pressure component
        this.todayMetrics.update(curr => {
          if (!curr || curr.length === 0) return live;
          const next = [...curr];
          live.forEach((l, i) => {
            if (next[i]) {
              next[i] = {
                ...next[i],
                receivedFto: Math.max(next[i].receivedFto || 0, l.receivedFto || 0),
                processedFto: Math.max(next[i].processedFto || 0, l.processedFto || 0),
                generatedBills: Math.max(next[i].generatedBills || 0, l.generatedBills || 0),
                forwardedToTreasury: Math.max(next[i].forwardedToTreasury || 0, l.forwardedToTreasury || 0),
                receivedByApprover: Math.max(next[i].receivedByApprover || 0, l.receivedByApprover || 0),
                rejectedByApprover: Math.max(next[i].rejectedByApprover || 0, l.rejectedByApprover || 0),
                systemLoad: l.systemLoad || next[i].systemLoad || 0
              };
            } else {
              next[i] = l;
            }
          });
          return next;
        });

        if (live.length > 0) {
          this.systemLoad.set(live[0].systemLoad);
        } else if (hist.length > 0) {
          this.systemLoad.set(hist[0].systemLoad);
        }
      });
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

  getResourceChart(type: 'cpu' | 'ram' | 'db') {
    const history = this.resourceHistory()[type];
    const colors = {
      cpu: '#6366f1',
      ram: '#8b5cf6',
      db: '#ec4899'
    };

    return {
      labels: history.map((_, i) => i.toString()),
      datasets: [{
        data: history,
        borderColor: colors[type],
        backgroundColor: colors[type] + '22',
        fill: true,
        tension: 0.4,
        pointRadius: 0
      }]
    };
  }

  sparklineOptions = {
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    maintainAspectRatio: false
  };

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
