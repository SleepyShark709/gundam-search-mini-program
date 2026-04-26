import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { isAdmin } from '../utils/admin';
import { msgSecCheck } from '../utils/msg-sec-check';

const router = Router();

const TITLE_MAX = 120;
const CONTENT_MAX = 5000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface PostRow extends RowDataPacket {
  id: string;
  openid: string;
  title: string;
  content: string;
  reply_count: number;
  last_reply_at: string | null;
  created_at: string;
  updated_at: string;
  author_nickname: string | null;
  author_avatar_url: string | null;
}

interface ReplyRow extends RowDataPacket {
  id: string;
  post_id: string;
  openid: string;
  content: string;
  created_at: string;
  author_nickname: string | null;
  author_avatar_url: string | null;
}

function formatPost(row: PostRow) {
  return {
    id: String(row.id),
    authorOpenid: row.openid,
    authorNickname: row.author_nickname || null,
    authorAvatarUrl: row.author_avatar_url || null,
    title: row.title,
    content: row.content,
    replyCount: row.reply_count,
    lastReplyAt: row.last_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatReply(row: ReplyRow) {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    authorOpenid: row.openid,
    authorNickname: row.author_nickname || null,
    authorAvatarUrl: row.author_avatar_url || null,
    content: row.content,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/forum/posts?limit=20&before=<id>
 * 帖子列表（游标分页，按 id 倒序）
 */
router.get('/posts', async (req: Request, res: Response) => {
  const limitRaw = parseInt(req.query.limit as string, 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw, 1), MAX_LIMIT);
  const before = req.query.before as string | undefined;

  try {
    const params: any[] = [];
    let whereSql = '';
    if (before) {
      whereSql = 'WHERE p.id < ?';
      params.push(before);
    }
    params.push(limit + 1);

    const [rows] = await pool.query<PostRow[]>(
      `SELECT p.id, p.openid, p.title, p.content, p.reply_count, p.last_reply_at,
              p.created_at, p.updated_at,
              u.nickname AS author_nickname, u.avatar_url AS author_avatar_url
       FROM forum_posts p
       LEFT JOIN users u ON u.openid = p.openid
       ${whereSql}
       ORDER BY p.id DESC
       LIMIT ?`,
      params
    );

    const hasMore = rows.length > limit;
    const posts = rows.slice(0, limit).map(formatPost);
    res.json({ posts, hasMore });
  } catch (err) {
    console.error('[GET /api/forum/posts]', err);
    res.status(500).json({ error: '获取帖子列表失败' });
  }
});

/**
 * GET /api/forum/posts/:id
 * 帖子详情（含回复列表）
 */
router.get('/posts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [postRows] = await pool.query<PostRow[]>(
      `SELECT p.id, p.openid, p.title, p.content, p.reply_count, p.last_reply_at,
              p.created_at, p.updated_at,
              u.nickname AS author_nickname, u.avatar_url AS author_avatar_url
       FROM forum_posts p
       LEFT JOIN users u ON u.openid = p.openid
       WHERE p.id = ?`,
      [id]
    );

    if (postRows.length === 0) {
      res.status(404).json({ error: '帖子不存在' });
      return;
    }

    const [replyRows] = await pool.query<ReplyRow[]>(
      `SELECT r.id, r.post_id, r.openid, r.content, r.created_at,
              u.nickname AS author_nickname, u.avatar_url AS author_avatar_url
       FROM forum_replies r
       LEFT JOIN users u ON u.openid = r.openid
       WHERE r.post_id = ?
       ORDER BY r.created_at ASC, r.id ASC`,
      [id]
    );

    res.json({
      post: formatPost(postRows[0]),
      replies: replyRows.map(formatReply),
    });
  } catch (err) {
    console.error('[GET /api/forum/posts/:id]', err);
    res.status(500).json({ error: '获取帖子详情失败' });
  }
});

/**
 * POST /api/forum/posts
 * 发帖
 */
