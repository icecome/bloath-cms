import { useState, useEffect, useCallback } from 'react';
import {
  listAdminMessages, patchMessageAction, createReply, updateReply, deleteReply,
  batchOperateMessages, type AdminMessage, type AdminListResult,
} from '../lib/commentApi';
import { useToast } from '../contexts/ToastContext';
import { MessageSquare, Check, Star, Ban, Trash2, RotateCcw, Reply, Send, Loader2 } from 'lucide-react';

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'featured', label: '精选' },
  { key: 'spam', label: '垃圾' },
] as const;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '已通过', className: 'bg-green-100 text-green-800' },
  featured: { label: '精选', className: 'bg-blue-100 text-blue-800' },
  spam: { label: '垃圾', className: 'bg-red-100 text-red-800' },
};

export default function MessagesPage() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [activeTab, setActiveTab] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [editReplyContent, setEditReplyContent] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadMessages = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const result: AdminListResult = await listAdminMessages({
        status: status || undefined,
        size: 50,
      });
      setMessages(result.items);
      setTotal(result.total);
    } catch (err) {
      addToast({ message: `加载失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadMessages(activeTab);
  }, [activeTab, loadMessages]);

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
    if (!replyContent.trim()) return;
    setActionLoading(true);
    try {
      await createReply(id, replyContent.trim());
      addToast({ message: '回复成功', type: 'success' });
      setReplyingId(null);
      setReplyContent('');
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

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-5 h-5" />
        <h1 className="text-lg font-semibold">留言管理</h1>
        <span className="text-sm text-muted-foreground">共 {total} 条</span>
      </div>

      {/* 状态 Tab */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-t-sm transition-colors ${
              activeTab === tab.key
                ? 'bg-accent text-foreground font-medium border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-accent rounded-sm">
          <span className="text-sm text-muted-foreground">已选 {selectedIds.size} 条</span>
          <button onClick={() => handleBatch('approve')} disabled={actionLoading} className="px-2 py-1 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700 disabled:opacity-50">通过</button>
          <button onClick={() => handleBatch('feature')} disabled={actionLoading} className="px-2 py-1 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50">精选</button>
          <button onClick={() => handleBatch('spam')} disabled={actionLoading} className="px-2 py-1 text-xs bg-orange-600 text-white rounded-sm hover:bg-orange-700 disabled:opacity-50">垃圾</button>
          <button onClick={() => handleBatch('delete')} disabled={actionLoading} className="px-2 py-1 text-xs bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:opacity-50">删除</button>
        </div>
      )}

      {/* 消息列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">暂无留言</div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={selectedIds.size === messages.length && messages.length > 0}
              onChange={toggleSelectAll}
              className="rounded"
            />
            全选
          </label>

          {messages.map((msg) => {
            const badge = STATUS_BADGE[msg.status] || { label: msg.status, className: 'bg-gray-100 text-gray-800' };
            return (
              <div key={msg.id} className="border border-border rounded-sm p-3 bg-card">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(msg.id)}
                    onChange={() => toggleSelect(msg.id)}
                    className="mt-1 rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{msg.visitor_name}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-sm font-medium ${badge.className}`}>{badge.label}</span>
                      {msg.needs_review === 1 && <span className="px-1.5 py-0.5 text-[10px] rounded-sm bg-orange-100 text-orange-800">需审核</span>}
                      <span className="text-xs text-muted-foreground">{msg.created_at}</span>
                      {msg.visitor_email && <span className="text-xs text-muted-foreground">{msg.visitor_email}</span>}
                    </div>
                    <p className="text-sm mt-1 break-words">{msg.content}</p>
                    {msg.quoted_text && (
                      <blockquote className="mt-1 pl-2 border-l-2 border-border-subtle text-xs text-muted-foreground italic">
                        {msg.quoted_text}
                      </blockquote>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      来源: <a href={msg.page_url} target="_blank" rel="noopener" className="underline hover:text-foreground">{msg.page_title}</a>
                      {msg.visitor_website && <> · 站点: <a href={msg.visitor_website} target="_blank" rel="noopener" className="underline hover:text-foreground">{msg.visitor_website}</a></>}
                    </div>

                    {/* 回复时间线 */}
                    {msg.replies.length > 0 && (
                      <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-border-subtle">
                        {msg.replies.map((reply) => (
                          <div key={reply.id} className="text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">{reply.reply_type}</span>
                              <span className="text-xs text-muted-foreground">{reply.created_at}</span>
                              {reply.reply_type === '博主' && (
                                <span className="flex gap-1">
                                  <button
                                    onClick={() => { setEditingReplyId(reply.id); setEditReplyContent(reply.reply_content); }}
                                    className="text-xs text-blue-600 hover:underline"
                                  >编辑</button>
                                  <button
                                    onClick={() => handleDeleteReply(msg.id, reply.id)}
                                    disabled={actionLoading}
                                    className="text-xs text-red-600 hover:underline"
                                  >删除</button>
                                </span>
                              )}
                            </div>
                            {editingReplyId === reply.id ? (
                              <div className="mt-1 flex gap-1">
                                <input
                                  value={editReplyContent}
                                  onChange={(e) => setEditReplyContent(e.target.value)}
                                  className="flex-1 px-2 py-1 text-sm border border-border rounded-sm"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleUpdateReply(msg.id)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 text-xs bg-foreground text-white rounded-sm"
                                >保存</button>
                                <button
                                  onClick={() => { setEditingReplyId(null); setEditReplyContent(''); }}
                                  className="px-2 py-1 text-xs border border-border rounded-sm"
                                >取消</button>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">{reply.reply_content}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {msg.status !== 'approved' && (
                        <button onClick={() => handleAction(msg.id, 'approve')} disabled={actionLoading} className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700 disabled:opacity-50">
                          <Check className="w-3 h-3" />通过
                        </button>
                      )}
                      {msg.status !== 'featured' && (
                        <button onClick={() => handleAction(msg.id, 'feature')} disabled={actionLoading} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50">
                          <Star className="w-3 h-3" />精选
                        </button>
                      )}
                      {msg.status !== 'spam' && (
                        <button onClick={() => handleAction(msg.id, 'spam')} disabled={actionLoading} className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-600 text-white rounded-sm hover:bg-orange-700 disabled:opacity-50">
                          <Ban className="w-3 h-3" />垃圾
                        </button>
                      )}
                      {msg.status === 'spam' && (
                        <button onClick={() => handleAction(msg.id, 'restore')} disabled={actionLoading} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-600 text-white rounded-sm hover:bg-gray-700 disabled:opacity-50">
                          <RotateCcw className="w-3 h-3" />恢复
                        </button>
                      )}
                      <button onClick={() => handleAction(msg.id, 'delete')} disabled={actionLoading} className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:opacity-50">
                        <Trash2 className="w-3 h-3" />删除
                      </button>
                      <button
                        onClick={() => { setReplyingId(replyingId === msg.id ? null : msg.id); setReplyContent(''); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-sm hover:bg-accent"
                      >
                        <Reply className="w-3 h-3" />回复
                      </button>
                    </div>

                    {/* 回复输入框 */}
                    {replyingId === msg.id && (
                      <div className="mt-2 flex gap-1">
                        <input
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          placeholder="输入回复内容..."
                          className="flex-1 px-2 py-1.5 text-sm border border-border rounded-sm focus:outline-none focus:border-primary"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitReply(msg.id); }}
                        />
                        <button
                          onClick={() => handleSubmitReply(msg.id)}
                          disabled={actionLoading || !replyContent.trim()}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:opacity-80 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />发送
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
