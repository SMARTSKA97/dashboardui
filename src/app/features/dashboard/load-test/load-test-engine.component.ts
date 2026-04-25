import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignalrService, SequencedPulse } from '../../../core/services/signalr.service';
import { LoadTestEngineService, LoadTestMetrics } from '../../../core/services/load-test-engine.service';
import { ButtonModule } from 'primeng/button';
import { SliderModule } from 'primeng/slider';
import { ChartModule } from 'primeng/chart';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { CheckboxModule } from 'primeng/checkbox';

@Component({
  selector: 'app-load-test-engine',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, SliderModule, ChartModule, TagModule, TooltipModule, CheckboxModule],
  templateUrl: './load-test-engine.component.html',
  styleUrl: './load-test-engine.component.scss'
})
export class LoadTestEngineComponent implements OnInit, OnDestroy {
  private signalr = inject(SignalrService);
  private engine = inject(LoadTestEngineService);

  concurrency = signal<number>(10);
  isAutoScale = signal<boolean>(false);
  isRunning = computed(() => this.engine.status()?.status === 'Running');
  
  // Real-time Metrics
  metrics = signal<LoadTestMetrics | null>(null);
  vitals = signal<{ cpu: number, ram: number, dbConn: number }>({ cpu: 0, ram: 0, dbConn: 0 });
  
  // High-precision timing
  transitLag = signal<number>(0);
  uiProcessingLag = signal<number>(0);

  // History for charts
  history = signal<{ rps: number[], latency: number[], cpu: number[] }>({ rps: [], latency: [], cpu: [] });

  constructor() {
    // Reactive Engine Pulse
    effect(() => {
      const pulse = this.signalr.engineUpdates$();
      if (pulse && pulse.m === 'EngineUpdate') {
        const start = performance.now();
        
        // 1. Calculate Transit Lag (Server -> UI)
        const now = Date.now();
        this.transitLag.set(now - pulse.ts);

        // 2. Update Data
        const data = pulse.d;
        this.metrics.set(data.metrics);
        this.vitals.set(data.vitals);

        this.history.update(h => ({
          rps: [...h.rps, data.metrics.rps].slice(-30),
          latency: [...h.latency, data.metrics.avgLatency].slice(-30),
          cpu: [...h.cpu, data.vitals.cpu].slice(-30)
        }));

        // 3. Calculate UI Processing Lag
        const end = performance.now();
        this.uiProcessingLag.set(end - start);
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.signalr.joinGroup('Engine', 'Admin');
    this.engine.getStatus();
  }

  ngOnDestroy() {
    this.signalr.leaveGroup('Engine', 'Admin');
  }

  startTest() {
    this.engine.start(this.concurrency(), this.isAutoScale()).subscribe();
  }

  stopTest() {
    this.engine.stop().subscribe();
  }

  getBottleneckColor(type: string): string {
    const b = this.metrics()?.bottleneck;
    if (b === type) return 'critical';
    
    // Check for SignalR or UI lag
    if (type === 'SignalR' && this.transitLag() > 500) return 'warning';
    if (type === 'UI' && this.uiProcessingLag() > 16) return 'critical'; // > 60fps frame time
    
    return '';
  }

  getChartData(type: 'rps' | 'latency' | 'cpu') {
    const data = this.history()[type];
    const colors = { rps: '#6366f1', latency: '#ec4899', cpu: '#a855f7' };
    
    return {
      labels: data.map((_, i) => i.toString()),
      datasets: [{
        data: data,
        borderColor: colors[type],
        backgroundColor: colors[type] + '22',
        fill: true,
        tension: 0.4,
        pointRadius: 0
      }]
    };
  }

  chartOptions = {
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    maintainAspectRatio: false
  };
}
