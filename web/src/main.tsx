import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { setEditorDraftWriteFailureHandler } from './lib/editorDraftStore';
import './styles/globals.css';

// 防丢稿副本写失败（localStorage 配额满/隐私模式）必须可见：静默降级会让
// 用户「以为有备份其实没有」（P2-39）。store 不依赖 UI，经回调注入。
setEditorDraftWriteFailureHandler(() => {
  window.dispatchEvent(new CustomEvent('draft:storage-failed'));
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
