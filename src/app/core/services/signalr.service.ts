import { Injectable, signal, inject } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { DashboardPulse, DashboardService } from './dashboard.service';

export interface SequencedPulse {
  g: string; // GroupName
  sid: number; // Sequence ID
  m: string; // Method Name
  d: DashboardPulse; // Payload
}

/**
 * Enterprise Resilience: Jittered Exponential Backoff Retry Policy
 * Prevents 'Thundering Herd' scenarios when 1 Lakh+ users reconnect simultaneously.
 */
class JitteredRetryPolicy implements signalR.IRetryPolicy {
  nextRetryDelayInMilliseconds(retryContext: signalR.RetryContext): number | null {
    if (retryContext.previousRetryCount >= 10) return null; // Max retries

    // Exponential backoff: 2^attempt * 1000ms
    const baseDelay = Math.pow(2, retryContext.previousRetryCount) * 1000;
    // Jitter: +/- 30% random variance
    const jitter = (Math.random() * 0.6 - 0.3) * baseDelay;

    const finalDelay = Math.min(baseDelay + jitter, 30000); // Caps at 30 seconds
    console.log(`SignalR Reconnecting... Attempt ${retryContext.previousRetryCount + 1}. Delay: ${Math.round(finalDelay)}ms`);
    return finalDelay;
  }
}

@Injectable({
  providedIn: 'root'
})
export class SignalrService {
  private auth = inject(AuthService);
  private dashService = inject(DashboardService);
  private hubConnection: signalR.HubConnection | null = null;

  // Targeted Signals for Enterprise Observability
  updates$ = signal<DashboardPulse | null>(null);
  pressureUpdates$ = signal<DashboardPulse | null>(null);

  private lastSids = new Map<string, number>();
  private isRecovering = new Set<string>();

  private joinQueue: string[] = [];
  
  private inactivityTimer: any;
  private readonly disconnectTimeoutMs = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.initConnection();
  }

  private resetInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    
    this.inactivityTimer = setTimeout(() => {
      console.warn('SignalR: Disconnecting due to inactivity to save resources.');
      if (this.hubConnection?.state === signalR.HubConnectionState.Connected) {
        this.hubConnection.stop();
      }
    }, this.disconnectTimeoutMs);
  }

  public async checkAndReconnect(): Promise<boolean> {
    if (this.hubConnection?.state === signalR.HubConnectionState.Disconnected) {
      console.log('SignalR Heartbeat: Connection asleep. Waking up...');
      try {
        await this.hubConnection.start();
        console.log('SignalR Heartbeat: Reconnected successfully.');
        await this.processQueue();
        this.resetInactivityTimer();
        return true; // Indicates reconnection happened, baseline should be refreshed
      } catch (err) {
        console.error('SignalR Heartbeat: Reconnection failed.', err);
      }
    }
    return false;
  }

  private initConnection() {
    // Consolidated Hub URL
    const hubUrl = `${environment.apiUrl.replace('/api', '')}/signalr-hub`;

    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.auth.token() || '',
        transport: signalR.HttpTransportType.WebSockets
      })
      .withHubProtocol(new MessagePackHubProtocol())
      .withAutomaticReconnect(new JitteredRetryPolicy())
      .build();

    // Sequenced Listeners: Gap Detection Enabled
    this.hubConnection.on('DashboardUpdate', (data: SequencedPulse) => {
      this.handlePulse(data);
    });

    this.hubConnection.on('SystemPressure', (data: SequencedPulse) => {
      this.handlePulse(data);
    });

    this.hubConnection.start()
      .then(() => {
        console.log('SignalR Unified Hub Connected');
        this.processQueue();
        this.resetInactivityTimer();
      })
      .catch(err => console.error('SignalR Connection Failed:', err));
  }

  private async processQueue() {
    if (this.hubConnection?.state === signalR.HubConnectionState.Connected) {
      while (this.joinQueue.length > 0) {
        const group = this.joinQueue.shift();
        if (group) {
           await this.hubConnection.invoke('JoinGroup', group);
        }
      }
    }
  }

  /**
   * Surgical Group Engagement
   * Target format: "Dashboard:Admin", "Pressure:Admin", etc.
   */
  public async joinGroup(target: string, scope: string) {
    const groupName = `${target}:${scope}`;
    if (this.hubConnection?.state === signalR.HubConnectionState.Connected) {
      await this.hubConnection.invoke('JoinGroup', groupName);
      console.log(`Joined Group: ${groupName}`);
    } else {
      this.joinQueue.push(groupName);
    }
  }

  public async leaveGroup(target: string, scope: string) {
    const groupName = `${target}:${scope}`;
    this.joinQueue = this.joinQueue.filter(g => g !== groupName);
    this.lastSids.delete(groupName);

    if (this.hubConnection?.state === signalR.HubConnectionState.Connected) {
      await this.hubConnection.invoke('LeaveGroup', groupName);
      console.log(`Left Group: ${groupName}`);
    }
  }

  private handlePulse(pulse: SequencedPulse) {
    const group = pulse.g;
    const currentSid = pulse.sid;
    const lastSid = this.lastSids.get(group) || 0;

    // Detect Gap
    if (lastSid !== 0 && currentSid > lastSid + 1) {
      console.warn(`SignalR Gap Detected in [${group}]: Missing ${currentSid - lastSid - 1} messages.`);
      this.fetchGap(group, lastSid, currentSid);
    }

    this.lastSids.set(group, currentSid);
    this.applyPulse(pulse);
    this.resetInactivityTimer();
  }

  private fetchGap(group: string, lastId: number, currentId: number) {
    if (this.isRecovering.has(group)) return;
    this.isRecovering.add(group);

    // Thundering Herd Protection: Random Jitter for backfill
    const jitter = Math.random() * 2000; 
    setTimeout(() => {
      this.dashService.getMetricsGap(group, lastId, currentId).subscribe({
        next: (missedPulses: SequencedPulse[]) => {
          console.log(`SignalR Gap Recovered: Fetched ${missedPulses.length} pulses for [${group}]`);
          missedPulses.forEach(p => this.applyPulse(p));
          this.isRecovering.delete(group);
        },
        error: (err) => {
          console.error(`SignalR Gap Recovery Failed for [${group}]`, err);
          this.isRecovering.delete(group);
        }
      });
    }, jitter);
  }

  private applyPulse(pulse: SequencedPulse) {
    if (pulse.m === 'DashboardUpdate') {
      this.updates$.set(pulse.d);
    } else if (pulse.m === 'SystemPressure') {
      this.pressureUpdates$.set(pulse.d);
      this.updates$.set(pulse.d);
    }
  }
}
