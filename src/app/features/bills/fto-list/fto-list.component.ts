import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Toast } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { BillService, Fto } from '../../../core/services/bill.service';
import { DashboardService } from '../../../core/services/dashboard.service';

@Component({
  selector: 'app-fto-list',
  standalone: true,
  imports: [CommonModule, TableModule, Button, Toast],
  templateUrl: './fto-list.component.html',
  styleUrl: './fto-list.component.scss'
})
export class FtoListComponent implements OnInit {
  private billService = inject(BillService);
  private dashService = inject(DashboardService);
  private messageService = inject(MessageService);

  ftos = signal<Fto[]>([]);
  totalRecords = signal(0);
  loading = signal(false);
  selectedFtos: Fto[] = [];

  constructor() { }

  ngOnInit() { }

  loadFtos(event: TableLazyLoadEvent) {
    this.loading.set(true);
    const page = (event.first ?? 0) / (event.rows ?? 10) + 1;
    this.billService.getFtos(page, event.rows ?? 10).subscribe({
      next: (res: any) => {
        this.ftos.set(res.items);
        this.totalRecords.set(res.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onGenerateBill() {
    const ftoNos = this.selectedFtos.map(f => f.ftoNo);
    // Dynamic FY: Consuming global 'Source of Truth' from DashboardService
    const fy = this.dashService.activeFy();
    
    this.billService.generateBill(ftoNos, fy).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Bill generated successfully' });
        this.selectedFtos = [];
        this.loadFtos({ first: 0, rows: 10 });
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to generate bill' })
    });
  }
}