router.post('/posts', async (req: Request, res: Response) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (title.length === 0 || title.length > TITLE_MAX) {
    res.status(400).json({ error: `标题长度必须在 1-${TITLE_MAX} 字符之间` });
    return;
  }
  if (content.length === 0 || content.length > CONTENT_MAX) {
    res.status(400).json({ error: `正文长度必须在 1-${CONTENT_MAX} 字符之间` });
    return;
  }

  const check = await msgSecCheck(`${title}\n${content}`, req.openid);
  if (!check.pass) {
    res.status(400).json({ error: check.reason || '内容包含违规信息' });
    return;
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO forum_posts (openid, title, content) VALUES (?, ?, ?)',
      [req.openid, title, content]
    );
    res.json({ success: true, id: String(result.insertId) });
  } catch (err) {
    console.error('[POST /api/forum/posts]', err);
    res.status(500).json({ error: '发帖失败' });
  }
});

/**
 * DELETE /api/forum/posts/:id
 * 删帖：作者本人或管理员可删，事务级联删除回复
 */
router.delete('/posts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT openid FROM forum_posts WHERE id = ?',
      [id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: '帖子不存在' });
      return;
    }
    if (rows[0].openid !== req.openid && !isAdmin(req.openid)) {
      res.status(403).json({ error: '无权删除该帖子' });
      return;
    }

    await connection.beginTransaction();
    await connection.query<ResultSetHeader>('DELETE FROM forum_replies WHERE post_id = ?', [id]);
    await connection.query<ResultSetHeader>('DELETE FROM forum_posts WHERE id = ?', [id]);
    await connection.commit();

    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('[DELETE /api/forum/posts/:id]', err);
    res.status(500).json({ error: '删除帖子失败' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/forum/posts/:id/replies
 * 回帖：事务里 INSERT reply + UPDATE post.reply_count
 */
router.post('/posts/:id/replies', async (req: Request, res: Response) => {
  const { id } = req.params;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (content.length === 0 || content.length > CONTENT_MAX) {
    res.status(400).json({ error: `内容长度必须在 1-${CONTENT_MAX} 字符之间` });
    return;
  }

  const check = await msgSecCheck(content, req.openid);
  if (!check.pass) {
    res.status(400).json({ error: check.reason || '内容包含违规信息' });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [postRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM forum_posts WHERE id = ? FOR UPDATE',
      [id]
    );
    if (postRows.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: '帖子不存在' });
      return;
    }

    const [insertResult] = await connection.query<ResultSetHeader>(
      'INSERT INTO forum_replies (post_id, openid, content) VALUES (?, ?, ?)',
      [id, req.openid, content]
    );

    await connection.query<ResultSetHeader>(
      'UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = ?',
      [id]
    );

    await connection.commit();
    res.json({ success: true, id: String(insertResult.insertId) });
  } catch (err) {
    await connection.rollback();
    console.error('[POST /api/forum/posts/:id/replies]', err);
    res.status(500).json({ error: '回复失败' });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/forum/replies/:id
 * 删回复：作者本人或管理员可删，事务里 DELETE + 减 post.reply_count
 */
router.delete('/replies/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT openid, post_id FROM forum_replies WHERE id = ?',
      [id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: '回复不存在' });
      return;
    }
    if (rows[0].openid !== req.openid && !isAdmin(req.openid)) {
      res.status(403).json({ error: '无权删除该回复' });
      return;
    }
    const postId = rows[0].post_id;

    await connection.beginTransaction();
    await connection.query<ResultSetHeader>('DELETE FROM forum_replies WHERE id = ?', [id]);
    await connection.query<ResultSetHeader>(
      'UPDATE forum_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ?',
      [postId]
    );
    await connection.commit();

    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('[DELETE /api/forum/replies/:id]', err);
    res.status(500).json({ error: '删除回复失败' });
  } finally {
    connection.release();
  }
});

export default router;
