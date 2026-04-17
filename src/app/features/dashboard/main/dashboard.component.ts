import { Component, OnInit, signal, effect, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Card } from 'primeng/card';
import { UIChart } from 'primeng/chart';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { DashboardService, DashboardMetrics } from '../../../core/services/dashboard.service';
import { SignalrService } from '../../../core/services/signalr.service';
import { AuthService } from '../../../core/services/auth.service';

interface KpiCard {
  title: string;
  value: number;
  icon: string;
  trend: number;
  flashing: boolean;
  suffix: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, Card, UIChart, Select, DatePicker, Tag, Tooltip],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private dashService = inject(DashboardService);
  private signalr = inject(SignalrService);
  public auth = inject(AuthService);

  metrics = signal<DashboardMetrics | null>(null);
  dateRange: Date[] = [new Date(), new Date()];
  selectedPreset = 'today';

  isLive = signal(true);
  flashSignal = signal(false);

  datePresets = [
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'week' },
    { label: 'This Month', value: 'month' },
    { label: 'This Quarter', value: 'quarter' },
    { label: 'This Year (FY)', value: 'year' },
    { label: 'Previous Year', value: 'prev_year' }
  ];

  kpiData = computed<KpiCard[]>(() => {
    const m = this.metrics();
    if (!m) return [];

    return [
      { title: 'FTO Received', value: m.receivedFto, icon: 'pi pi-download', trend: 12, flashing: this.flashSignal(), suffix: '' },
      { title: 'FTO Processed', value: m.processedFto, icon: 'pi pi-cog', trend: 8, flashing: this.flashSignal(), suffix: '' },
      { title: 'Generated Bills', value: m.generatedBills, icon: 'pi pi-file', trend: 5, flashing: this.flashSignal(), suffix: '' },
      { title: 'Treasury Forwarded', value: m.forwardedToTreasury, icon: 'pi pi-send', trend: 15, flashing: this.flashSignal(), suffix: '' },
      { title: 'Approver Rcvd', value: m.receivedByApprover, icon: 'pi pi-eye', trend: -2, flashing: this.flashSignal(), suffix: '' },
      { title: 'Rejected', value: m.rejectedByApprover, icon: 'pi pi-times-circle', trend: -10, flashing: this.flashSignal(), suffix: '' }
    ];
  });

  processingRate = computed(() => {
    const m = this.metrics();
    if (!m || m.receivedFto === 0) return 0;
    return Math.round((m.processedFto / m.receivedFto) * 100);
  });

  treasuryRate = computed(() => {
    const m = this.metrics();
    if (!m || m.generatedBills === 0) return 0;
    return Math.round((m.forwardedToTreasury / m.generatedBills) * 100);
  });

  chartData: any;
  chartOptions: any;

  constructor() {
    // Smart Gatekeeper Strategy: Update if live and in range
    effect(() => {
      const update = this.signalr.updates$();
      if (update && this.isLive()) {
        this.refreshMetrics();
        this.triggerFlash();
      }
    });
  }

  ngOnInit() {
    this.onPresetChange();
    this.initChart();
  }

  onPresetChange() {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch (this.selectedPreset) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        this.isLive.set(true);
        break;
      case 'week':
        start.setDate(now.getDate() - now.getDay());
        this.isLive.set(false);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        this.isLive.set(false);
        break;
      case 'year':
        start = new Date(2026, 3, 1); // FY starts April
        this.isLive.set(false);
        break;
    }

    this.dateRange = [start, end];
    this.refreshMetrics();
  }

  onCustomDateChange() {
    if (this.dateRange[0] && this.dateRange[1]) {
      this.isLive.set(false);
      this.refreshMetrics();
    }
  }

  refreshMetrics() {
    const start = this.dateRange[0];
    const end = this.dateRange[1] || new Date();

    this.dashService.getMetrics(2026, start, end).subscribe((m: DashboardMetrics) => {
      this.metrics.set(m);
      this.updateChartData(m);
    });
  }

  triggerFlash() {
    this.flashSignal.set(true);
    setTimeout(() => this.flashSignal.set(false), 800);
  }

  initChart() {
    const documentStyle = getComputedStyle(document.documentElement);
    this.chartOptions = {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#495057', font: { weight: '700' } } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#ebedef', drawDash: true } }
      }
    };
  }

  updateChartData(m: DashboardMetrics) {
    this.chartData = {
      labels: ['Received FTO', 'Processed FTO', 'Generated Bills', 'Treasury Bills'],
      datasets: [
        {
          label: 'Workflow Performance',
          backgroundColor: ['#6366f1', '#a855f7', '#3b82f6', '#22c55e'],
          data: [m.receivedFto, m.processedFto, m.generatedBills, m.forwardedToTreasury],
          borderRadius: 12,
          barThickness: 40
        }
      ]
    };
  }
}
