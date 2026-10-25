// 发布编排器：全量/逐项缓冲 → 幂等预检 → batchCommit → 清理
import type { Env } from '../env';
import type { CommitOp } from './github';
import { batchCommit, buildCommitAuthor, getTree, GithubApiError } from './github';
import {
  requireBufferConfig, readBufferFull, cleanupBufferKeys,
} from './buffer.service';
// 路径解析语义抽到零依赖模块：可被 node strip-types 单测直接锁定（见 publish-ops.test.ts）
import { resolveMoveTarget, resolvePublishPath } from './publish-paths.ts';

export interface PublishResult {
  commitSha: string | null;
  published: number;
  skipped: number;
  bufferCleared: number;
  cleanupFailed: number;
  message: string;
}

/** 逐项发布参数：path 为缓冲中的原路径，publishTarget 覆盖该条的发布目标 */
export interface PublishItem {
  path: string;
  publishTarget?: string;
}

// resolvePublishPath 已上移到 ./publish-paths（顶部 import），此处仅 re-export 保持兼容
export { resolvePublishPath } from './publish-paths.ts';

export async function publishBuffer(
  env: Env, githubToken: string,
  owner: string, repo: string, branch: string, userName?: string,
  items?: PublishItem[]
): Promise<PublishResult> {
  await requireBufferConfig(env);
  const buffered = await readBufferFull(env, owner, repo, branch);

  if (buffered.length === 0) {
    return {
      commitSha: null, published: 0, skipped: 0, bufferCleared: 0, cleanupFailed: 0,
      message: '缓冲区为空，无待发布变更',
    };
  }

  // 逐项发布时只取选中的条目；items 省略表示全量发布
  // 仅显式携带 publishTarget 时覆盖条目目标；缺省时回落 entry.publishTarget
  const overrideTargets = new Map<string, string | undefined>();
  let selected = buffered;
  if (items && items.length > 0) {
    for (const item of items) {
      if (item.publishTarget !== undefined) overrideTargets.set(item.path, item.publishTarget);
    }
    const selectedPaths = new Set(items.map((i) => i.path));
    selected = buffered.filter((b) => selectedPaths.has(b.path));
    if (selected.length === 0) {
      return {
        commitSha: null, published: 0, skipped: 0, bufferCleared: 0, cleanupFailed: 0,
        message: '选中的条目不在缓冲区中，无待发布变更',
      };
    }
  }

  // 拉取远端树做幂等预检（path → sha 映射）
  const tree = await getTree(githubToken, owner, repo, branch);
  const remoteShas = new Map<string, string>();
  for (const item of tree) remoteShas.set(item.path, item.sha);

  const ops: CommitOp[] = [];
  const keysToClear: string[] = [];
  let skipped = 0;

  for (const { path, entry, key } of selected) {
    // 逐项指定优先于条目自身记录的目标
    const target = overrideTargets.has(path) ? overrideTargets.get(path) : entry.publishTarget;
    const targetPath = resolvePublishPath(path, target);

    if (entry.op === 'write') {
      // write 幂等预检（P1-006）：远端同路径 blob sha 与条目内容一致 → 已同步，
      // 跳过。场景：上次 commit 成功但 S3 清理失败，条目残留缓冲；无此检查时
      // 每次重试都会重推同内容并再次触发 CI 部署。delete/move 已有各自的幂等分支。
      const remoteSha = remoteShas.get(targetPath);
      if (entry.contentSha && remoteSha === entry.contentSha) {
        skipped++;
        keysToClear.push(key);
        continue;
      }
      ops.push({ op: 'write', path: targetPath, content: entry.content ?? '' });
      // 路径被重写时需删掉源文件，否则草稿目录会残留一份
      if (targetPath !== path && remoteShas.has(path)) {
        ops.push({ op: 'delete', path });
      }
      keysToClear.push(key);
    } else if (entry.op === 'delete') {
      if (remoteShas.has(path)) {
        ops.push({ op: 'delete', path });
      } else {
        skipped++; // 已删除，幂等跳过
      }
      keysToClear.push(key);
    } else if (entry.op === 'move') {
      const from = entry.fromPath;
      // move 条目写入缓冲时，path 存的已是目标路径（见 EditorPage 的移入回收站调用）。
      // resolveMoveTarget 封装了「仅显式 target 才重写」的语义——若对无 target 的情况
      // 再调 resolvePublishPath，会把目标解析回源路径，产生 fromPath === path 的移动，
      // 最终在 Git tree 中同路径写成「先写后删」→ 文件丢失（M-R2，已由测试锁定）。
      const toPath = resolveMoveTarget(path, target);
      if (from && from !== toPath && remoteShas.has(from)) {
        ops.push({ op: 'move', fromPath: from, path: toPath });
      } else {
        skipped++; // 源已不存在（上次已移动）或源目标同一路径，幂等跳过
      }
      keysToClear.push(key);
    }
  }

  let commitSha: string | null = null;
  let published = 0;

  if (ops.length > 0) {
    const author = buildCommitAuthor(userName);
    const message = `发布缓冲变更（${ops.length} 项）`;
    const result = await batchCommit(githubToken, owner, repo, branch, message, ops, author);
    commitSha = result.sha;
    published = ops.length;
  }

  // commit 成功后再清理缓冲；清理失败计入结果，避免旧内容被静默重放
  const cleanup = await cleanupBufferKeys(env, keysToClear);
  if (cleanup.failed > 0) {
    console.error(`[publish] 缓冲清理失败 ${cleanup.failed}/${keysToClear.length}，请检查 S3 权限`);
  }

  const baseMsg = ops.length > 0
    ? `已发布 ${published} 项变更${skipped > 0 ? `，跳过 ${skipped} 项已同步` : ''}`
    : `全部 ${skipped} 项变更已同步，无需提交`;
  return {
    commitSha,
    published,
    skipped,
    bufferCleared: cleanup.cleared,
    cleanupFailed: cleanup.failed,
    message: cleanup.failed > 0 ? `${baseMsg}（缓冲清理失败 ${cleanup.failed} 项）` : baseMsg,
  };
}
