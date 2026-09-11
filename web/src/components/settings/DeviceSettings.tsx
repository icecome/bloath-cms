// 登录设备管理：展示所有已登录设备，可信任当前设备、删除其他设备
import { useState, useEffect, useCallback } from 'react';
import { listDevices, setDeviceTrusted, deleteDevice, type DeviceEntry } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { Loader2, Monitor, Smartphone, Trash2 } from 'lucide-react';

function formatLoginTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 从 UA 提取可读设备描述 */
function describeDevice(ua: string | null): string {
  if (!ua) return '未知设备';
  // 提取平台信息
  let platform = '';
  if (/windows nt/i.test(ua)) platform = 'Windows';
  else if (/mac os x|macintosh/i.test(ua)) platform = 'macOS';
  else if (/android/i.test(ua)) platform = 'Android';
  else if (/iphone|ipad|ios/i.test(ua)) platform = 'iOS';
  else if (/linux/i.test(ua)) platform = 'Linux';

  // 提取浏览器
  let browser = '';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\/|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox\/|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  if (platform && browser) return `${platform} · ${browser}`;
  if (platform) return platform;
  if (browser) return browser;
  // 截断过长的 UA
  return ua.length > 40 ? ua.slice(0, 40) + '…' : ua;
}

function DeviceIcon({ ua }: { ua: string | null }) {
  if (!ua) return <Monitor className="w-3.5 h-3.5 text-muted-foreground" />;
  if (/android|iphone|ipad|mobile/i.test(ua)) {
    return <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />;
  }
  return <Monitor className="w-3.5 h-3.5 text-muted-foreground" />;
}

export function DeviceSettings() {
  const { addToast } = useToast();
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFingerprint, setSavingFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDevices()
      .then((list) => {
        if (!cancelled) setDevices(list);
      })
      .catch((err) => {
        if (!cancelled) addToast({ message: `加载设备失败: ${(err as Error).message}`, type: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [addToast]);

  const handleToggleTrusted = useCallback(async (device: DeviceEntry) => {
    if (!device.isCurrent) return;
    const next = !device.trusted;
    setSavingFingerprint(device.fingerprint);
    try {
      await setDeviceTrusted(next);
      setDevices(prev =>
        prev.map(d =>
          d.fingerprint === device.fingerprint ? { ...d, trusted: next } : d
        )
      );
      addToast({
        message: next
          ? '已信任本设备，7 天内登录自动续期'
          : '已取消信任，本设备登录 6 小时后过期',
        type: 'success'
      });
    } catch (err) {
      addToast({ message: `设置失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSavingFingerprint(null);
    }
  }, [addToast]);

  const handleDelete = useCallback(async (device: DeviceEntry) => {
    if (device.isCurrent) return;
    if (!window.confirm(`确定要移除设备「${describeDevice(device.ua)}」吗？该设备将降级为未信任（会话缩短至 6 小时）。`)) {
      return;
    }
    setSavingFingerprint(device.fingerprint);
    try {
      await deleteDevice(device.fingerprint);
      setDevices(prev => prev.filter(d => d.fingerprint !== device.fingerprint));
      addToast({ message: '设备已移除', type: 'success' });
    } catch (err) {
      addToast({ message: `删除失败: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSavingFingerprint(null);
    }
  }, [addToast]);

  if (loading) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">登录设备</h3>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载设备列表...
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">登录设备</h3>
      <p className="text-xs text-muted-foreground">
        共 {devices.length} 台设备。受信任的设备登录有效期 7 天，未信任的 6 小时；期限内访问均自动续期。移除设备将降低其信任级别，已签发的会话在到期前仍可使用。
      </p>

      {devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无设备记录</p>
      ) : (
        <div className="space-y-px">
          {devices.map((device) => (
            <div
              key={device.fingerprint}
              className="flex items-start gap-3 py-2.5 px-2 rounded-sm hover:bg-accent transition-colors border-b border-border last:border-b-0 group"
            >
              <div className="mt-0.5">
                <DeviceIcon ua={device.ua} />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-foreground font-medium">
                    {describeDevice(device.ua)}
                  </span>
                  {device.isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary">
                      当前设备
                    </span>
                  )}
                  {device.trusted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                      受信任
                    </span>
                  )}
                </div>
                {device.lastLoginAt > 0 && (
                  <p className="text-xs text-muted-foreground">
                    最近登录：{formatLoginTime(device.lastLoginAt)}
                  </p>
                )}
                {device.isCurrent && (
                  <label className="flex items-center gap-1.5 cursor-pointer pt-0.5">
                    <input
                      type="checkbox"
                      checked={device.trusted}
                      disabled={savingFingerprint === device.fingerprint}
                      onChange={() => handleToggleTrusted(device)}
                      className="scale-90"
                    />
                    <span className="text-xs text-muted-foreground">
                      信任此设备，7 天免登录
                    </span>
                  </label>
                )}
              </div>
              {!device.isCurrent && (
                <button
                  type="button"
                  onClick={() => handleDelete(device)}
                  disabled={savingFingerprint === device.fingerprint}
                  className="mt-0.5 text-muted-foreground hover:text-destructive focus-visible:text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                  aria-label="移除设备"
                  title="移除该设备"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
