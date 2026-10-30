// 并行媒体仓库解析测试（resolveMediaSource）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMediaSource, resolveMediaBackend, getBackend, enabledBackends,
} from './mediaBackendResolve.ts';
import type { MediaConfig, SelectedRepo } from '../../../shared/types';

const repo: SelectedRepo = { owner: 'me', repo: 'blog', branch: 'main' };

function cfg(partial: Partial<MediaConfig>): MediaConfig {
  return {
    sourceType: 'standalone',
    imageOwner: '', imageRepo: '', imageBranch: 'main',
    mediaPath: 'assets', imageBranchName: 'assets',
    cdnProvider: 'jsdelivr', customCdnTemplate: '',
    quality: 80, renameTemplate: '{{filename}}',
    duplicateStrategy: 'skip', uploadMode: 'compress',
    backends: [],
    defaultBackendId: '',
    ...partial,
  };
}

describe('resolveMediaBackend', () => {
  it('standalone 后端按 owner/repo/branch 定位', () => {
    const c = cfg({
      backends: [{ id: 'gh', kind: 'standalone', label: '图床', enabled: true, owner: 'o', repo: 'r', branch: 'main' }],
      defaultBackendId: 'gh',
    });
    const s = resolveMediaBackend(c, 'gh', repo);
    assert.equal(s.owner, 'o');
    assert.equal(s.repo, 'r');
    assert.equal(s.branch, 'main');
    assert.equal(s.configured, true);
  });

  it('standalone 未填 owner/repo 时未配置', () => {
    const c = cfg({ backends: [{ id: 'gh', kind: 'standalone', label: '图床', enabled: true }], defaultBackendId: 'gh' });
    const s = resolveMediaBackend(c, 'gh', repo);
    assert.equal(s.configured, false);
    assert.ok(s.missingHint);
  });

  it('repo-dir 后端用当前博客仓库 + pathPrefix', () => {
    const c = cfg({
      backends: [{ id: 'rd', kind: 'repo-dir', label: '子目录', enabled: true, pathPrefix: 'static/images' }],
      defaultBackendId: 'rd',
    });
    const s = resolveMediaBackend(c, 'rd', repo);
    assert.equal(s.owner, 'me');
    assert.equal(s.repo, 'blog');
    assert.equal(s.pathPrefix, 'static/images');
  });

  it('repo-dir 无选中仓库时未配置', () => {
    const c = cfg({ backends: [{ id: 'rd', kind: 'repo-dir', label: '子目录', enabled: true }], defaultBackendId: 'rd' });
    const s = resolveMediaBackend(c, 'rd', null);
    assert.equal(s.configured, false);
  });

  it('image-branch 后端用 branch 字段', () => {
    const c = cfg({
      backends: [{ id: 'ib', kind: 'image-branch', label: '分支', enabled: true, branch: 'assets' }],
      defaultBackendId: 'ib',
    });
    const s = resolveMediaBackend(c, 'ib', repo);
    assert.equal(s.branch, 'assets');
    assert.equal(s.owner, 'me');
  });

  it('s3 后端返回占位 source（不走 GitHub 路径）', () => {
    const c = cfg({
      backends: [{ id: 's3', kind: 's3', label: 'R2', enabled: true, s3PublicBaseUrl: 'https://x/{path}' }],
      defaultBackendId: 's3',
    });
    const s = resolveMediaBackend(c, 's3', repo);
    assert.equal(s.owner, '');
    assert.equal(s.configured, true);
  });

  it('backendId 不存在时回退默认后端', () => {
    const c = cfg({
      backends: [
        { id: 'a', kind: 'standalone', label: 'A', enabled: true, owner: 'o1', repo: 'r1' },
        { id: 'b', kind: 'standalone', label: 'B', enabled: true, owner: 'o2', repo: 'r2' },
      ],
      defaultBackendId: 'b',
    });
    const s = resolveMediaBackend(c, 'not-exist', repo);
    assert.equal(s.owner, 'o2');
  });

  it('backends 为空时返回未配置态', () => {
    const s = resolveMediaBackend(cfg({ backends: [] }), 'x', repo);
    assert.equal(s.configured, false);
  });
});

describe('resolveMediaSource', () => {
  it('backends 非空时按默认后端解析', () => {
    const c = cfg({
      backends: [{ id: 'a', kind: 'standalone', label: 'A', enabled: true, owner: 'o1', repo: 'r1' }],
      defaultBackendId: 'a',
    });
    assert.equal(resolveMediaSource(c, repo).owner, 'o1');
  });

  it('backends 为空（旧配置）时回退 sourceType + 扁平字段', () => {
    const c = cfg({
      sourceType: 'standalone', imageOwner: 'legacy', imageRepo: 'repo', imageBranch: 'main',
      backends: [], defaultBackendId: '',
    });
    const s = resolveMediaSource(c, repo);
    assert.equal(s.owner, 'legacy');
    assert.equal(s.repo, 'repo');
  });
});

describe('getBackend / enabledBackends', () => {
  it('getBackend 按 id 取，未命中回退默认', () => {
    const c = cfg({
      backends: [
        { id: 'a', kind: 'standalone', label: 'A', enabled: true },
        { id: 'b', kind: 's3', label: 'B', enabled: false },
      ],
      defaultBackendId: 'b',
    });
    assert.equal(getBackend(c, 'a')?.id, 'a');
    assert.equal(getBackend(c, 'zzz')?.id, 'b');
  });

  it('enabledBackends 只返回启用项', () => {
    const c = cfg({
      backends: [
        { id: 'a', kind: 'standalone', label: 'A', enabled: true },
        { id: 'b', kind: 's3', label: 'B', enabled: false },
      ],
      defaultBackendId: 'a',
    });
    assert.deepEqual(enabledBackends(c).map((b) => b.id), ['a']);
  });
});
