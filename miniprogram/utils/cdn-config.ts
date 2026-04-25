import { USE_LOCAL, LOCAL_BASE } from './api';

// 原始 CDN base（本地 JSON 中硬编码的）
const ORIGINAL_CDN_BASE = 'https://cdn.jsdelivr.net/gh/SleepyShark709/gundam-menu@68f259b/public/images/bandai/';

// 云托管容器域名
const CONTAINER_DOMAIN = 'https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com';

/** 根据环境获取图片基础域名 */
function getImageBase(): string {
  return USE_LOCAL ? LOCAL_BASE : CONTAINER_DOMAIN;
}

/**
 * 解析图片 URL
 *
 * - API 返回的 /images/xxx 相对路径：根据环境拼接本地或云端域名
 * - jsdelivr 完整 URL：提取文件名转为容器路径，失败时保留原 URL（jsdelivr 可用）
 * - 其他完整 URL：原样返回
 */
export function resolveImageUrl(url: string): string {
  if (!url) return url;
  // 后端返回的相对路径，拼接环境对应的域名
  if (url.startsWith('/images/')) {
    const base = getImageBase();
    if (base) return base + url;
    return url;
  }
  // jsdelivr URL：提取文件名，转为本地/容器路径加载
  if (url.startsWith(ORIGINAL_CDN_BASE)) {
    const filename = url.replace(ORIGINAL_CDN_BASE, '');
    const base = getImageBase();
    if (base) return `${base}/images/${filename}`;
  }
  return url;
}
