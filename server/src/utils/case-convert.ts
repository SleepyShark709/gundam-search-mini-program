import { RowDataPacket } from 'mysql2';

/**
 * 将下划线命名的对象键转换为驼峰命名
 */
export function toCamelCase(row: RowDataPacket): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = row[key];
  }
  return result;
}
