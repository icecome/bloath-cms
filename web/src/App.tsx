import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AuthProvider } from './contexts/AuthContext';
import { CollectionsProvider } from './contexts/CollectionsContext';
import { RepoProvider } from './contexts/RepoContext';
import { ToastProvider } from './contexts/ToastContext';
import { BufferProvider } from './contexts/BufferContext';
import LoginPage from './pages/LoginPage';
import MainLayout from './components/layout/MainLayout';
import DashboardPage from './pages/DashboardPage';
import DraftsPage from './pages/DraftsPage';
import TrashPage from './pages/TrashPage';
import MediaPage from './pages/MediaPage';
import SettingsPage from './pages/SettingsPage';
import ToastContainer from './components/ui/ToastContainer';
import LazyRoute from './components/ui/LazyRoute';
import './styles/globals.css';

// 模块级常量：LazyRoute 依赖其引用稳定，写成内联箭头函数会导致每次渲染重新拉取分块
const loadEditorPage = () => import('./pages/EditorPage');

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function LoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto border-border"></div>
        <p className="mt-3 text-sm text-muted-foreground">加载中……</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      {/* ToastContainer 只消费 useToast：挂在 ToastProvider 直接子级，
          避免订阅内层 Provider（Auth/Repo/Buffer/Collections）的 value 变更而重渲染 */}
      <ToastContainer />
      <AuthProvider>
        <RepoProvider>
          <BufferProvider>
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
                  <LazyRoute load={loadEditorPage} fallback={<LoadingFallback />} />
                } />
                <Route path="media" element={<MediaPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </CollectionsProvider>
          </BufferProvider>
        </RepoProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
