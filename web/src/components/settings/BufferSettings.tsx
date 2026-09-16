import { useState, useEffect } from 'react';
import { useBuffer } from '../../contexts/BufferContext';
import { useToast } from '../../contexts/ToastContext';
import { saveBufferConfig, testBufferConfig, type BufferConfigInput } from '../../lib/bufferApi';
import { HardDrive, Plug, Loader2 } from 'lucide-react';

export function BufferSettings() {
  const { config, refreshConfig } = useBuffer();
  const { addToast } = useToast();
  const [form, setForm] = useState<BufferConfigInput>({
    enabled: false,
    endpoint: '',
    region: 'auto',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    prefix: 'tmp/blog',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        enabled: config.enabled,
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: '', // 不回填密钥，留空表示沿用
        prefix: config.prefix,
      });
    }
  }, [config]);

  const update = (patch: Partial<BufferConfigInput>) => setForm((f) => ({ ...f, ...patch }));

  const handleTest = async () => {
    setTesting(true);
    try {
      await testBufferConfig(form);
      addToast({ message: 'S3 连接成功', type: 'success' });
    } catch (err) {
      addToast({ message: `连接失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBufferConfig(form);
      await refreshConfig();
      addToast({ message: '缓冲层配置已保存', type: 'success' });
    } catch (err) {
      addToast({ message: `保存失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-2.5 py-1.5 text-xs border border-border rounded-sm focus:outline-none focus:border-primary bg-card text-foreground placeholder-muted-foreground';
  const labelCls = 'block text-[11px] text-muted-foreground mb-1';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
          <HardDrive className="w-3 h-3" />
          草稿缓冲层（S3 兼容存储）
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="rounded"
          />
          启用缓冲
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        启用后，编辑器保存不再直接提交 GitHub，而是写入 S3 缓冲；点击侧边栏「发布」时一次性提交全部变更。
        建议 bucket 设为私有；若 bucket 公开可读，系统会用随机段隐藏路径，并在发布后立即清理缓冲文件。
      </p>

      {config?.enabled && config.rand && (
        <p className="text-[10px] text-muted-foreground font-mono">
          当前缓冲路径: {config.prefix}/{config.rand}/...
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelCls}>Endpoint（S3 兼容端点）</label>
          <input className={inputCls} value={form.endpoint} onChange={(e) => update({ endpoint: e.target.value })} placeholder="https://s3.example.com" />
        </div>
        <div>
          <label className={labelCls}>Region</label>
          <input className={inputCls} value={form.region} onChange={(e) => update({ region: e.target.value })} placeholder="auto" />
        </div>
        <div>
          <label className={labelCls}>Bucket</label>
          <input className={inputCls} value={form.bucket} onChange={(e) => update({ bucket: e.target.value })} placeholder="my-bucket" />
        </div>
        <div>
          <label className={labelCls}>Access Key ID</label>
          <input className={inputCls} value={form.accessKeyId} onChange={(e) => update({ accessKeyId: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Secret Access Key{config?.secretAccessKeyMasked ? `（已存 ${config.secretAccessKeyMasked}，留空沿用）` : ''}</label>
          <input className={inputCls} type="password" value={form.secretAccessKey} onChange={(e) => update({ secretAccessKey: e.target.value })} autoComplete="new-password" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>路径前缀</label>
          <input className={inputCls} value={form.prefix} onChange={(e) => update({ prefix: e.target.value })} placeholder="tmp/blog" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !form.endpoint || !form.bucket}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-sm hover:bg-accent disabled:opacity-40 transition-colors"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          测试连接
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-white rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          保存配置
        </button>
      </div>
    </div>
  );
}
