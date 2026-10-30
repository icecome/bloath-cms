// 媒体 S3 配置的分键存储与历史单桶迁移（零依赖纯逻辑 + 可注入的存储端口）。
//
// 为什么独立于 mediaS3Config.service.ts：后者导入 crypto/settings.service（D1 类型与
// 加解密），node --experimental-strip-types 测试链路无法加载。存储逻辑本身只是
// 「分键 + 历史键回退」，抽成端口注入即可单测（AGENTS.md §4.3 同范式）。
//
// 分键约定：`media_s3_config:<backendId>`；历史单桶键 `media_s3_config` 仅在
// 读取缺省 backend 时作为迁移源（幂等：原键保留，重复读不再触发）。
import { normalizeBackendId } from './mediaBackendId.ts';

/** 分键前缀 */
export const S3_CONFIG_KEY_PREFIX = 'media_s3_config';

/** 历史（单桶时代）键名：读取缺省 id 时作为迁移源 */
export const LEGACY_CONFIG_KEY = 'media_s3_config';

export function storageKey(backendId: string): string {
  return `${S3_CONFIG_KEY_PREFIX}:${backendId}`;
}

/** 存储端口：测试用内存实现，生产用 settings.service 的 D1 读写 */
export interface SettingStorePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * 读取指定 backend 的存储值；缺省 id 时尝试历史单桶键并自动迁移。
 * 返回 null 表示该 backend 未配置。迁移幂等：原键保留，分键存在后不再读历史键。
 */
export async function getStoredS3Config(
  store: SettingStorePort,
  backendId: string
): Promise<string | null> {
  const value = await store.get(storageKey(backendId));
  if (value !== null) return value || null;

  // 分键缺失：仅缺省 id 才回退历史单桶键并迁移（显式 id 的 backend 不误读他人配置）
  if (backendId === 'default') {
    const legacy = await store.get(LEGACY_CONFIG_KEY);
    if (legacy) {
      // 迁移 = 拷贝到分键；原键保留（迁移不可逆约定下不做破坏性删除，幂等）
      try {
        await store.set(storageKey(backendId), legacy);
        console.info(`[mediaS3Config] 单桶配置已迁移到分键 ${storageKey(backendId)}`);
      } catch {
        // 迁移写失败不阻断读：本请求继续用历史键值
        return legacy;
      }
      return legacy;
    }
  }
  return null;
}

/** 校验 backendId 并归一（供路由层调用，非法返回 null） */
export { normalizeBackendId };
