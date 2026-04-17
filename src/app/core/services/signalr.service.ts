import { Injectable, signal, inject } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SignalrService {
  private auth = inject(AuthService);
  private hubConnection: signalR.HubConnection | null = null;
  
  // Observable-like signal for dashboard updates
  updates$ = signal<string | null>(null);

  constructor() {
    this.initConnection();
  }

  private initConnection() {
    const hubUrl = `${environment.apiUrl.replace('/api', '')}/dashboard-hub`;
    
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.auth.token() || '',
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
      })
      .withAutomaticReconnect()
      .build();

    this.hubConnection.start()
      .then(() => {
        console.log('SignalR Connected');
        this.joinGroups();
      })
      .catch(err => console.error('SignalR Error: ', err));

    this.hubConnection.on('DashboardUpdate', (payload: string) => {
        this.updates$.set(payload + ':' + new Date().getTime());
    });
  }

  private joinGroups() {
    if (!this.hubConnection) return;
    
    const user = this.auth.currentUser();
    if (!user) return;

    // Join Role-Based Groups
    if (user.role === 'Admin') {
      this.hubConnection.invoke('JoinGroup', 'Admin');
    } else if (user.role === 'Approver') {
      this.hubConnection.invoke('JoinGroup', `DDO:${user.ddoCode}`);
    } else if (user.role === 'Operator') {
      this.hubConnection.invoke('JoinGroup', `DDO:${user.ddoCode}:OP:${user.userId}`);
    }
  }
}
