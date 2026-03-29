import { USE_LOCAL, LOCAL_BASE } from './api';

// 原始 CDN base（本地 JSON 中硬编码的）
const ORIGINAL_CDN_BASE = 'https://cdn.jsdelivr.net/gh/SleepyShark709/gundam-menu@68f259b/public/images/bandai/';

// 本地 JSON 兜底时使用的 CDN（日本万代官网直链）
const FALLBACK_CDN_BASE = 'https://bandai-hobby.net/images/';

// 云托管容器域名
const CONTAINER_DOMAIN = 'https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com';

/** 根据环境获取图片基础域名 */
function getImageBase(): string {
  return USE_LOCAL ? LOCAL_BASE : CONTAINER_DOMAIN;
}

/**
 * 解析图片 URL
 *
 * - API 返回的 /images/xxx：根据环境拼接本地或云端域名
 * - 本地 JSON 兜底的 jsdelivr URL：重写为万代官网直链
 */
export function resolveImageUrl(url: string): string {
  if (!url) return url;
  // 后端返回的相对路径，拼接环境对应的域名
  if (url.startsWith('/images/')) {
    const base = getImageBase();
    if (base) return base + url;
    // 域名未配置时：仅对单文件名降级到万代官网直链
    const relativePath = url.replace('/images/', '');
    if (relativePath.includes('/')) return '';
    return FALLBACK_CDN_BASE + relativePath;
  }
  // 本地 JSON 兜底：重写 jsdelivr → 万代官网
  return url.replace(ORIGINAL_CDN_BASE, FALLBACK_CDN_BASE);
}
