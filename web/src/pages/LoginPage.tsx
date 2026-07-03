import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // 从 query 参数解析 token 或已有 token 自动跳转
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (token) {
      sessionStorage.setItem('token', token);
      window.history.replaceState(null, '', window.location.pathname);
      window.location.reload();
      return;
    }
    
    // 如果 sessionStorage 中已有 token 且 URL 没有 query 参数，直接跳转主页
    const storedToken = sessionStorage.getItem('token');
    if (storedToken && !params.toString()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#1F1F1F]">Bloath CMS</h1>
          <p className="text-base text-[#6B7280] mt-2">Hugo 博客内容管理系统</p>
        </div>

        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#1F1F1F] text-white rounded-sm hover:bg-neutral-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          使用 GitHub 登录
        </button>

        <p className="text-xs text-[#6B7280] text-center mt-4">
          内容存储在您的 GitHub 仓库中，安全可控
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
