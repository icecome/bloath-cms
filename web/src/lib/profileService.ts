// 站点 Profile 服务：框架识别结果 → 自动匹配 Profile → localStorage 持久化（可手动覆盖）
import type { ProfileId, SiteProfile } from '../../../shared/profiles';
import { BUILTIN_PROFILES, frameworkToProfileId, getProfile } from '../../../shared/profiles';
import { detectFramework } from './detectFramework';

const PROFILE_KEY_PREFIX = 'bloath_profile_';

interface StoredProfileRef {
  /** 生效的 Profile id */
  id: ProfileId;
  /** true = 框架识别自动匹配；false = 用户手动指定 */
  detected: boolean;
}

function storageKey(owner: string, repo: string): string {
  return `${PROFILE_KEY_PREFIX}${owner}_${repo}`;
}

function readStoredRef(owner: string, repo: string): StoredProfileRef | null {
  try {
    const raw = localStorage.getItem(storageKey(owner, repo));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProfileRef;
    if (parsed && parsed.id && parsed.id in BUILTIN_PROFILES) return parsed;
  } catch {
    // 存储损坏时按未配置处理
  }
  return null;
}

function writeStoredRef(owner: string, repo: string, ref: StoredProfileRef): void {
  try {
    localStorage.setItem(storageKey(owner, repo), JSON.stringify(ref));
  } catch {
    // 隐私模式或存储已满，忽略持久化错误
  }
}

/**
 * 获取仓库生效的 Profile：
 * 1. 用户手动覆盖（若有）
 * 2. 已缓存的识别结果
 * 3. 现场识别（getTree），未识别出框架回退 custom
 */
export async function getProfileForRepo(
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<SiteProfile> {
  const stored = readStoredRef(owner, repo);
  if (stored) return getProfile(stored.id);

  let id: ProfileId = 'custom';
  try {
    const info = await detectFramework(owner, repo, branch);
    if (info) id = frameworkToProfileId(info.name);
  } catch {
    // 识别失败按 custom 处理
  }
  writeStoredRef(owner, repo, { id, detected: true });
  return getProfile(id);
}

/** 用户手动覆盖（设置页切换 Profile） */
export function setProfileOverride(owner: string, repo: string, id: ProfileId): void {
  writeStoredRef(owner, repo, { id, detected: false });
}

/** 清除覆盖，恢复自动识别 */
export function clearProfileOverride(owner: string, repo: string): void {
  try {
    localStorage.removeItem(storageKey(owner, repo));
  } catch {
    // ignore
  }
}

export function getStoredProfileRef(owner: string, repo: string): StoredProfileRef | null {
  return readStoredRef(owner, repo);
}
