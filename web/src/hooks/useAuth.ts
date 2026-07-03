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
}

const API_BASE = import.meta.env.VITE_API_URL || '';

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
      loading: false
    };
  });

  // 使用 ref 保持最新 token，避免闭包陷阱
  const tokenRef = useRef(state.token);
  tokenRef.current = state.token;

  // 验证 token
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
        setState({ user: null, token: null, loading: false });
        return false;
      }

      const data = await res.json();
      if (data.success && data.user) {
        sessionStorage.setItem('user', JSON.stringify(data.user));
        setState({ user: data.user, token, loading: false });
        return true;
      }

      return false;
    } catch {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      setState({ user: null, token: null, loading: false });
      return false;
    }
  }, []); // 无依赖，使用 ref 获取最新 token

  // 设置用户数据
  const setUserData = useCallback((user: User, token: string) => {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    setState({ user, token, loading: false });
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
    setState({ user: null, token: null, loading: false });
  }, []);

  // 定期验证 token
  useEffect(() => {
    if (!state.token || !state.user) return;

    const interval = setInterval(() => {
      verifyToken();
    }, 3600000);

    return () => clearInterval(interval);
  }, [state.token, state.user, verifyToken]);

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    login,
    logout,
    setUserData,
    verifyToken
  };
}
