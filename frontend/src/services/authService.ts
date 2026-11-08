import api from './api';
import { AdminUserUpdate, LoginResponse, PasswordResetLink, PasswordResetValidation, ProfileUpdate, User, UserCreate } from '../types/auth';

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    // OAuth2PasswordRequestForm expects form-encoded data, not JSON
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);

    const response = await api.post<LoginResponse>('/auth/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response.data;
  },

  async getCurrentUser(token: string): Promise<User> {
    const response = await api.get<User>('/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return response.data;
  },

  async register(userData: UserCreate): Promise<User> {
    const response = await api.post<User>('/auth/register', userData);
    return response.data;
  },

  async updateProfile(data: ProfileUpdate): Promise<User> {
    const response = await api.put<User>('/auth/me', data);
    return response.data;
  },

  async validateResetToken(token: string): Promise<PasswordResetValidation> {
    const response = await api.get<PasswordResetValidation>(`/auth/password-reset/${token}`);
    return response.data;
  },

  async completePasswordReset(token: string, password: string): Promise<User> {
    const response = await api.post<User>(`/auth/password-reset/${token}`, { password });
    return response.data;
  },

  async createResetLink(userId: number): Promise<PasswordResetLink> {
    const response = await api.post<PasswordResetLink>(`/auth/users/${userId}/reset-link`);
    return response.data;
  },

  async adminUpdateUser(userId: number, data: AdminUserUpdate): Promise<User> {
    const response = await api.patch<User>(`/auth/users/${userId}`, data);
    return response.data;
  },

  saveToken(token: string): void {
    localStorage.setItem('auth_token', token);
  },

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  },

  removeToken(): void {
    localStorage.removeItem('auth_token');
  }
};
