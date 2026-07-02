import { useState, useEffect } from 'react';

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
  const [state, setState] = useState<AuthState>({
    user: null,
    token: sessionStorage.getItem('token'),
    loading: true
  });

  // 检查当前用户
  useEffect(() => {
    console.log('[useAuth] effect triggered, token:', state.token ? 'exists' : 'null');
    if (!state.token) {
      console.log('[useAuth] no token, setting loading false');
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    console.log('[useAuth] fetching /api/me');
    fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${state.token}` }
    })
      .then((res) => {
        console.log('[useAuth] /api/me response status:', res.status);
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => {
        console.log('[useAuth] /api/me success, user:', data.user);
        setState({
          user: data.user,
          token: state.token,
          loading: false
        });
      })
      .catch((err) => {
        console.error('[useAuth] /api/me failed:', err);
        sessionStorage.removeItem('token');
        setState({ user: null, token: null, loading: false });
      });
  }, [state.token]);

  const login = () => {
    fetch(`${API_BASE}/api/auth/login`, {
      headers: { 'X-Frontend-Url': window.location.origin }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authUrl) {
          window.location.href = data.authUrl;
        }
      });
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    setState({ user: null, token: null, loading: false });
  };

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    login,
    logout
  };
}
