import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface Fto {
  ftoNo: string;
  amount: number;
  userid: string;
  ddoCode: string;
  ftoStatus: number;
  financialYear: number;
  ftoCreationDate: string;
}

export interface Bill {
  billNo: string;
  refNo: string;
  amount: number;
  billDate: string;
  billStatus: number;
  userid: string;
  ddoCode: string;
}

@Injectable({
  providedIn: 'root'
})
export class BillService {
  private http = inject(HttpClient);
  private readonly ftoUrl = `${environment.apiUrl}/Fto`;
  private readonly billUrl = `${environment.apiUrl}/Bill`;

  constructor() {}

  getFtos(page: number = 1, pageSize: number = 10) {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    return this.http.get<{ items: Fto[], total: number }>(this.ftoUrl, { params });
  }

  getBills(status?: number, page: number = 1, pageSize: number = 10) {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    if (status !== undefined && status !== null) {
      params = params.set('status', status);
    }
    return this.http.get<{ items: Bill[], total: number }>(this.billUrl, { params });
  }

  generateBill(ftoNos: string[], financialYear: number) {
    return this.http.post(`${this.billUrl}/generate`, { ftoNos, financialYear });
  }

  forwardBill(billNo: string) {
    return this.http.post(`${this.billUrl}/forward/${billNo}`, {});
  }

  rejectBill(billNo: string) {
    return this.http.post(`${this.billUrl}/reject/${billNo}`, {});
  }
}
