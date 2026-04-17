import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { Router } from '@angular/router';

import { environment } from '../../../environments/environment';

export interface User {
  userId: string;
  role: 'Admin' | 'Approver' | 'Operator';
  ddoCode?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private readonly apiUrl = `${environment.apiUrl}/Login`;
  
  currentUser = signal<User | null>(null);
  token = signal<string | null>(null);

  constructor() {
    this.loadSession();
  }

  login(credentials: { username: string; password: string }) {
    return this.http.post<AuthResponse>(this.apiUrl, credentials).pipe(
      tap(res => {
        this.setSession(res);
      })
    );
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/auth/login']);
  }

  private setSession(auth: AuthResponse) {
    localStorage.setItem('token', auth.token);
    localStorage.setItem('user', JSON.stringify(auth.user));
    this.token.set(auth.token);
    this.currentUser.set(auth.user);
  }

  private loadSession() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) {
      this.token.set(token);
      this.currentUser.set(JSON.parse(user));
    }
  }

  get isAuthenticated() {
    return !!this.token();
  }
}
