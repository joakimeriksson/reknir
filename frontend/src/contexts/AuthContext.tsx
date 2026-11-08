import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, AuthContextType } from '../types/auth';
import { authService } from '../services/authService';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing token on mount
  useEffect(() => {
    const initAuth = async () => {
      const savedToken = authService.getToken();
      if (savedToken) {
        try {
          const currentUser = await authService.getCurrentUser(savedToken);
          setToken(savedToken);
          setUser(currentUser);
        } catch (error) {
          // Token is invalid, remove it
          authService.removeToken();
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authService.login(email, password);
    const { access_token } = response;

    authService.saveToken(access_token);
    const currentUser = await authService.getCurrentUser(access_token);

    setToken(access_token);
    setUser(currentUser);
  };

  const refreshUser = async () => {
    const savedToken = authService.getToken();
    if (!savedToken) return;
    const currentUser = await authService.getCurrentUser(savedToken);
    setUser(currentUser);
  };

  const logout = () => {
    authService.removeToken();
    setToken(null);
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    token,
    login,
    logout,
    refreshUser,
    isAuthenticated: !!token && !!user,
    isLoading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
