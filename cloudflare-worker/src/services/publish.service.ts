// 发布编排器：全量缓冲 → 幂等预检 → batchCommit → 清理
import type { Env } from '../env';
import type { CommitOp } from './github';
import { batchCommit, buildCommitAuthor, getTree, GithubApiError } from './github';
import {
  requireBufferConfig, readBufferFull, cleanupBufferKeys,
} from './buffer.service';

export interface PublishResult {
  commitSha: string | null;
  published: number;
  skipped: number;
  bufferCleared: number;
  cleanupFailed: number;
  message: string;
}

export async function publishBuffer(
  env: Env, githubToken: string,
  owner: string, repo: string, branch: string, userName?: string
): Promise<PublishResult> {
  await requireBufferConfig(env);
  const buffered = await readBufferFull(env, owner, repo, branch);

  if (buffered.length === 0) {
    return {
      commitSha: null, published: 0, skipped: 0, bufferCleared: 0, cleanupFailed: 0,
      message: '缓冲区为空，无待发布变更',
    };
  }

  // 拉取远端树做幂等预检（path → sha 映射）
  const tree = await getTree(githubToken, owner, repo, branch);
  const remoteShas = new Map<string, string>();
  for (const item of tree) remoteShas.set(item.path, item.sha);

  const ops: CommitOp[] = [];
  const keysToClear: string[] = [];
  let skipped = 0;

  for (const { path, entry, key } of buffered) {
    if (entry.op === 'write') {
      ops.push({ op: 'write', path, content: entry.content ?? '' });
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
      if (from && remoteShas.has(from)) {
        ops.push({ op: 'move', fromPath: from, path });
      } else {
        skipped++; // 源已不存在（上次已移动），幂等跳过
      }
      keysToClear.push(key);
    }
  }

  let commitSha: string | null = null;
  let published = 0;

  if (ops.length > 0) {
    const author = buildCommitAuthor(userName);
    const message = `发布缓冲变更 (${ops.length} 项)`;
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
