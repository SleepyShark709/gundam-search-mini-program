import { Router, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import pool from '../db';

const router = Router();

// snake_case → camelCase
function toCamelCase(row: RowDataPacket): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = row[key];
  }
  return result;
}

// GET /api/data/dashboard
router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    // 总数统计
    const [stats] = await pool.query<RowDataPacket[]>(`
      SELECT
        (SELECT COUNT(*) FROM models) AS total_models,
        (SELECT COUNT(DISTINCT model_id) FROM model_images) AS models_with_images,
        (SELECT COUNT(*) FROM model_images) AS total_images,
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM wishlists) AS total_wishlists,
        (SELECT COUNT(*) FROM purchases) AS total_purchases
    `);

    // 系列元信息
    const [seriesMeta] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM series_meta ORDER BY code'
    );

    // 按系列分组统计
    const [seriesCounts] = await pool.query<RowDataPacket[]>(
      'SELECT series, COUNT(*) AS count FROM models GROUP BY series'
    );

    // 数据版本
    const [versionRow] = await pool.query<RowDataPacket[]>(
      'SELECT MAX(updated_at) AS latest FROM models'
    );
    const dataVersion = versionRow[0]?.latest
      ? new Date(versionRow[0].latest).toISOString().slice(0, 10)
      : 'N/A';

    res.json({
      stats: stats[0],
      seriesMeta: seriesMeta.map(toCamelCase),
      seriesCounts: Object.fromEntries(seriesCounts.map(r => [r.series, r.count])),
      dataVersion,
    });
  } catch (err: any) {
    console.error('[dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/models?series=hg&page=1&pageSize=50&search=&limited=
router.get('/models', async (req: Request, res: Response) => {
  try {
    const series = req.query.series as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const search = req.query.search as string | undefined;
    const limited = req.query.limited as string | undefined;
    const offset = (page - 1) * pageSize;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (series) {
      whereClause += ' AND m.series = ?';
      params.push(series);
    }

    if (search) {
      whereClause += ' AND (m.name LIKE ? OR m.name_ja LIKE ? OR m.id LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (limited === '1') {
      whereClause += ' AND m.is_limited = 1';
    } else if (limited === '0') {
      whereClause += ' AND m.is_limited = 0';
    }

    // 总数
    const [countResult] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM models m ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // 分页数据
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.*, COUNT(mi.id) AS image_count
       FROM models m
       LEFT JOIN model_images mi ON mi.model_id = m.id
       ${whereClause}
       GROUP BY m.id
       ORDER BY m.series, m.is_limited, m.number
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      data: rows.map(toCamelCase),
      total,
      page,
      pageSize,
    });
  } catch (err: any) {
    console.error('[models]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/models/:id
router.get('/models/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [models] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM models WHERE id = ?',
      [id]
    );
    if (models.length === 0) {
      res.status(404).json({ error: '模型不存在' });
      return;
    }

    const [images] = await pool.query<RowDataPacket[]>(
      'SELECT image_url, sort_order FROM model_images WHERE model_id = ? ORDER BY sort_order',
      [id]
    );

    const [wishlistCount] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM wishlists WHERE model_id = ?',
      [id]
    );

    const [purchaseCount] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM purchases WHERE model_id = ?',
      [id]
    );

    res.json({
      model: toCamelCase(models[0]),
      images: images.map(r => r.image_url),
      wishlistCount: wishlistCount[0].cnt,
      purchaseCount: purchaseCount[0].cnt,
    });
  } catch (err: any) {
    console.error('[model detail]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
