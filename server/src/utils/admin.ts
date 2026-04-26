/**
 * 通过环境变量 ADMIN_OPENIDS 配置管理员白名单（逗号分隔）。
 * 例：ADMIN_OPENIDS=oxxxxxxxxx,oyyyyyyyyy
 */
const adminSet = new Set(
  (process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

export function isAdmin(openid: string): boolean {
  return adminSet.has(openid);
}
