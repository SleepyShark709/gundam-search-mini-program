import { randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../db/pool';
import { msgSecCheck } from '../utils/msg-sec-check';
import { parseShareInput, publicModel } from '../utils/share-payload';

const router = Router();
export const publicSharesRouter = Router();
const SHARE_ID_PATTERN = /^[a-f0-9]{32}$/;

function readJson(value: any): any {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

router.post('/', async (req: Request, res: Response) => {
  const input = parseShareInput(req.body);
  if (!input) {
    res.status(400).json({ error: '分享参数无效，请检查标题、模型数量和玩法设置' });
    return;
  }
  try {
    const check = await msgSecCheck([input.title, ...(input.questions || []).map((q) => q.prompt)].join('\n'), req.openid);
    if (!check.pass) {
      res.status(400).json({ error: check.reason || '内容包含违规信息' });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, series, number, name, name_ja, name_en, price, price_tax_free,
              release_date, is_limited, limited_type, image_url, product_url, tags
       FROM models WHERE id IN (${input.modelIds.map(() => '?').join(', ')})`,
      input.modelIds
    );
    const modelsById = new Map(rows.map((row) => [row.id, publicModel(row)]));
    if (input.modelIds.some((id) => !modelsById.has(id))) {
      res.status(400).json({ error: '分享包含不存在的模型' });
      return;
    }
    const payload = {
      kind: input.kind,
      title: input.title,
      models: input.modelIds.map((id) => modelsById.get(id)),
      ...(input.captainId ? { captainId: input.captainId } : {}),
      ...(input.questions ? { questions: input.questions.map(({ prompt, optionIds }) => ({ prompt, optionIds })) } : {}),
      ...(input.report ? { report: input.report } : {}),
    };
    const id = randomBytes(16).toString('hex');
    await pool.query<ResultSetHeader>(
      'INSERT INTO share_snapshots (id, openid, payload, quiz_answers) VALUES (?, ?, ?, ?)',
      [id, req.openid, JSON.stringify(payload), input.questions ? JSON.stringify(input.questions.map((q) => q.answerId)) : null]
    );
    res.json({ id });
  } catch (err) {
    console.error('[POST /api/shares]', err);
    res.status(500).json({ error: '创建分享失败' });
  }
});

publicSharesRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!SHARE_ID_PATTERN.test(id)) {
    res.status(404).json({ error: '分享不存在' });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT payload FROM share_snapshots WHERE id = ?', [id]);
    if (!rows.length) {
      res.status(404).json({ error: '分享不存在' });
      return;
    }
    res.json({ ...readJson(rows[0].payload), id });
  } catch (err) {
    console.error('[GET /api/shares/:id]', err);
    res.status(500).json({ error: '获取分享失败' });
  }
});

publicSharesRouter.post('/:id/answers', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!SHARE_ID_PATTERN.test(id)) {
    res.status(404).json({ error: '分享不存在' });
    return;
  }
  const answers: unknown = req.body?.answers;
  if (!Array.isArray(answers) || answers.length !== 3 || answers.some((answer) => typeof answer !== 'string')) {
    res.status(400).json({ error: '请提交三道题的答案' });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT payload, quiz_answers FROM share_snapshots WHERE id = ?', [id]);
    if (!rows.length) {
      res.status(404).json({ error: '分享不存在' });
      return;
    }
    const payload = readJson(rows[0].payload);
    if (payload.kind !== 'quiz') {
      res.status(400).json({ error: '该分享不是猜模型挑战' });
      return;
    }
    if (answers.some((answer, index) => !payload.questions[index].optionIds.includes(answer))) {
      res.status(400).json({ error: '答案必须来自对应题目的选项' });
      return;
    }
    const correctAnswers: string[] = readJson(rows[0].quiz_answers);
    const score = correctAnswers.filter((answer, index) => answer === answers[index]).length;
    res.json({ score, total: correctAnswers.length, correctAnswers });
  } catch (err) {
    console.error('[POST /api/shares/:id/answers]', err);
    res.status(500).json({ error: '提交答案失败' });
  }
});

export default router;
