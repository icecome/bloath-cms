// S3 媒体源辅助（P1-001 重写）：凭据已迁 Worker 侧。
// 连接配置（endpoint/bucket/AK/SK/前缀）存 Worker 侧 D1（mediaS3Config.service），
// 页面通过 /api/media/s3/config 的 configured 字段异步获知，前端不再持有连接信息。
// 本模块仅保留外链视图类型，供页面层对 s3MediaClient 的调用点平滑过渡。

/** 兼容旧调用点的视图类型：代理模式下只有外链基址有意义 */
export type { S3MediaSourceView } from './s3MediaClient';
