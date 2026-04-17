import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface DashboardMetrics {
  receivedFto: number;
  processedFto: number;
  generatedBills: number;
  forwardedToTreasury: number;
  receivedByApprover: number;
  rejectedByApprover: number;
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/Dashboard/metrics`;

  constructor() {}

  getMetrics(fy: number, start: Date, end: Date) {
    const params = new HttpParams()
      .set('fy', fy)
      .set('start', start.toISOString())
      .set('end', end.toISOString());
    
    return this.http.get<DashboardMetrics>(this.apiUrl, { params });
  }
}
