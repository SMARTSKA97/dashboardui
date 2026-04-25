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

  // NEW: Hierarchical Selection System
  rangeType = signal<'FinancialYear' | 'Quarter' | 'Month' | 'Daily'>('FinancialYear');
  
  fyOptions = signal<{label: string, value: number}[]>([]);
  quarterOptions = [
    { label: 'Q1 (Apr-Jun)', value: 1 },
    { label: 'Q2 (Jul-Sep)', value: 2 },
    { label: 'Q3 (Oct-Dec)', value: 3 },
    { label: 'Q4 (Jan-Mar)', value: 4 }
  ];
  monthOptions = signal<{label: string, value: number}[]>([]);

  selectedFY = signal<number>(2627);
  selectedQuarter = signal<number>(1);
  selectedMonth = signal<number>(4);
  selectedDate = signal<Date>(new Date());

  activeFlashKpis = signal<Set<string>>(new Set());
  countdownTimer = computed(() => this.dashService.activeStatus()?.remaining_seconds ?? 0);
  canShowManualControls = computed(() => this.auth.currentUser()?.role === 'Admin');

  chartData: any;
  chartOptions = {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#ebedef' } } }
  };

  private activeGroup: { target: string, scope: string } | null = null;
  private midnightTimer: any;
  private syncPoller: any;

  isRealTimeApplicable = computed(() => {
    const type = this.rangeType();
    const fy = this.selectedFY();
    const today = new Date();
    
    // Check if current date falls within selected FY
    const startYear = 2000 + Math.floor(fy / 100);
    const fyStart = new Date(startYear, 3, 1);
    const fyEnd = new Date(startYear + 1, 2, 31, 23, 59, 59);
    const inFy = today >= fyStart && today <= fyEnd;

    if (!inFy) return false;
    if (type === 'FinancialYear') return true;

    if (type === 'Quarter') {
      const q = this.selectedQuarter();
      const currentMonth = today.getMonth() + 1;
      const currentQ = currentMonth >= 4 && currentMonth <= 6 ? 1 : 
                       currentMonth >= 7 && currentMonth <= 9 ? 2 :
                       currentMonth >= 10 && currentMonth <= 12 ? 3 : 4;
      return q === currentQ;
    }

    if (type === 'Month') {
      return (this.selectedMonth() === (today.getMonth() + 1));
    }

    if (type === 'Daily') {
      const sel = this.selectedDate();
      return sel.getDate() === today.getDate() && sel.getMonth() === today.getMonth() && sel.getFullYear() === today.getFullYear();
    }

    return false;
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

        if (pulse.rf !== undefined) this.triggerFlash('FTO_RCVD');
        if (pulse.pf !== undefined || pulse.gb !== undefined) this.triggerFlash('FTO_PROCESSED,BILL_GEN');
        if (pulse.ar !== undefined) this.triggerFlash('APP_RCVD');
        if (pulse.ft !== undefined) this.triggerFlash('BILL_FWD');
        if (pulse.rb !== undefined) this.triggerFlash('BILL_REJ');
      }
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
    this.initPeriodOptions();
    this.bootDashboard();
    this.setupRealTime();
    this.setupMidnightRollOver();
    this.setupSyncPoller();
  }

  private initPeriodOptions() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    
    // FY Options
    const fys = [];
    for (let i = 0; i < 3; i++) {
        const y = (currentYear - i) % 100;
        const fy = currentMonth >= 4 ? (y * 100) + (y + 1) : ((y - 1) * 100) + y;
        fys.push({ label: `FY 20${Math.floor(fy/100)}-${fy%100}`, value: fy });
    }
    this.fyOptions.set(fys);
    this.selectedFY.set(fys[0].value);

    // Month Options
    const months = [
        { label: 'April', value: 4 }, { label: 'May', value: 5 }, { label: 'June', value: 6 },
        { label: 'July', value: 7 }, { label: 'August', value: 8 }, { label: 'September', value: 9 },
        { label: 'October', value: 10 }, { label: 'November', value: 11 }, { label: 'December', value: 12 },
        { label: 'January', value: 1 }, { label: 'February', value: 2 }, { label: 'March', value: 3 }
    ];
    this.monthOptions.set(months);

    // Default to current selection
    this.selectedMonth.set(currentMonth);
    this.selectedQuarter.set(currentMonth >= 4 && currentMonth <= 6 ? 1 : 
                         currentMonth >= 7 && currentMonth <= 9 ? 2 :
                         currentMonth >= 10 && currentMonth <= 12 ? 3 : 4);
    
    this.refreshMetrics();
  }

  private setupSyncPoller() {
    this.syncPoller = setInterval(async () => {
      const didReconnect = await this.signalr.checkAndReconnect();
      if (didReconnect) this.refreshMetrics();
    }, environment.signalR.pollerIntervalMs);
  }

  private setupMidnightRollOver() {
    this.midnightTimer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) this.refreshMetrics();
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

  onSelectionChange() {
    this.refreshMetrics();
  }

  refreshMetrics() {
    const user = this.auth.currentUser();
    if (!user) return;

    const fy = this.selectedFY();
    const type = this.rangeType();
    let start: Date, end: Date;

    const startYear = 2000 + Math.floor(fy / 100);
    switch (type) {
        case 'FinancialYear':
            start = new Date(startYear, 3, 1);
            end = new Date(startYear + 1, 2, 31, 23, 59, 59);
            break;
        case 'Quarter':
            const q = this.selectedQuarter();
            if (q === 1) { start = new Date(startYear, 3, 1); end = new Date(startYear, 5, 30, 23, 59, 59); }
            else if (q === 2) { start = new Date(startYear, 6, 1); end = new Date(startYear, 8, 30, 23, 59, 59); }
            else if (q === 3) { start = new Date(startYear, 9, 1); end = new Date(startYear, 11, 31, 23, 59, 59); }
            else { start = new Date(startYear + 1, 0, 1); end = new Date(startYear + 1, 2, 31, 23, 59, 59); }
            break;
        case 'Month':
            const m = this.selectedMonth();
            const year = m <= 3 ? startYear + 1 : startYear;
            start = new Date(year, m - 1, 1);
            end = new Date(year, m, 0, 23, 59, 59);
            break;
        case 'Daily':
            start = new Date(this.selectedDate()); start.setHours(0,0,0,0);
            end = new Date(this.selectedDate()); end.setHours(23,59,59,999);
            break;
    }

    this.dashService.getSmartMetrics(fy, user.ddoCode || '', user.userId, type, start, end).subscribe(res => {
        // Map the correct role from the array
        const role = user.role;
        const metrics = res.find(m => m.context === role) || res[0];
        
        const isLive = this.isRealTimeApplicable();
        if (isLive) {
            this.historicalBase.set(null); // Smart API already merged historical + today on backend
            this.todayMetrics.set(metrics);
        } else {
            this.historicalBase.set(metrics);
            this.todayMetrics.set(null);
        }
    });
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
