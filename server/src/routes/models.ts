import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { RowDataPacket } from 'mysql2';
import { toCamelCase } from '../utils/case-convert';
import { getDataVersion } from '../utils/data-version';

const router = Router();

const VALID_SERIES = ['hg', 'rg', 'mg', 'pg'];

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com';

/** 将 /images/xxx 相对路径转为完整 URL */
function resolveImageUrl(url: string | null): string | null {
  if (!url) return url;
  if (url.startsWith('/images/')) return PUBLIC_BASE_URL + url;
  return url;
}

/**
 * GET /api/series-meta
 * 获取所有系列元信息（公开接口，无需认证）
 */
router.get('/series-meta', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT code, name, short_name, scale, cover_image, total_count FROM series_meta ORDER BY FIELD(code, 'hg', 'rg', 'mg', 'pg')"
    );

    const version = await getDataVersion();
    const data = rows.map(toCamelCase).map(r => ({
      ...r,
      coverImage: resolveImageUrl(r.coverImage),
    }));
    res.json({ data, version });
  } catch (err) {
    console.error('[GET /api/series-meta]', err);
    res.status(500).json({ error: '获取系列元信息失败' });
  }
});

/**
 * GET /api/models/:seriesCode
 * 获取指定系列的模型列表（公开接口，无需认证）
 */
router.get('/models/:seriesCode', async (req: Request, res: Response) => {
  const { seriesCode } = req.params;

  if (!VALID_SERIES.includes(seriesCode)) {
    res.status(400).json({ error: '无效的系列代码，可选值：hg, rg, mg, pg' });
    return;
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM models WHERE series = ? ORDER BY number ASC',
      [seriesCode]
    );

    const version = await getDataVersion();
    const data = rows.map(toCamelCase).map(r => ({
      ...r,
      imageUrl: resolveImageUrl(r.imageUrl),
    }));
    res.json({ data, version });
  } catch (err) {
    console.error(`[GET /api/models/${seriesCode}]`, err);
    res.status(500).json({ error: '获取模型列表失败' });
  }
});

/**
 * GET /api/models/:seriesCode/:modelId/images
 * 获取指定模型的多图列表（公开接口，无需认证）
 */
router.get('/models/:seriesCode/:modelId/images', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT image_url FROM model_images WHERE model_id = ? ORDER BY sort_order ASC',
      [modelId]
    );

    const images = rows.map((r) => resolveImageUrl(r.image_url as string)).filter(Boolean) as string[];
    res.json({ images });
  } catch (err) {
    console.error(`[GET /api/models/:seriesCode/${modelId}/images]`, err);
    res.status(500).json({ error: '获取模型图片失败' });
  }
});

export default router;
