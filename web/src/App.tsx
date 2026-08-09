import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { AuthProvider } from './contexts/AuthContext';
import { CollectionsProvider } from './contexts/CollectionsContext';
import { RepoProvider } from './contexts/RepoContext';
import { ToastProvider } from './contexts/ToastContext';
import LoginPage from './pages/LoginPage';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './pages/DashboardPage';
import DraftsPage from './pages/DraftsPage';
import TrashPage from './pages/TrashPage';
import MediaPage from './pages/MediaPage';
import SettingsPage from './pages/SettingsPage';
import ToastContainer from './components/ui/ToastContainer';
import './styles/globals.css';

const EditorPage = lazy(() => import('./pages/EditorPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // 加载中显示加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto border-border"></div>
        <p className="mt-3 text-sm text-muted-foreground">加载中...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RepoProvider>
      <CollectionsProvider>
        <ToastProvider>
          <AuthProvider>
            <ToastContainer />
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
          </AuthProvider>
        </ToastProvider>
      </CollectionsProvider>
    </RepoProvider>
  );
}
