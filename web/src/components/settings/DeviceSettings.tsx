// 登录设备记录：展示当前设备会话状态，可勾选信任本设备（7 天续期）
import { useState, useEffect, useCallback } from 'react';
import { getDeviceInfo, setDeviceTrusted } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { Loader2, Smartphone } from 'lucide-react';

function formatLoginTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DeviceSettings() {
  const { addToast } = useToast();
  const [trusted, setTrusted] = useState(false);
  const [lastLoginAt, setLastLoginAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 加载当前设备会话状态
  useEffect(() => {
    let cancelled = false;
    getDeviceInfo()
      .then((info) => {
        if (cancelled) return;
        setTrusted(info.trusted);
        setLastLoginAt(info.lastLoginAt || 0);
      })
      .catch(() => {
        if (!cancelled) setTrusted(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = useCallback(async () => {
    const next = !trusted;
    setSaving(true);
    try {
      await setDeviceTrusted(next);
      setTrusted(next);
      addToast({
        message: next
          ? '已信任本设备，7 天内登录自动续期'
          : '已取消信任，本设备登录 6 小时后过期',
        type: 'success'
      });
    } catch (err) {
      addToast({ message: `设置失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [trusted, addToast]);

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">登录设备</h3>
      <p className="text-xs text-muted-foreground">
        自动记录当前登录设备。勾选信任后，本设备登录有效期延长至 7 天；未信任的设备登录 6 小时后过期。两者在期限内登录均自动续期。
      </p>
      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载设备信息...
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
              <span>当前设备（{navigator.userAgent?.split('(')[1]?.split(')')[0] || '未知浏览器'}）</span>
              {lastLoginAt > 0 && (
                <span className="text-muted-foreground">最近登录：{formatLoginTime(lastLoginAt)}</span>
              )}
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={trusted}
                disabled={saving}
                onChange={handleToggle}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="block text-xs text-foreground">信任此设备，7 天免登录</span>
                <span className="block text-xs text-muted-foreground">常用设备建议开启，减少频繁登录</span>
              </span>
            </label>
          </>
        )}
      </div>
    </section>
  );
}