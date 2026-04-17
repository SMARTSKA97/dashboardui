import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Toast } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { BillService, Bill } from '../../../core/services/bill.service';
import { AuthService } from '../../../core/services/auth.service';

interface StatusFilter {
  label: string;
  value: number;
}

@Component({
  selector: 'app-bill-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, Button, Select, Tag, Toast],
  templateUrl: './bill-list.component.html',
  styleUrl: './bill-list.component.scss'
})
export class BillListComponent implements OnInit {
  private billService = inject(BillService);
  public auth = inject(AuthService);
  private messageService = inject(MessageService);

  bills = signal<Bill[]>([]);
  totalRecords = signal(0);
  loading = signal(false);
  selectedStatus: number | null = null;

  constructor() {
    // Default filter based on role as requested
    const role = this.auth.currentUser()?.role;
    if (role === 'Approver') this.selectedStatus = 0; // Generated
    else if (role === 'Operator') this.selectedStatus = 1; // Generated
  }

  ngOnInit() { }

  availableFilters = computed(() => {
    const role = this.auth.currentUser()?.role;
    if (role === 'Approver') {
      return [
        { label: 'Generated', value: 0 },
        { label: 'Forwarded by Operator', value: 2 },
        { label: 'Rejected by Me', value: 3 },
        { label: 'Forwarded to Treasury', value: 4 }
      ];
    } else if (role === 'Operator') {
      return [
        { label: 'Generated', value: 1 },
        { label: 'Forwarded to Approver', value: 2 },
        { label: 'Forwarded to Treasury', value: 4 },
        { label: 'Rejected by Approver', value: 3 }
      ];
    }
    return [];
  });

  loadBills(event: TableLazyLoadEvent) {
    this.loading.set(true);
    const page = (event.first ?? 0) / (event.rows ?? 10) + 1;
    this.billService.getBills(this.selectedStatus ?? undefined, page, event.rows ?? 10).subscribe({
      next: (res: any) => {
        this.bills.set(res.items);
        this.totalRecords.set(res.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onFilterChange() {
    this.loadBills({ first: 0, rows: 10 });
  }

  onForward(billNo: string) {
    this.billService.forwardBill(billNo).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Bill forwarded successfully' });
        this.onFilterChange();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Operation failed' })
    });
  }

  onReject(billNo: string) {
    this.billService.rejectBill(billNo).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Bill rejected' });
        this.onFilterChange();
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Operation failed' })
    });
  }

  getStatusLabel(status: number): string {
    const labels: Record<number, string> = {
      0: 'Generated',
      1: 'Generated',
      2: 'Forwarded to Approver',
      3: 'Rejected',
      4: 'Sent to Treasury'
    };
    return labels[status] || 'Unknown';
  }

  getStatusSeverity(status: number): "success" | "secondary" | "info" | "warn" | "danger" | "contrast" {
    const severities: Record<number, "success" | "secondary" | "info" | "warn" | "danger" | "contrast"> = {
      0: 'info',
      1: 'info',
      2: 'warn',
      3: 'danger',
      4: 'success'
    };
    return severities[status] || 'secondary';
  }
}
