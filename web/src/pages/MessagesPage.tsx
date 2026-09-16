import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listAdminMessages, patchMessageAction, createReply, updateReply, deleteReply,
  batchOperateMessages, type AdminMessage, type AdminListResult,
} from '../lib/commentApi';
import { renderMarkdown } from '../lib/markdown';
import { useToast } from '../contexts/ToastContext';
import {
  formatTime, formatFullTime, buildThread, STATUS_LABEL, STATUS_TABS,
} from '../lib/messagesThread';
import {
  MessageSquare, Check, Star, RotateCcw, Reply, Send, Loader2, Trash2,
  Bold, Italic, Code, Link as LinkIcon, Heading, List, Quote,
  ChevronDown, ChevronLeft, ChevronRight, X, ExternalLink, Mail,
} from 'lucide-react';

export default function MessagesPage() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [editReplyContent, setEditReplyContent] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedQuotes, setExpandedQuotes] = useState<Set<number>>(new Set());
  const [replyExpanded, setReplyExpanded] = useState(false);

  const detailScrollRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) ?? null;

  const loadMessages = useCallback(async (status?: string, resetSelection = false) => {
    setLoading(true);
    try {
      const result: AdminListResult = await listAdminMessages({
        status: status || undefined,
        size: 50,
      });
      setMessages(result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      if (resetSelection) {
        const first = result.items[0];
        setSelectedMessageId(first ? first.id : null);
      }
    } catch (err) {
      addToast({ message: `加载失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadMessages(activeTab, true);
  }, [activeTab, loadMessages]);

  // Auto-select first message or verify current selection still exists
  useEffect(() => {
    if (messages.length === 0) {
      if (selectedMessageId !== null) setSelectedMessageId(null);
      return;
    }
    if (selectedMessageId === null || !messages.some((m) => m.id === selectedMessageId)) {
      const first = messages[0];
      if (first) setSelectedMessageId(first.id);
    }
  }, [messages, selectedMessageId]);

  // Scroll detail to top when selection changes
  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedMessageId]);

  const loadMore = async () => {
    if (!nextCursor) return;
    try {
      const result: AdminListResult = await listAdminMessages({
        status: activeTab || undefined,
        size: 50,
        cursor: nextCursor,
      });
      setMessages((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (err) {
      addToast({ message: `加载更多失败: ${(err as Error).message}`, type: 'error' });
    }
  };

  const handleAction = async (id: number, action: string) => {
    setActionLoading(true);
    try {
      await patchMessageAction(id, action);
      addToast({ message: '操作成功', type: 'success' });
      await loadMessages(activeTab);
    } catch (err) {
      addToast({ message: `操作失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBatch = async (action: string) => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      await batchOperateMessages([...selectedIds], action);
      addToast({ message: `已批量操作 ${selectedIds.size} 条`, type: 'success' });
      setSelectedIds(new Set());
      await loadMessages(activeTab);
    } catch (err) {
      addToast({ message: `批量操作失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitReply = async (id: number) => {
    if (editingReplyId !== null) {
      await handleUpdateReply(id);
      return;
    }
    if (!replyContent.trim()) return;
    setActionLoading(true);
    try {
      await createReply(id, replyContent.trim());
      addToast({ message: '回复成功', type: 'success' });
      setReplyingId(null);
      setReplyContent('');
      setReplyExpanded(false);
      await loadMessages(activeTab);
    } catch (err) {
      addToast({ message: `回复失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateReply = async (messageId: number) => {
    if (!editReplyContent.trim()) return;
    setActionLoading(true);
    try {
      await updateReply(messageId, editReplyContent.trim());
      addToast({ message: '回复已更新', type: 'success' });
      setEditingReplyId(null);
      setEditReplyContent('');
      setReplyContent('');
      setReplyExpanded(false);
      await loadMessages(activeTab);
    } catch (err) {
      addToast({ message: `更新失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteReply = async (messageId: number, replyId: number) => {
    setActionLoading(true);
    try {
      await deleteReply(messageId, replyId);
      addToast({ message: '回复已删除', type: 'success' });
      await loadMessages(activeTab);
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.id)));
    }
  };

  const openReplyEditor = (msgId: number) => {
    setReplyingId(msgId);
    setEditingReplyId(null);
    setEditReplyContent('');
    setReplyContent('');
    setReplyExpanded(true);
    setTimeout(() => replyTextareaRef.current?.focus(), 100);
  };

  const openEditEditor = (msgId: number, replyId: number, content: string) => {
    setSelectedMessageId(msgId);
    setReplyingId(msgId);
    setEditingReplyId(replyId);
    setReplyContent(content);
    setEditReplyContent(content);
    setReplyExpanded(true);
    setTimeout(() => replyTextareaRef.current?.focus(), 100);
  };

  const toggleQuote = (replyId: number) => {
    setExpandedQuotes((prev) => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  };

  const insertMarkdown = (prefix: string, suffix: string, placeholder: string) => {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = replyContent.substring(start, end);
    const insertText = selectedText || placeholder;
    const before = replyContent.substring(0, start);
    const after = replyContent.substring(end);
    const newContent = before + prefix + insertText + suffix + after;
    setReplyContent(newContent);
    requestAnimationFrame(() => {
      textarea.focus();
      const selStart = start + prefix.length;
      textarea.setSelectionRange(selStart, selStart + insertText.length);
    });
  };

  const handleSelectMessage = (id: number) => {
    setSelectedMessageId(id);
    setReplyingId(null);
    setEditingReplyId(null);
    setReplyContent('');
    setEditReplyContent('');
    setReplyExpanded(false);
  };

  // ---- Render ----

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 1. Status tab bar */}
      <div className="h-12 flex items-center justify-between px-4 bg-card border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold hidden sm:block">留言管理</h1>
        </div>
        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 justify-center">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
          共 {total} 条
        </span>
      </div>

      {/* 2. Cross-column toolbar */}
      <div className="flex md:grid md:grid-cols-[340px_1fr] h-11 border-b border-border flex-shrink-0">
        <div className="hidden md:flex items-center gap-2 px-3.5 bg-muted">
          <input
            type="checkbox"
            checked={selectedIds.size === messages.length && messages.length > 0}
            onChange={toggleSelectAll}
            className="rounded"
          />
          <span className="text-xs text-muted-foreground">
            {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '全选'}
          </span>
        </div>
        <div className="flex items-center gap-2 px-4 bg-card flex-1 overflow-x-auto">
          <button
            onClick={() => handleBatch('delete')}
            disabled={actionLoading || selectedIds.size === 0}
            className="msg-tb-btn msg-btn-gray"
          >
            <Trash2 className="w-3.5 h-3.5" />删除
          </button>
          <button
            onClick={() => {
              if (selectedIds.size === 1) {
                const id = [...selectedIds][0];
                if (id !== undefined) {
                  handleSelectMessage(id);
                  openReplyEditor(id);
                }
              }
            }}
            disabled={selectedIds.size !== 1 || actionLoading}
            className="msg-tb-btn msg-btn-primary"
          >
            <Reply className="w-3.5 h-3.5" />回复
          </button>
          <button
            onClick={() => handleBatch('approve')}
            disabled={actionLoading || selectedIds.size === 0}
            className="msg-tb-btn msg-btn-blue"
          >
            <Check className="w-3.5 h-3.5" />通过
          </button>
          <button
            onClick={() => handleBatch('feature')}
            disabled={actionLoading || selectedIds.size === 0}
            className="msg-tb-btn msg-btn-gray"
          >
            <Star className="w-3.5 h-3.5" />精选
          </button>
          <button
            onClick={() => handleBatch('restore')}
            disabled={actionLoading || selectedIds.size === 0}
            className="msg-tb-btn msg-btn-gray"
          >
            <RotateCcw className="w-3.5 h-3.5" />恢复
          </button>
        </div>
      </div>

      {/* 3. Main content area */}
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-1 md:grid-cols-[340px_1fr]">

        {/* Left column - conversation list */}
        <div
          className={`${selectedMessageId !== null ? 'hidden' : 'flex'} md:flex flex-col border-r border-border bg-secondary overflow-hidden min-h-0`}
        >
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              暂无留言
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {messages.map((msg) => {
                  const isSelected = selectedMessageId === msg.id;
                  const replyCount = msg.replies.length;
                  return (
                    <div
                      key={msg.id}
                      className={`msg-conv-row ${isSelected ? 'msg-conv-selected' : ''}`}
                      onClick={() => handleSelectMessage(msg.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(msg.id)}
                        onChange={() => toggleSelect(msg.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 rounded flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{msg.visitor_name}</span>
                          {replyCount > 0 && (
                            <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-muted text-muted-foreground rounded-full">
                              {replyCount}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {msg.page_title}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-1">
                          {msg.content}
                        </div>
                      </div>
                      <span className={`msg-dot msg-dot-${msg.status}`} />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-3 px-4 py-2.5 border-t border-border bg-card flex-shrink-0">
                {hasMore ? (
                  <button onClick={loadMore} className="text-xs text-primary hover:underline">
                    加载更多
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    已加载 {messages.length} / {total} 条
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column - detail + reply */}
        <div
          className={`${selectedMessageId !== null ? 'flex' : 'hidden'} md:flex flex-col min-h-0`}
        >
          {selectedMessage ? (
            <>
              {/* Detail area */}
              <div ref={detailScrollRef} className="flex-1 overflow-y-auto bg-card">
                {/* Mobile back button */}
                <button
                  onClick={() => setSelectedMessageId(null)}
                  className="md:hidden flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-5 pt-3"
                >
                  <ChevronLeft className="w-4 h-4" />返回列表
                </button>

                {/* Header */}
                <div className="px-5 py-4 border-b border-border-subtle">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold">{selectedMessage.visitor_name}</span>
                    {selectedMessage.visitor_email && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />{selectedMessage.visitor_email}
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-muted text-muted-foreground">
                      {STATUS_LABEL[selectedMessage.status] || selectedMessage.status}
                    </span>
                    {selectedMessage.needs_review === 1 && (
                      <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-muted text-muted-foreground">
                        需审核
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                    <span>ID: {selectedMessage.id}</span>
                    {selectedMessage.visitor_website && <span>站点: {selectedMessage.visitor_website}</span>}
                    {selectedMessage.visitor_ip && <span>IP: {selectedMessage.visitor_ip}</span>}
                    <span>{formatFullTime(selectedMessage.created_at)}</span>
                  </div>
                  {selectedMessage.page_url && (
                    <a
                      href={selectedMessage.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />{selectedMessage.page_title}
                    </a>
                  )}
                </div>

                {/* Thread timeline */}
                <div className="px-5 py-4 flex flex-col gap-3">
                  {buildThread(selectedMessage).map((part, idx) => {
                    const isExpanded = part.replyId !== undefined && expandedQuotes.has(part.replyId);
                    return (
                      <div key={idx} className={`msg-part ${part.type}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="msg-part-label">
                            {part.type === 'visitor' ? '留言' : part.type === 'blogger' ? '博主' : '邮箱回信'}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatTime(part.time)}
                          </span>
                          {part.type === 'blogger' && part.replyId !== undefined && (
                            <div className="flex items-center gap-2 ml-auto">
                              <button
                                onClick={() => openEditEditor(selectedMessage.id, part.replyId!, part.content)}
                                disabled={actionLoading}
                                className="text-[11px] text-primary hover:underline"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleDeleteReply(selectedMessage.id, part.replyId!)}
                                disabled={actionLoading}
                                className="text-[11px] text-destructive hover:underline"
                              >
                                删除
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Inbound: show from email info */}
                        {part.type === 'inbound' && part.replyFromEmail && (
                          <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
                            <Mail className="w-3 h-3" />From: {part.replyFromEmail}
                          </div>
                        )}

                        {/* Markdown content */}
                        <div
                          className="msg-md-body"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(part.content) }}
                        />

                        {/* Visitor quoted text */}
                        {part.type === 'visitor' && selectedMessage.quoted_text && (
                          <blockquote className="mt-2 pl-3 border-l-2 border-border-subtle text-xs text-muted-foreground italic">
                            {selectedMessage.quoted_text}
                          </blockquote>
                        )}

                        {/* Inbound email quote collapsible */}
                        {part.type === 'inbound' && part.replyFromEmail && part.replyId !== undefined && (
                          <div className={`msg-email-quote ${isExpanded ? 'expanded' : ''}`}>
                            <button
                              className="msg-email-quote-toggle"
                              onClick={() => toggleQuote(part.replyId!)}
                            >
                              <ChevronRight /> 引用原邮件
                            </button>
                            <div className="msg-email-quote-body">
                              <div className="msg-email-quote-meta">
                                <span>From: {part.replyFromEmail}</span>
                                <span>Date: {formatFullTime(part.time)}</span>
                              </div>
                              <div
                                className="msg-md-body"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(part.content) }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reply editor / action bar */}
              {replyExpanded && replyingId !== null ? (
                <div className="flex-shrink-0 border-t border-border bg-card">
                  {/* Header */}
                  <div className="flex items-center gap-2 px-5 py-2 border-b border-border-subtle">
                    <button
                      onClick={() => {
                        setReplyExpanded(false);
                        setReplyContent('');
                        setEditReplyContent('');
                        setEditingReplyId(null);
                        setReplyingId(null);
                      }}
                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-muted-foreground flex-shrink-0">回复给</span>
                    <span className="text-xs font-medium truncate">{selectedMessage.visitor_name}</span>
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {selectedMessage.content.slice(0, 40)}
                    </span>
                    {editingReplyId !== null && (
                      <span className="text-[11px] text-primary flex-shrink-0">编辑中</span>
                    )}
                    <button
                      onClick={() => {
                        setReplyExpanded(false);
                        setReplyContent('');
                        setEditReplyContent('');
                        setEditingReplyId(null);
                        setReplyingId(null);
                      }}
                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Markdown toolbar */}
                  <div className="flex items-center gap-0.5 px-5 py-1.5 border-b border-border-subtle">
                    <button onClick={() => insertMarkdown('**', '**', '加粗文本')} className="msg-rt-btn" title="加粗"><Bold /></button>
                    <button onClick={() => insertMarkdown('*', '*', '斜体文本')} className="msg-rt-btn" title="斜体"><Italic /></button>
                    <button onClick={() => insertMarkdown('`', '`', 'code')} className="msg-rt-btn" title="行内代码"><Code /></button>
                    <button onClick={() => insertMarkdown('[', '](url)', '链接文本')} className="msg-rt-btn" title="链接"><LinkIcon /></button>
                    <div className="w-px h-5 bg-border-subtle mx-1" />
                    <button onClick={() => insertMarkdown('## ', '', '标题')} className="msg-rt-btn" title="标题"><Heading /></button>
                    <button onClick={() => insertMarkdown('- ', '', '列表项')} className="msg-rt-btn" title="列表"><List /></button>
                    <button onClick={() => insertMarkdown('> ', '', '引用')} className="msg-rt-btn" title="引用"><Quote /></button>
                  </div>

                  {/* Textarea */}
                  <textarea
                    ref={replyTextareaRef}
                    value={replyContent}
                    onChange={(e) => {
                      setReplyContent(e.target.value);
                      setEditReplyContent(e.target.value);
                    }}
                    className="w-full min-h-[200px] px-5 py-3 text-sm bg-transparent border-none resize-y focus:outline-none"
                    placeholder="输入回复内容..."
                  />

                  {/* Footer */}
                  <div className="flex items-center justify-between px-5 py-2 border-t border-border-subtle">
                    <span className="text-xs text-muted-foreground">支持 Markdown 格式</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setReplyExpanded(false);
                          setReplyContent('');
                          setEditReplyContent('');
                          setEditingReplyId(null);
                          setReplyingId(null);
                        }}
                        className="msg-tb-btn msg-btn-gray"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleSubmitReply(selectedMessage.id)}
                        disabled={actionLoading || !replyContent.trim()}
                        className="msg-tb-btn msg-btn-primary"
                      >
                        {actionLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        {editingReplyId !== null ? '更新' : '发送'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Collapsed action bar */
                <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 border-t border-border bg-card">
                  <button
                    onClick={() => openReplyEditor(selectedMessage.id)}
                    className="msg-tb-btn msg-btn-primary"
                  >
                    <Reply className="w-3.5 h-3.5" />回复
                  </button>
                  {selectedMessage.status !== 'approved' && (
                    <button
                      onClick={() => handleAction(selectedMessage.id, 'approve')}
                      disabled={actionLoading}
                      className="msg-tb-btn msg-btn-blue"
                    >
                      <Check className="w-3.5 h-3.5" />通过
                    </button>
                  )}
                  {selectedMessage.status !== 'featured' && (
                    <button
                      onClick={() => handleAction(selectedMessage.id, 'feature')}
                      disabled={actionLoading}
                      className="msg-tb-btn msg-btn-gray"
                    >
                      <Star className="w-3.5 h-3.5" />精选
                    </button>
                  )}
                  {selectedMessage.status === 'spam' && (
                    <button
                      onClick={() => handleAction(selectedMessage.id, 'restore')}
                      disabled={actionLoading}
                      className="msg-tb-btn msg-btn-gray"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />恢复
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(selectedMessage.id, 'delete')}
                    disabled={actionLoading}
                    className="msg-tb-btn msg-btn-gray ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />删除
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              选择左侧留言查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
