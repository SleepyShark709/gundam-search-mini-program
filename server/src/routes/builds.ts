import { Router, Request, Response } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../db/pool';
import { MODEL_ID_PATTERN } from '../utils/share-payload';

const router = Router();

function validDate(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.model_id, COALESCE(b.quantity, 1) AS quantity,
              COALESCE(b.completed_count, 0) AS completed_count,
              COALESCE(b.building_count, 0) AS building_count,
              COALESCE(b.goal, '') AS goal,
              DATE_FORMAT(b.goal_done_date, '%Y-%m-%d') AS goal_done_date
       FROM purchases p LEFT JOIN build_progress b ON b.purchase_id = p.id
       WHERE p.openid = ? ORDER BY p.created_at DESC`,
      [req.openid]
    );
    res.json({ builds: rows.map((row) => ({
      modelId: row.model_id,
      quantity: row.quantity,
      completedCount: row.completed_count,
      buildingCount: row.building_count,
      goal: row.goal,
      goalDoneDate: row.goal_done_date,
    })) });
  } catch (err) {
    console.error('[GET /api/builds]', err);
    res.status(500).json({ error: '获取堆积进度失败' });
  }
});

router.put('/:modelId', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { quantity, completedCount, buildingCount, goal, goalDoneDate } = req.body || {};
  const counts = [quantity, completedCount, buildingCount];
  if (!MODEL_ID_PATTERN.test(modelId) || counts.some((value) => !Number.isInteger(value) || value < 0)
    || quantity < 1 || quantity > 999 || completedCount + buildingCount > quantity
    || typeof goal !== 'string' || goal.length > 100 || !validDate(goalDoneDate)) {
    res.status(400).json({ error: '进度参数无效：数量为 1-999，完成与进行数量不能超过总数，目标最多 100 字，日期不能晚于今天' });
    return;
  }
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO build_progress (purchase_id, quantity, completed_count, building_count, goal, goal_done_date)
       SELECT id, ?, ?, ?, ?, ? FROM purchases WHERE openid = ? AND model_id = ?
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), completed_count = VALUES(completed_count),
         building_count = VALUES(building_count), goal = VALUES(goal), goal_done_date = VALUES(goal_done_date)`,
      [quantity, completedCount, buildingCount, goal, goalDoneDate, req.openid, modelId]
    );
    if (result.affectedRows === 0) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM purchases WHERE openid = ? AND model_id = ?', [req.openid, modelId]);
      if (!rows.length) {
        res.status(404).json({ error: '未找到该购买记录，请先添加已购买模型' });
        return;
      }
    }
    res.json({ modelId, quantity, completedCount, buildingCount, goal, goalDoneDate });
  } catch (err) {
    console.error('[PUT /api/builds/:modelId]', err);
    res.status(500).json({ error: '保存堆积进度失败' });
  }
});

export default router;
