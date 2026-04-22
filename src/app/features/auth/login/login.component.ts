import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Password } from 'primeng/password';
import { Card } from 'primeng/card';
import { Toast } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, Button, InputText, Password, Card, Toast],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private messageService = inject(MessageService);

  username = '';
  password = '';
  loading = false;

  onLogin() {
    if (!this.username || !this.password) return;

    this.loading = true;
    this.auth.login({ username: this.username, password: this.password }).subscribe({
      next: (res: any) => {
        this.messageService.add({ severity: 'success', summary: 'Welcome', detail: `Logged in as ${res.user.role}` });
        setTimeout(() => this.router.navigate(['/dashboard']), 500);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Login Failed', detail: 'Invalid UserId or Password' });
        this.loading = false;
      }
    });
  }

  quickLogin(role: 'admin' | 'approver' | 'operator') {
    const creds = {
      admin: { u: 'Admin', p: 'pass' },
      approver: { u: 'DDO001_APPROVER', p: 'pass' },
      operator: { u: 'DDO001_OP1', p: 'pass' }
    };

    const target = creds[role];
    this.username = target.u;
    this.password = target.p;
    this.onLogin();
  }
}
