import { Router, Request, Response } from 'express';
import { createTask, getTask, listTasks, isRunning } from '../utils/task-runner';

const router = Router();

// POST /api/tasks — 创建任务
router.post('/', (req: Request, res: Response) => {
  const { type, options = {} } = req.body;

  if (!type) {
    res.status(400).json({ error: '缺少 type 参数' });
    return;
  }

  if (isRunning()) {
    res.status(409).json({ error: '已有任务在运行中，请等待完成后再试' });
    return;
  }

  const task = createTask(type, options);
  if (!task) {
    res.status(400).json({ error: `不支持的任务类型: ${type}` });
    return;
  }

  res.json({ taskId: task.id, type: task.type, status: task.status });
});

// GET /api/tasks — 任务列表
router.get('/', (_req: Request, res: Response) => {
  res.json({ tasks: listTasks() });
});

// GET /api/tasks/:id/stream — SSE 日志流
router.get('/:id/stream', (req: Request, res: Response) => {
  const task = getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // 回放历史日志
  for (const line of task.logs) {
    res.write(`event: log\ndata: ${JSON.stringify({ line, ts: '' })}\n\n`);
  }

  // 如果任务已结束，发送状态并关闭
  if (task.status !== 'running') {
    res.write(`event: status\ndata: ${JSON.stringify({ status: task.status, exitCode: task.exitCode })}\n\n`);
    res.end();
    return;
  }

  // 注册为实时订阅者
  task.sseClients.add(res);
  req.on('close', () => {
    task.sseClients.delete(res);
  });
});

export default router;
