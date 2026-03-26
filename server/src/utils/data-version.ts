import pool from '../db/pool';
import { RowDataPacket } from 'mysql2';

/**
 * 获取数据版本号（基于 models 表最新 updated_at）
 * 返回 YYYY-MM-DD 格式字符串
 */
export async function getDataVersion(): Promise<string> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT MAX(updated_at) AS latest FROM models'
    );
    if (rows.length > 0 && rows[0].latest) {
      const d = new Date(rows[0].latest);
      return d.toISOString().slice(0, 10);
    }
  } catch (e) {
    console.error('[getDataVersion]', e);
  }
  return new Date().toISOString().slice(0, 10);
}
