// 仓库配置同步的纯逻辑（零依赖，可被 node 原生测试链路直接加载）。
//
// 为什么从 repoConfigSync.ts 抽出：该文件导入 ./api 与 ./http（浏览器 fetch 层，
// 且 import 无 .ts 后缀），node --experimental-strip-types 无法解析，导致同步护栏
// 长期没有测试覆盖——这正是 2026-10-30「S3 配置切页后全丢」缺陷能潜伏到线上的原因
// （同 AGENTS.md R10 记录的 dateParse.ts 教训）。
//
// 本模块只做「凭据剥离」与「是否允许覆盖」两个判定，不碰 IO。
import type { MediaConfig } from '../../../shared/types';

/**
 * 推送/拉取两侧共用的凭据剥离：只剥 media.s3 扁平字段。
 *
 * 为什么不剥 backends：并行多桶改造后背据存于 Worker（分键 media_s3_config:<id>），
 * 仓库侧本就不含凭据；backends[].s3PublicBaseUrl 只是非敏感外链模板。
 * 若把 backends 一起剥掉，切仓库时「仓库为准」会用空列表覆盖本地配置，
 * 表现为用户已保存的媒体仓库（含 S3 后端）在切页后集体消失。
 */
export function stripLegacyS3Credentials(media: MediaConfig): MediaConfig {
  if (!media.s3) return media;
  const { s3: _s3, ...rest } = media;
  return rest as MediaConfig;
}

/**
 * 仓库配置的 media 是否可安全覆盖本地。
 *
 * 「以仓库为准」的必要例外：旧版本 .bloath/config.json 可能是在并行多桶上线前
 * 推送的（无 backends 字段），直接覆盖会把本地 backends 清空。只有仓库侧确实
 * 提供了非空 backends 时才允许覆盖。
 */
export function isSafeToOverwriteMedia(media: MediaConfig): boolean {
  const list = media.backends;
  return Array.isArray(list) && list.length > 0;
}
