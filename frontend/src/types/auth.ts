export interface User {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface UserCreate {
  email: string;
  password: string;
  full_name: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface ProfileUpdate {
  full_name?: string;
  email?: string;
  password?: string;
  current_password?: string;
}

export interface AdminUserUpdate {
  full_name?: string;
  email?: string;
  is_active?: boolean;
  is_admin?: boolean;
}

export interface PasswordResetLink {
  token: string;
  path: string;
  expires_at: string;
}

export interface PasswordResetValidation {
  valid: boolean;
  email?: string | null;
  full_name?: string | null;
  message?: string | null;
}
