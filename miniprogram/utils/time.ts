/**
 * 把数据库返回的时间字符串/Date 转为相对时间显示。
 * 数据库返回 'YYYY-MM-DD HH:MM:SS' 字符串（无时区，按本地时间解释）。
 */
export function formatRelativeTime(input: string | Date | null | undefined): string {
  if (!input) return '';

  let timestamp: number;
  if (input instanceof Date) {
    timestamp = input.getTime();
  } else {
    // mysql2 返回的字符串形如 "2026-04-26 12:34:56"，把空格替换为 T 让 Safari/iOS 也能解析
    const normalized = input.replace(' ', 'T');
    timestamp = new Date(normalized).getTime();
    if (isNaN(timestamp)) return input;
  }

  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}天前`;

  const d = new Date(timestamp);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${m}-${day}`;
  }
  return `${d.getFullYear()}-${m}-${day}`;
}
