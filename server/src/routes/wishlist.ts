import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

const router = Router();

/**
 * GET /api/wishlist
 * 获取当前用户的心愿单模型 ID 列表
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT model_id FROM wishlists WHERE openid = ? ORDER BY created_at DESC',
      [req.openid]
    );

    const modelIds = rows.map((row) => row.model_id as string);
    res.json({ modelIds });
  } catch (err) {
    console.error('[GET /api/wishlist]', err);
    res.status(500).json({ error: '获取心愿单失败' });
  }
});

/**
 * POST /api/wishlist
 * 添加单个模型到心愿单（幂等操作）
 */
router.post('/', async (req: Request, res: Response) => {
  const { modelId } = req.body;

  if (!modelId || typeof modelId !== 'string') {
    res.status(400).json({ error: '参数错误：modelId 为必填字段' });
    return;
  }

  try {
    await pool.query<ResultSetHeader>(
      'INSERT IGNORE INTO wishlists (openid, model_id) VALUES (?, ?)',
      [req.openid, modelId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/wishlist]', err);
    res.status(500).json({ error: '添加心愿单失败' });
  }
});

/**
 * POST /api/wishlist/batch
 * 批量添加模型到心愿单（用于数据迁移，使用事务）
 */
router.post('/batch', async (req: Request, res: Response) => {
  const { modelIds } = req.body;

  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    res.status(400).json({ error: '参数错误：modelIds 必须为非空数组' });
    return;
  }

  // 校验每个 modelId 均为字符串
  if (modelIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: '参数错误：modelIds 中的每项必须为字符串' });
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const values = modelIds.map((id) => [req.openid, id]);
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT IGNORE INTO wishlists (openid, model_id) VALUES ?',
      [values]
    );

    await connection.commit();

    res.json({ success: true, added: result.affectedRows });
  } catch (err) {
    await connection.rollback();
    console.error('[POST /api/wishlist/batch]', err);
    res.status(500).json({ error: '批量添加心愿单失败' });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/wishlist/:modelId
 * 从心愿单中移除指定模型
 */
router.delete('/:modelId', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    await pool.query<ResultSetHeader>(
      'DELETE FROM wishlists WHERE openid = ? AND model_id = ?',
      [req.openid, modelId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/wishlist/:modelId]', err);
    res.status(500).json({ error: '移除心愿单失败' });
  }
});

export default router;
