import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { isAdmin } from '../utils/admin';

const router = Router();

/**
 * GET /api/user/profile
 * 获取当前用户的个人信息（openid、昵称、头像、是否管理员）
 */
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT nickname, avatar_url FROM users WHERE openid = ?',
      [req.openid]
    );

    const row = rows[0];
    res.json({
      openid: req.openid,
      nickname: row?.nickname || null,
      avatarUrl: row?.avatar_url || null,
      isAdmin: isAdmin(req.openid),
    });
  } catch (err) {
    console.error('[GET /api/user/profile]', err);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

/**
 * POST /api/user/profile
 * 更新当前用户的个人信息（昵称、头像 fileID）
 */
router.post('/profile', async (req: Request, res: Response) => {
  const { nickname, avatarFileId } = req.body;

  if (!nickname && !avatarFileId) {
    res.status(400).json({ error: '参数错误：至少需要提供 nickname 或 avatarFileId' });
    return;
  }

  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO users (openid, nickname, avatar_url)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nickname = COALESCE(VALUES(nickname), nickname),
         avatar_url = COALESCE(VALUES(avatar_url), avatar_url)`,
      [req.openid, nickname || null, avatarFileId || null]
    );

    // 返回更新后的完整信息
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT nickname, avatar_url FROM users WHERE openid = ?',
      [req.openid]
    );

    const row = rows[0];
    res.json({
      openid: req.openid,
      nickname: row.nickname || null,
      avatarUrl: row.avatar_url || null,
      isAdmin: isAdmin(req.openid),
    });
  } catch (err) {
    console.error('[POST /api/user/profile]', err);
    res.status(500).json({ error: '更新用户信息失败' });
  }
});

export default router;
