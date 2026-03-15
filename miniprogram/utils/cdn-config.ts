// 原始 CDN base（JSON 中硬编码的）
const ORIGINAL_CDN_BASE = 'https://cdn.jsdelivr.net/gh/SleepyShark709/gundam-menu@68f259b/public/images/bandai/';

// 实际使用的 CDN base（日本万代官网直链）
const CDN_BASE = 'https://bandai-hobby.net/images/';

export function resolveImageUrl(url: string): string {
  if (!url) return url;
  return url.replace(ORIGINAL_CDN_BASE, CDN_BASE);
}
