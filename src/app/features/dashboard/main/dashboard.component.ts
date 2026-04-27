import { Component, OnInit, OnDestroy, signal, effect, computed, inject, untracked } from '@angular/core';
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
  liveOverwrites = signal<DashboardMetrics | null>(null);

  metrics = computed<DashboardMetrics | null>(() => {
    const base = this.historicalBase();
    const live = this.liveOverwrites();
    
    if (!base) return null;

    // BASELINE: The total amount before "today" started (or before this session's pulse)
    // We calculate this by subtracting the "Today" portion returned by the API
    const baseline = {
      receivedFto: base.receivedFto - (base.todayReceivedFto || 0),
      processedFto: base.processedFto - (base.todayProcessedFto || 0),
      generatedBills: base.generatedBills - (base.todayGeneratedBills || 0),
      forwardedToTreasury: base.forwardedToTreasury - (base.todayForwardedToTreasury || 0),
      receivedByApprover: base.receivedByApprover - (base.todayReceivedByApprover || 0),
      rejectedByApprover: base.rejectedByApprover - (base.todayRejectedByApprover || 0),
      billAmount: Number(base.billAmount) - Number(base.todayBillAmount || 0),
      forwardedAmount: Number(base.forwardedAmount) - Number(base.todayForwardedAmount || 0),
      ftoAmount: Number(base.ftoAmount) - Number(base.todayFtoAmount || 0)
    };

    // If not in real-time mode, just return the base total
    if (!this.isRealTimeApplicable()) return base;

    // LIVE: Use either the SignalR pulse total for today, or the API's today total if no pulse yet
    const today = live || {
      receivedFto: base.todayReceivedFto || 0,
      processedFto: base.todayProcessedFto || 0,
      generatedBills: base.todayGeneratedBills || 0,
      forwardedToTreasury: base.todayForwardedToTreasury || 0,
      receivedByApprover: base.todayReceivedByApprover || 0,
      rejectedByApprover: base.todayRejectedByApprover || 0,
      billAmount: base.todayBillAmount || 0,
      forwardedAmount: base.todayForwardedAmount || 0,
      ftoAmount: base.todayFtoAmount || 0,
      systemLoad: base.systemLoad || 0,
      context: base.context || ''
    };

    return {
      ...base,
      receivedFto: baseline.receivedFto + today.receivedFto,
      processedFto: baseline.processedFto + today.processedFto,
      generatedBills: baseline.generatedBills + today.generatedBills,
      forwardedToTreasury: baseline.forwardedToTreasury + today.forwardedToTreasury,
      receivedByApprover: baseline.receivedByApprover + today.receivedByApprover,
      rejectedByApprover: baseline.rejectedByApprover + today.rejectedByApprover,
      billAmount: Number(baseline.billAmount) + Number(today.billAmount),
      forwardedAmount: Number(baseline.forwardedAmount) + Number(today.forwardedAmount),
      ftoAmount: Number(baseline.ftoAmount) + Number(today.ftoAmount),
      systemLoad: today.systemLoad || base.systemLoad,
      context: today.context || base.context || 'Real-time'
    } as DashboardMetrics;
  });

  // NEW: Hierarchical Selection System
  rangeType = signal<'FinancialYear' | 'Quarter' | 'Month' | 'Daily'>('FinancialYear');
  rangeTypeOptions = [
    { label: 'Financial Year', value: 'FinancialYear' },
    { label: 'Quarter', value: 'Quarter' },
    { label: 'Month', value: 'Month' },
    { label: 'Daily', value: 'Daily' }
  ];
  
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
  private hasInitializedFY = false;

  isRealTimeApplicable = computed(() => {
    const type = this.rangeType();
    const fy = this.selectedFY();
    const activeFy = this.dashService.activeFy();

    // Strict: Real-time is ONLY applicable if we are viewing the current system FY
    if (fy !== activeFy) return false;

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
        console.debug('Dashboard: Applying SignalR Total Pulse', pulse);
        this.liveOverwrites.update(curr => {
          const base = this.historicalBase();
          const next = curr ? { ...curr } : { 
            receivedFto: base?.todayReceivedFto || 0,
            processedFto: base?.todayProcessedFto || 0,
            generatedBills: base?.todayGeneratedBills || 0,
            forwardedToTreasury: base?.todayForwardedToTreasury || 0,
            receivedByApprover: base?.todayReceivedByApprover || 0,
            rejectedByApprover: base?.todayRejectedByApprover || 0,
            billAmount: base?.todayBillAmount || 0,
            forwardedAmount: base?.todayForwardedAmount || 0,
            ftoAmount: base?.todayFtoAmount || 0,
            systemLoad: base?.systemLoad || 0,
            context: pulse.sc || 'Pulse' 
          };

          // Update with absolute totals from pulse
          if (pulse.rf != null) next.receivedFto = pulse.rf;
          if (pulse.pf != null) next.processedFto = pulse.pf;
          if (pulse.gb != null) next.generatedBills = pulse.gb;
          if (pulse.ft != null) next.forwardedToTreasury = pulse.ft;
          if (pulse.ar != null) next.receivedByApprover = pulse.ar;
          if (pulse.rb != null) next.rejectedByApprover = pulse.rb;
          if (pulse.ba != null) next.billAmount = Number(pulse.ba);
          if (pulse.fa != null) next.forwardedAmount = Number(pulse.fa);
          if (pulse.fta != null) next.ftoAmount = Number(pulse.fta);
          if (pulse.sl != null) next.systemLoad = pulse.sl;
          next.context = pulse.sc || next.context;

          return next;
        });

        // Trigger animations
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

    // SYNC: Ensure dropdown FY matches the Source of Truth from backend on init or year change
    effect(() => {
      const activeFy = this.dashService.activeFy();
      if (!activeFy) return;

      // Only re-sync if we haven't initialized yet
      if (!this.hasInitializedFY) {
        console.debug('Dashboard: Initializing selectedFY with Source of Truth', activeFy);
        
        const currentYear = 2000 + Math.floor(activeFy / 100);
        const fys = [];
        for (let i = 0; i < 3; i++) {
            const y = (currentYear - i) % 100;
            const fy = (y * 100) + (y + 1);
            fys.push({ label: `FY 20${Math.floor(fy/100)}-${fy%100}`, value: fy });
        }
        this.fyOptions.set(fys);
        this.selectedFY.set(activeFy);
        this.refreshMetrics();
        this.hasInitializedFY = true;
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
    const currentMonth = now.getMonth() + 1; // 1-indexed
    
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
    this.liveOverwrites.set(null); // Clear session deltas on selection change
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
        const role = user.role;
        const metrics = res.find(m => m.context === role) || res[0];
        
        // Always set the API response as the baseline
        this.historicalBase.set(metrics);
        // liveOverwrites is cleared at the start of this method
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
