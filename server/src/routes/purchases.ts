import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

const router = Router();

interface PurchaseRow extends RowDataPacket {
  model_id: string;
  price_cny: string | null;
  purchase_date: string | null;
  channel: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 将数据库行格式化为 API 响应格式（snake_case -> camelCase）
 */
function formatPurchase(row: PurchaseRow) {
  return {
    modelId: row.model_id,
    priceCny: row.price_cny !== null ? parseFloat(row.price_cny) : null,
    purchaseDate: row.purchase_date,
    channel: row.channel,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/purchases
 * 获取当前用户的已购买列表
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<PurchaseRow[]>(
      `SELECT model_id, price_cny, purchase_date, channel, note, created_at, updated_at
       FROM purchases
       WHERE openid = ?
       ORDER BY created_at DESC`,
      [req.openid]
    );

    const purchases = rows.map(formatPurchase);
    res.json({ purchases });
  } catch (err) {
    console.error('[GET /api/purchases]', err);
    res.status(500).json({ error: '获取购买记录失败' });
  }
});

/**
 * POST /api/purchases
 * 添加一条购买记录。如果同一用户对同一模型已存在记录则返回 409 冲突。
 */
router.post('/', async (req: Request, res: Response) => {
  const { modelId, priceCny, purchaseDate, channel, note } = req.body;

  if (!modelId || typeof modelId !== 'string') {
    res.status(400).json({ error: '参数错误：modelId 为必填字段' });
    return;
  }

  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO purchases (openid, model_id, price_cny, purchase_date, channel, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.openid,
        modelId,
        priceCny ?? null,
        purchaseDate ?? null,
        channel ?? null,
        note ?? null,
      ]
    );

    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: '该模型已存在购买记录，如需修改请使用更新接口' });
      return;
    }
    console.error('[POST /api/purchases]', err);
    res.status(500).json({ error: '添加购买记录失败' });
  }
});

/**
 * PUT /api/purchases/:modelId
 * 更新指定模型的购买信息
 */
router.put('/:modelId', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { priceCny, purchaseDate, channel, note } = req.body;

  // 构建动态更新字段，只更新请求体中明确传入的字段
  const updates: string[] = [];
  const values: any[] = [];

  if (priceCny !== undefined) {
    updates.push('price_cny = ?');
    values.push(priceCny);
  }
  if (purchaseDate !== undefined) {
    updates.push('purchase_date = ?');
    values.push(purchaseDate);
  }
  if (channel !== undefined) {
    updates.push('channel = ?');
    values.push(channel);
  }
  if (note !== undefined) {
    updates.push('note = ?');
    values.push(note);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: '参数错误：至少需要提供一个更新字段' });
    return;
  }

  values.push(req.openid, modelId);

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE purchases SET ${updates.join(', ')} WHERE openid = ? AND model_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ error: '未找到该购买记录' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[PUT /api/purchases/:modelId]', err);
    res.status(500).json({ error: '更新购买记录失败' });
  }
});

/**
 * DELETE /api/purchases/:modelId
 * 删除指定模型的购买记录
 */
router.delete('/:modelId', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM purchases WHERE openid = ? AND model_id = ?',
      [req.openid, modelId]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ error: '未找到该购买记录' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/purchases/:modelId]', err);
    res.status(500).json({ error: '删除购买记录失败' });
  }
});

export default router;
