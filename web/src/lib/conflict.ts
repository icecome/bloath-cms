// 编辑前冲突检测：保存前复核「本地认知的文件 sha」与远端实际 sha 是否一致。
//
// 背景：batchCommit 的基线复查（worker github.ts）只在提交时以 409 硬失败兜底，
// 用户写半小时文章后才发现冲突，代价过高。这里把检测前移到保存动作的入口：
// 不一致时由 UI 弹窗让用户选择「覆盖 / 另存副本」，避免静默丢失或硬失败。
//
// sha 语义约定（与 EditorPage 的 currentFileSha 一致）：
// - ''：新建文章或仅存在于缓冲（S3），仓库侧无该文件——无冲突可言；
// - 非 ''：仓库内该路径的 blob sha。
import { HttpError } from './http.ts';
import type { RepoInfo } from '../../../shared/types';

/** 远端文件的当前 sha；文件不存在返回 null */
export type RemoteSha = string | null;

/** 冲突类型 */
export type ConflictKind =
  /** 远端文件已被他人/其他设备修改（远端 sha ≠ 本地基线） */
  | 'modified'
  /** 远端文件已不存在（被他人删除），继续保存等于重新创建 */
  | 'deleted';

export interface ConflictCheckResult {
  /** 是否存在冲突（需要用户决策） */
  conflicted: boolean;
  kind?: ConflictKind;
  /** 远端当前 sha（kind=modified 时有值） */
  remoteSha?: string;
}

/**
 * 比对本地基线与远端 sha，产出冲突判定。
 * 纯函数（可单测）：
 * - baseSha 为空 → 新建/缓冲文件，无冲突；
 * - remote 为 null（404）→ deleted；
 * - remote ≠ baseSha → modified；
 * - 一致 → 无冲突。
 */
export function assessConflict(baseSha: string, remote: RemoteSha): ConflictCheckResult {
  if (!baseSha) {
    return { conflicted: false };
  }
  if (remote === null) {
    return { conflicted: true, kind: 'deleted' };
  }
  if (remote !== baseSha) {
    return { conflicted: true, kind: 'modified', remoteSha: remote };
  }
  return { conflicted: false };
}

/** 读取远端文件的函数签名（与 api.ts 的 readFile 对齐，便于注入 mock） */
export type RemoteFileReader = (
  params: RepoInfo & { path: string }
) => Promise<{ sha: string }>;

/**
 * 保存前的完整冲突检查：读取目标路径的远端 sha 并与本地基线比对。
 * 读取失败（网络等）按「无法判定」处理——返回无冲突，让提交时的 409 兜底，
 * 不因检查通道故障阻断保存。
 */
export async function checkConflictBeforeSave(
  readFileFn: RemoteFileReader,
  params: { repo: RepoInfo; path: string; baseSha: string }
): Promise<ConflictCheckResult> {
  if (!params.baseSha) {
    return { conflicted: false };
  }
  try {
    const remote = await readFileFn({ ...params.repo, path: params.path });
    return assessConflict(params.baseSha, remote.sha || null);
  } catch (err) {
    // 404 → deleted；其他错误 → 无法判定，放行给提交时的基线复查兜底
    if (err instanceof HttpError && err.status === 404) {
      return assessConflict(params.baseSha, null);
    }
    console.warn('[conflict] 保存前冲突检查失败（放行，由提交时 409 兜底）：', err);
    return { conflicted: false };
  }
}
