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

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: sessionStorage.getItem('token'),
    loading: true
  });

  // 检查当前用户
  useEffect(() => {
    if (!state.token) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${state.token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => {
        setState({
          user: data.user,
          token: state.token,
          loading: false
        });
      })
      .catch(() => {
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

  const handleCallback = async (code: string, stateVal: string) => {
    const res = await fetch(`${API_BASE}/api/auth/callback?code=${code}&state=${stateVal}`);
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('token', data.sessionKey);
      setState({
        user: data.user,
        token: data.sessionKey,
        loading: false
      });
    }
    return data;
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
    handleCallback,
    logout
  };
}
