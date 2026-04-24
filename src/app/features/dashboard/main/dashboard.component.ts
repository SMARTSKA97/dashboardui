import { Component, OnInit, OnDestroy, signal, effect, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { Card } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { Tag } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';

import { DashboardService, DashboardMetrics } from '../../../core/services/dashboard.service';
import { SignalrService } from '../../../core/services/signalr.service';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

interface KpiCard {
  id: string;
  title: string;
  value: number;
  icon: string;
  trend: number;
  flashing: boolean;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, Card, ChartModule, Select, DatePicker, Tag, TooltipModule, ButtonModule, MessageModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  public dashService = inject(DashboardService);
  private signalr = inject(SignalrService);
  public auth = inject(AuthService);

  // Elite Split-Snapshot State
  historicalBase = signal<DashboardMetrics | null>(null);
  todayMetrics = signal<DashboardMetrics | null>(null);

  metrics = computed<DashboardMetrics | null>(() => {
    const base = this.historicalBase();
    const live = this.todayMetrics();
    if (!base && !live) return null;
    const b = base || { receivedFto: 0, processedFto: 0, generatedBills: 0, forwardedToTreasury: 0, receivedByApprover: 0, rejectedByApprover: 0, systemLoad: 0, context: '' };
    const l = live || { receivedFto: 0, processedFto: 0, generatedBills: 0, forwardedToTreasury: 0, receivedByApprover: 0, rejectedByApprover: 0, systemLoad: 0, context: '' };
    const res = {
      receivedFto: (b.receivedFto || 0) + (l.receivedFto || 0),
      processedFto: (b.processedFto || 0) + (l.processedFto || 0),
      generatedBills: (b.generatedBills || 0) + (l.generatedBills || 0),
      forwardedToTreasury: (b.forwardedToTreasury || 0) + (l.forwardedToTreasury || 0),
      receivedByApprover: (b.receivedByApprover || 0) + (l.receivedByApprover || 0),
      rejectedByApprover: (b.rejectedByApprover || 0) + (l.rejectedByApprover || 0),
      systemLoad: l.systemLoad || b.systemLoad || 0,
      context: l.context || b.context || ''
    };
    
    console.debug('Dashboard: Computed Metrics Result', { 
      historical: b.receivedFto, 
      todayLive: l.receivedFto, 
      final: res.receivedFto 
    });
    
    return res;
  });

  // UI Restoration Properties
  dateRange = signal<Date[]>([new Date(), new Date()]);
  selectedPreset = 'year';
  datePresets = [
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'week' },
    { label: 'This Month', value: 'month' },
    { label: 'Q1 (Apr-Jun)', value: 'q1' },
    { label: 'Q2 (Jul-Sep)', value: 'q2' },
    { label: 'Q3 (Oct-Dec)', value: 'q3' },
    { label: 'Q4 (Jan-Mar)', value: 'q4' },
    { label: 'Full Financial Year', value: 'year' }
  ];

  activeFlashKpis = signal<Set<string>>(new Set());
  countdownTimer = computed(() => this.dashService.activeStatus()?.remaining_seconds ?? 0);
  canShowManualControls = computed(() => this.auth.currentUser()?.role === 'Admin');

  // Adaptive DatePicker States
  datepickerView = signal<'date' | 'month' | 'year'>('date');
  datepickerFormat = signal<string>('dd/mm/yy');
  selectionMode = signal<'single' | 'range'>('range');
  isQuarterMode = signal<boolean>(false);
  selectedQuarter = signal<string>('q1');

  quarters = [
    { label: 'Q1 (Apr-Jun)', value: 'q1' },
    { label: 'Q2 (Jul-Sep)', value: 'q2' },
    { label: 'Q3 (Oct-Dec)', value: 'q3' },
    { label: 'Q4 (Jan-Mar)', value: 'q4' }
  ];

  chartData: any;
  chartOptions = {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#ebedef' } } }
  };

  private activeGroup: { target: string, scope: string } | null = null;
  private midnightTimer: any;
  private syncPoller: any;

  isRealTimeApplicable = computed(() => {
    const range = this.dateRange();
    if (!range || !range[0]) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(range[0]); start.setHours(0, 0, 0, 0);
    const end = range[1] ? new Date(range[1]) : new Date(range[0]); end.setHours(0, 0, 0, 0);
    return today.getTime() >= start.getTime() && today.getTime() <= end.getTime();
  });

  kpiData = computed<KpiCard[]>(() => {
    const m = this.metrics();
    if (!m) return [];
    const isLive = this.isRealTimeApplicable();
    const activeFlashing = this.activeFlashKpis();
    return [
      { id: 'FTO_RCVD', title: 'FTO Received', value: m.receivedFto, icon: 'pi pi-download', trend: 12, flashing: isLive && activeFlashing.has('FTO_RCVD'), color: '#6366f1' },
      { id: 'FTO_PROCESSED', title: 'FTO Processed', value: m.processedFto, icon: 'pi pi-cog', trend: 8, flashing: isLive && (activeFlashing.has('BILL_GEN') || activeFlashing.has('FTO_PROCESSED')), color: '#a855f7' },
      { id: 'BILL_GEN', title: 'Generated Bills', value: m.generatedBills, icon: 'pi pi-file', trend: 5, flashing: isLive && activeFlashing.has('BILL_GEN'), color: '#3b82f6' },
      { id: 'BILL_FWD', title: 'Treasury Forwarded', value: m.forwardedToTreasury, icon: 'pi pi-send', trend: 15, flashing: isLive && activeFlashing.has('BILL_FWD'), color: '#22c55e' },
      { id: 'APP_RCVD', title: 'Approver Rcvd', value: m.receivedByApprover, icon: 'pi pi-eye', trend: -2, flashing: isLive && activeFlashing.has('BILL_FWD'), color: '#f59e0b' },
      { id: 'BILL_REJ', title: 'Rejected', value: m.rejectedByApprover, icon: 'pi pi-times-circle', trend: -10, flashing: isLive && activeFlashing.has('BILL_REJ'), color: '#ef4444' }
    ];
  });

  constructor() {
    effect(() => {
      const pulse = this.signalr.updates$();

      // ENTERPRISE GATING: Optimized Pulse Handling
      if (pulse && this.isRealTimeApplicable()) {
        console.debug('Dashboard: Applying SignalR Pulse to Today Metrics', pulse);
        this.todayMetrics.update(curr => {
          const next = curr ? { ...curr } : { 
            receivedFto: 0, processedFto: 0, generatedBills: 0, forwardedToTreasury: 0, 
            receivedByApprover: 0, rejectedByApprover: 0, systemLoad: 0, context: pulse.sc || 'Pulse' 
          };

          if (pulse.rf != null) next.receivedFto = pulse.rf;
          if (pulse.pf != null) next.processedFto = pulse.pf;
          if (pulse.gb != null) next.generatedBills = pulse.gb;
          if (pulse.ft != null) next.forwardedToTreasury = pulse.ft;
          if (pulse.ar != null) next.receivedByApprover = pulse.ar;
          if (pulse.rb != null) next.rejectedByApprover = pulse.rb;
          if (pulse.sl != null) next.systemLoad = pulse.sl;

          return next;
        });

        // Deduce Flash Keys from Payload (Zero-Metadata Approach)
        if (pulse.rf !== undefined) this.triggerFlash('FTO_RCVD');
        if (pulse.pf !== undefined || pulse.gb !== undefined) this.triggerFlash('FTO_PROCESSED,BILL_GEN');
        if (pulse.ar !== undefined) this.triggerFlash('APP_RCVD');
        if (pulse.ft !== undefined) this.triggerFlash('BILL_FWD');
        if (pulse.rb !== undefined) this.triggerFlash('BILL_REJ');
      }
    });

    effect(() => {
      if (this.dashService.activeFy()) this.onPresetChange();
    });

    effect(() => {
      const m = this.metrics();
      if (m) {
        this.chartData = {
          labels: ['FTO Rcvd', 'FTO Proc', 'Generated', 'T-Forward', 'App Rcvd', 'Rejected'],
          datasets: [{ data: [m.receivedFto, m.processedFto, m.generatedBills, m.forwardedToTreasury, m.receivedByApprover, m.rejectedByApprover], backgroundColor: ['#6366f1', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444'] }]
        };
      }
    });
  }

  ngOnInit() {
    this.bootDashboard();
    this.setupRealTime();
    this.setupMidnightRollOver();
    this.setupSyncPoller();
  }

  private setupSyncPoller() {
    // 5-minute Heartbeat Monitor
    this.syncPoller = setInterval(async () => {
      console.log('Background Sync Poller: Checking connection heartbeat...');
      const didReconnect = await this.signalr.checkAndReconnect();
      if (didReconnect) {
        console.log('Background Sync Poller: Restoring Snapshot Integrity...');
        this.refreshMetrics();
      }
    }, environment.signalR.pollerIntervalMs);
  }

  private setupMidnightRollOver() {
    this.midnightTimer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) this.onPresetChange();
    }, 60000);
  }

  private bootDashboard() {
    this.dashService.getStatus().subscribe();
  }

  ngOnDestroy() {
    this.cleanupRealTime();
    if (this.midnightTimer) clearInterval(this.midnightTimer);
    if (this.syncPoller) clearInterval(this.syncPoller);
  }

  private setupRealTime() {
    const user = this.auth.currentUser();
    if (!user) return;
    const scope = user.role === 'Admin' ? 'Admin' : (user.role === 'Approver' ? `DDO:${user.ddoCode}` : `DDO:${user.ddoCode}:OP:${user.userId}`);
    this.activeGroup = { target: 'Dashboard', scope: scope };
    this.signalr.joinGroup(this.activeGroup.target, this.activeGroup.scope);
  }

  private cleanupRealTime() {
    if (this.activeGroup) this.signalr.leaveGroup(this.activeGroup.target, this.activeGroup.scope);
  }

  onPresetChange() {
    const now = new Date();
    let start = new Date();
    let end = new Date();
    const fyId = this.dashService.activeFy();
    const startYear = 2000 + Math.floor(fyId / 100);

    // Reset Adaptive UI States
    this.isQuarterMode.set(false);
    this.datepickerView.set('date');
    this.datepickerFormat.set('dd/mm/yy');
    this.selectionMode.set('range');

    switch (this.selectedPreset) {
      case 'today':
        this.selectionMode.set('single');
        this.datepickerView.set('date');
        this.datepickerFormat.set('dd/mm/yy');
        this.dateRange.set([now]);
        break;
      case 'week':
        start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0); break;
      case 'month':
        this.datepickerView.set('month');
        this.datepickerFormat.set('mm/yy');
        this.selectionMode.set('single');
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'q1': case 'q2': case 'q3': case 'q4':
        this.isQuarterMode.set(true);
        this.datepickerView.set('year');
        this.datepickerFormat.set('yy');
        this.selectedQuarter.set(this.selectedPreset);
        this.selectionMode.set('single');
        this.applyQuarterRange(startYear, this.selectedPreset);
        return;
      default:
        start = new Date(startYear, 3, 1); end = new Date(startYear + 1, 2, 31, 23, 59, 59); break;
    }

    const maxEnd = now.getTime() < end.getTime() ? now : end;
    this.dateRange.set([start, maxEnd]);
    this.refreshMetrics();
  }

  onQuarterSelected() {
    const fyId = this.dashService.activeFy();
    const startYear = 2000 + Math.floor(fyId / 100);
    this.applyQuarterRange(startYear, this.selectedQuarter());
  }

  private applyQuarterRange(startYear: number, q: string) {
    let start: Date, end: Date;
    switch (q) {
      case 'q1': start = new Date(startYear, 3, 1); end = new Date(startYear, 5, 30, 23, 59, 59); break;
      case 'q2': start = new Date(startYear, 6, 1); end = new Date(startYear, 8, 30, 23, 59, 59); break;
      case 'q3': start = new Date(startYear, 9, 1); end = new Date(startYear, 11, 31, 23, 59, 59); break;
      case 'q4': start = new Date(startYear + 1, 0, 1); end = new Date(startYear + 1, 2, 31, 23, 59, 59); break;
      default: return;
    }
    this.dateRange.set([start, end]);
    this.refreshMetrics();
  }

  refreshMetrics() {
    const fy = this.dashService.activeFy();
    const range = this.dateRange();
    const start = range[0];
    const end = range[1] || new Date();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    if (this.isRealTimeApplicable()) {
      const yesterdayEnd = new Date(today.getTime() - 1);
      forkJoin({
        hist: this.dashService.getMetrics(fy, start, yesterdayEnd),
        live: this.dashService.getMetrics(fy, today, end)
      }).subscribe(({ hist, live }) => {
        console.debug('Dashboard: Split Metrics Loaded', { hist, live });
        this.historicalBase.set(hist);
        
        // MERGE LOGIC: Prevent overwriting live SignalR data with stale API data
        this.todayMetrics.update(curr => {
          if (!curr || !live) return live;
          return {
            ...curr,
            receivedFto: Math.max(curr.receivedFto || 0, live.receivedFto || 0),
            processedFto: Math.max(curr.processedFto || 0, live.processedFto || 0),
            generatedBills: Math.max(curr.generatedBills || 0, live.generatedBills || 0),
            forwardedToTreasury: Math.max(curr.forwardedToTreasury || 0, live.forwardedToTreasury || 0),
            receivedByApprover: Math.max(curr.receivedByApprover || 0, live.receivedByApprover || 0),
            rejectedByApprover: Math.max(curr.rejectedByApprover || 0, live.rejectedByApprover || 0),
            systemLoad: live.systemLoad || curr.systemLoad || 0,
            context: live.context || curr.context || ''
          };
        });
      });
    } else {
      this.dashService.getMetrics(fy, start, end).subscribe(m => {
        this.historicalBase.set(m);
        this.todayMetrics.set(null);
      });
    }
  }

  refreshBaseline() {
    this.dashService.refreshBaseline().subscribe(() => this.bootDashboard());
  }

  private triggerFlash(event: string) {
    if (!event) return;
    const events = event.split(',');
    this.activeFlashKpis.update(set => { events.forEach(e => set.add(e)); return new Set(set); });
    setTimeout(() => this.activeFlashKpis.update(set => { events.forEach(e => set.delete(e)); return new Set(set); }), 1500);
  }
}
