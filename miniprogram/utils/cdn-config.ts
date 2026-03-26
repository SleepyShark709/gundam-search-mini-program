// 原始 CDN base（本地 JSON 中硬编码的）
const ORIGINAL_CDN_BASE = 'https://cdn.jsdelivr.net/gh/SleepyShark709/gundam-menu@68f259b/public/images/bandai/';

// 本地 JSON 兜底时使用的 CDN（日本万代官网直链）
const FALLBACK_CDN_BASE = 'https://bandai-hobby.net/images/';

// 云托管容器域名（部署后在微信云托管控制台获取）
// 格式如：https://env-xxxxx.sh.run.tcloudbase.com
// TODO: 部署后替换为实际域名
const CONTAINER_DOMAIN = '';

/**
 * 解析图片 URL
 *
 * - API 返回的 /images/xxx.jpg：拼接容器域名访问（国内节点，速度快）
 * - 本地 JSON 兜底的 jsdelivr URL：重写为万代官网直链
 */
export function resolveImageUrl(url: string): string {
  if (!url) return url;
  // 后端返回的本地路径，拼接容器域名
  if (url.startsWith('/images/')) {
    if (CONTAINER_DOMAIN) return CONTAINER_DOMAIN + url;
    // 容器域名未配置时：仅对单文件名降级到万代官网直链
    // 多图路径如 /images/rg-l-131/0.jpg 无法降级，返回空字符串
    const relativePath = url.replace('/images/', '');
    if (relativePath.includes('/')) return '';
    return FALLBACK_CDN_BASE + relativePath;
  }
  // 本地 JSON 兜底：重写 jsdelivr → 万代官网
  return url.replace(ORIGINAL_CDN_BASE, FALLBACK_CDN_BASE);
}
