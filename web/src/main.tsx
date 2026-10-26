import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { setEditorDraftWriteFailureHandler } from './lib/editorDraftStore';
import { getReloadForNewVersion, isChunkLoadError } from './lib/chunkRecovery';
import './styles/globals.css';

// 防丢稿副本写失败（localStorage 配额满/隐私模式）必须可见：静默降级会让
// 用户「以为有备份其实没有」（P2-39）。store 不依赖 UI，经回调注入。
setEditorDraftWriteFailureHandler(() => {
  window.dispatchEvent(new CustomEvent('draft:storage-failed'));
});

// 分块拉取失败的兜底：LazyRoute 之外若还有别的动态 import（后续新增懒加载模块），
// 失败会变成未处理的 rejection，页面停在半死状态。这里按同一套冷却窗口重载一次。
window.addEventListener('unhandledrejection', (event) => {
  if (!isChunkLoadError(event.reason)) return;
  if (getReloadForNewVersion()()) {
    console.warn('[chunkRecovery] 页面资源加载失败，按新版本重新加载：', event.reason);
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
