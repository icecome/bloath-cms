import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { CollectionsProvider } from './contexts/CollectionsContext';
import { RepoProvider } from './contexts/RepoContext';
import LoginPage from './pages/LoginPage';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './pages/DashboardPage';
import DraftsPage from './pages/DraftsPage';
import TrashPage from './pages/TrashPage';
import MediaPage from './pages/MediaPage';
import SettingsPage from './pages/SettingsPage';
import './styles/globals.css';

const EditorPage = lazy(() => import('./pages/EditorPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, token, verifyToken } = useAuth();
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    // 如果有 token 但没有用户数据，验证 token
    if (token && !user) {
      setVerifying(true);
      verifyToken(token).then(() => setVerifying(false));
    }
  }, [token, user, verifyToken]);

  // 验证中显示加载状态
  if (verifying) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3B82F6]"></div>
      </div>
    );
  }

  // 无用户数据，重定向到登录页
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// 加载状态组件
function LoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3B82F6] mx-auto border-[#E8E8E8]"></div>
        <p className="mt-3 text-sm text-[#6B7280]">加载中...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RepoProvider>
      <CollectionsProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="drafts" element={<DraftsPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="editor/*" element={
              <Suspense fallback={<LoadingFallback />}>
                <EditorPage />
              </Suspense>
            } />
            <Route path="media" element={<MediaPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </CollectionsProvider>
    </RepoProvider>
  );
}
