import { useState, useEffect, useCallback, useRef } from 'react';

interface User {
  login: string;
  avatar_url: string;
  name?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  toast: string | null;
}

import { API_BASE } from '../lib/constants';

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const token = sessionStorage.getItem('token');
    const userStr = sessionStorage.getItem('user');
    let user: User | null = null;

    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch {
        sessionStorage.removeItem('user');
      }
    }

    return {
      user,
      token,
      loading: false,
      toast: null
    };
  });

  // 使用 ref 保持最新 token，避免闭包陷阱
  const tokenRef = useRef(state.token);
  tokenRef.current = state.token;

  // 验证 token，支持自动续期
  const verifyToken = useCallback(async (tokenToVerify?: string) => {
    const token = tokenToVerify || tokenRef.current;
    if (!token) return false;

    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        setState(prev => ({ ...prev, user: null, token: null, loading: false, toast: '登录已过期，请重新登录' }));
        return false;
      }

      // 检查是否需要更新 token（自动续期）
      const newToken = res.headers.get('X-Session-Token');
      if (newToken) {
        sessionStorage.setItem('token', newToken);
        tokenRef.current = newToken;
      }

      const data = await res.json();
      if (data.success && data.user) {
        sessionStorage.setItem('user', JSON.stringify(data.user));
        setState(prev => ({ ...prev, user: data.user, token: newToken || token, loading: false }));
        return true;
      }

      return false;
    } catch {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      setState(prev => ({ ...prev, user: null, token: null, loading: false, toast: '网络错误，请检查连接' }));
      return false;
    }
  }, []); // 无依赖，使用 ref 获取最新 token

  // 设置用户数据
  const setUserData = useCallback((user: User, token: string) => {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    setState(prev => ({ ...prev, user, token, loading: false, toast: null }));
  }, []);

  // 清除 toast
  const clearToast = useCallback(() => {
    setState(prev => ({ ...prev, toast: null }));
  }, []);

  // 登录
  const login = useCallback(() => {
    fetch(`${API_BASE}/api/auth/login`, {
      headers: { 'X-Frontend-Url': window.location.origin }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authUrl) {
          window.location.href = data.authUrl;
        }
      });
  }, []);

  // 登出
  const logout = useCallback(() => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setState(prev => ({ ...prev, user: null, token: null, loading: false, toast: null }));
  }, []);

  // 定期验证 token（每 7 分钟验证一次，配合 15 分钟有效期）
  useEffect(() => {
    if (!state.token || !state.user) return;

    const interval = setInterval(() => {
      verifyToken();
    }, 420000); // 7 分钟

    return () => clearInterval(interval);
  }, [state.token, state.user, verifyToken]);

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    toast: state.toast,
    login,
    logout,
    setUserData,
    verifyToken,
    clearToast
  };
}
