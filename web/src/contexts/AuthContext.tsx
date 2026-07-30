import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { API_BASE } from '../lib/constants';
import { logout as apiLogout } from '../lib/api';
import type { User } from '../../../shared/types';

// 重导出 User 类型，保持向后兼容
export type { User };

interface AuthState {
  user: User | null;
  loading: boolean;
  toast: string | null;
}

interface AuthContextValue extends AuthState {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  clearToast: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    toast: null
  });

  // 验证 session 并获取用户信息
  const verifySession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      if (!res.ok) {
        setState(prev => ({ ...prev, user: null, loading: false, toast: '登录已过期，请重新登录' }));
        return false;
      }

      const data = await res.json();
      if (data.success && data.user) {
        setState(prev => ({ ...prev, user: data.user, loading: false }));
        return true;
      }

      // 服务器返回成功但无用户数据，必须重置 loading 避免页面永久卡在加载态
      setState(prev => ({ ...prev, user: null, loading: false, toast: '登录状态异常，请重新登录' }));
      return false;
    } catch {
      setState(prev => ({ ...prev, user: null, loading: false, toast: '网络错误，请检查连接' }));
      return false;
    }
  }, []);

  // 初始化时验证 session
  useEffect(() => {
    verifySession();
  }, [verifySession]);

  // 监听全局认证过期事件
  useEffect(() => {
    const handleExpired = () => {
      setState(prev => ({ ...prev, user: null, toast: '登录已过期，请重新登录' }));
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  // 定期验证 session（每 30 分钟，配合 6 小时有效期自动续期）
  useEffect(() => {
    if (!state.user) return;
    const interval = setInterval(() => {
      verifySession();
    }, 1800000);
    return () => clearInterval(interval);
  }, [state.user, verifySession]);

  const login = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!res.ok) {
        setState(prev => ({ ...prev, toast: '登录服务不可用，请稍后重试' }));
        return;
      }
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      setState(prev => ({ ...prev, toast: '登录请求失败，请稍后重试' }));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // 忽略登出错误
    }
    setState({ user: null, loading: false, toast: null });
  }, []);

  const clearToast = useCallback(() => {
    setState(prev => ({ ...prev, toast: null }));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user: state.user,
    loading: state.loading,
    toast: state.toast,
    login,
    logout,
    clearToast
  }), [state.user, state.loading, state.toast, login, logout, clearToast]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return ctx;
}
