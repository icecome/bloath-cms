// CDN 兜底域轮换（纯函数，可单测）。
//
// 背景（2026-10-30 裂图根因复检）：博客图片经第三方镜像 jsDelivr 类域名
// 分发，镜像侧存在「回源限流 403/429 + 单流限速 + 部分节点 chunked 无
// Content-Length」三类结构性问题，单域偶发不可用会造成整页裂图。
// 前端对可识别的 CDN 图片 URL 做「换域重试」：失败时切到下一个候选域再加载一次。
//
// 候选域来自实测可用性（2026-10-30）：
//   · testingcf.jsdelivr.net —— 默认，实测 150-340KB/s，带完整 Content-Length
//   · gcore.jsdelivr.net   —— 实测可用（约 130KB/s）
//   · cdn.jsdmirror.cn     —— 实测仍可用但 ~110KB/s、无 Content-Length，仅作末位兜底
// 注意：cdn.jsdmirror.com 实测返回 521（源站已挂），已从候选域剔除，不得回填。

const GH_CDN_ORIGINS = [
  'https://testingcf.jsdelivr.net',
  'https://gcore.jsdelivr.net',
  'https://cdn.jsdmirror.cn',
] as const;

// 与 resolveMediaSource.ts 的 mediaCdnUrl 保持一致的路径模板：
// /gh/{owner}/{repo}@{branch}/{path}
const GH_CDN_HOST_RE = /^https:\/\/(?:testingcf\.jsdelivr\.net|gcore\.jsdelivr\.net|cdn\.jsdmirror\.cn)\/gh\//;

/**
 * 判断某 URL 是否为可换域重试的「GitHub CDN 图片直链」。
 * 仅对 GH_CDN_ORIGINS 内的域生效；S3 公网基址、customCdnTemplate、raw 直链
 * 一律不匹配（不破坏其它链路）。
 */
export function isRetryableCdnUrl(url: string): boolean {
  return GH_CDN_HOST_RE.test(url);
}

/**
 * 返回「换域重试序列」中的下一跳：失败域名在候选列表中的位置之后一位。
 *
 * 用「失败域名的下标」而不是外部计数器：避免外部状态与实际域名失同步
 * （例：重试 2 次后回退到起始域，计数器却已指向末位）。
 * 全部候选域试尽仍失败时返回 null（调用方应显示占位，避免死循环）。
 *
 * @param failedUrl 当前加载失败的 URL（必须满足 isRetryableCdnUrl）
 */
export function nextCdnFallback(failedUrl: string): string | null {
  const host = failedUrl.match(/^https:\/\/([^/]+)/)?.[1];
  const current = GH_CDN_ORIGINS.findIndex((o) => o === `https://${host}`);
  const next = current + 1;
  if (current < 0 || next >= GH_CDN_ORIGINS.length) return null;
  // 保留原 URL 的 /gh/ 之后的路径部分（含 query/hash）
  const path = failedUrl.replace(/^https:\/\/[^/]+\/gh\//, '');
  return `${GH_CDN_ORIGINS[next]}/gh/${path}`;
}

/**
 * 图片 <img> 加载失败的统一回调（供媒体库列表 / 预览 / 编辑器预览复用）。
 *
 * 语义：对可换域的 CDN 图片，用失败域的下标推进到下一个候选域；
 * 不可换域（S3 / 自定义 / raw）或已试尽则交给 onGiveUp 兜底
 * （默认隐藏 img、显示占位）。loading="lazy" 的图首次失败时先切 loading="eager"
 * 规避懒加载判定问题。
 *
 * 入参用 React.SyntheticEvent：React 的 onError 事件不是原生 Event
 * （缺 cancelBubble 等 7 个属性），用 Event 类型会导致调用点类型错误。
 */
export function cdnImageErrorHandler(
  event: { target: EventTarget | null },
  onGiveUp?: (img: HTMLImageElement) => void
): void {
  const target = event.target;
  if (!target || !(target instanceof HTMLImageElement)) return;
  const img: HTMLImageElement = target;

  const current = img.currentSrc || img.src;
  const fallback = nextCdnFallback(current);

  if (fallback) {
    if (img.loading === 'lazy') img.loading = 'eager';
    img.src = fallback;
    return;
  }

  // 不可换域或已试尽：隐藏图片，交给调用方显示占位
  img.style.display = 'none';
  onGiveUp?.(img);
}
