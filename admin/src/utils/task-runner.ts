import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import path from 'path';

export interface Task {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  args: string[];
  startedAt: Date;
  finishedAt?: Date;
  exitCode?: number;
  logs: string[];
  sseClients: Set<Response>;
}

const SCRIPT_MAP: Record<string, string> = {
  'scrape-bandai': 'src/scripts/scrape-bandai.ts',
  'scrape-images': 'src/scripts/scrape-images.ts',
  'update-data': 'src/scripts/update-data.ts',
};

const VALID_SERIES = ['hg', 'rg', 'mg', 'pg'];

const MAX_HISTORY = 20;
const MAX_LOGS = 2000;

const tasks = new Map<string, Task>();
let runningTask: Task | null = null;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function broadcast(task: Task, event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of task.sseClients) {
    try { client.write(message); } catch { task.sseClients.delete(client); }
  }
}

function buildArgs(type: string, options: Record<string, any>): string[] {
  const args: string[] = [];

  if (options.series && VALID_SERIES.includes(options.series)) {
    args.push('--series', options.series);
  }

  if (type === 'scrape-bandai') {
    if (options.full) args.push('--full');
    if (options.force) args.push('--force');
    if (options.syncDb) args.push('--sync-db');
    if (options.dryRun) args.push('--dry-run');
  } else if (type === 'scrape-images') {
    if (options.limit && Number.isInteger(Number(options.limit)) && Number(options.limit) > 0) {
      args.push('--limit', String(options.limit));
    }
    if (options.skipExisting) args.push('--skip-existing');
    if (options.dryRun) args.push('--dry-run');
  } else if (type === 'update-data') {
    if (options.skipImages) args.push('--skip-images');
    if (options.skipData) args.push('--skip-data');
  }

  return args;
}

export function createTask(type: string, options: Record<string, any> = {}): Task | null {
  if (!SCRIPT_MAP[type]) return null;
  if (runningTask) return null;

  const scriptPath = SCRIPT_MAP[type];
  const args = buildArgs(type, options);
  const serverDir = path.resolve(__dirname, '../../../server');

  const task: Task = {
    id: generateId(),
    type,
    status: 'running',
    args,
    startedAt: new Date(),
    logs: [],
    sseClients: new Set(),
  };

  // 清理历史记录
  const allTasks = Array.from(tasks.values())
    .filter(t => t.status !== 'running')
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  while (allTasks.length >= MAX_HISTORY) {
    const old = allTasks.pop()!;
    tasks.delete(old.id);
  }

  tasks.set(task.id, task);
  runningTask = task;

  // 使用 npx ts-node 在 server/ 目录下执行脚本
  const child: ChildProcess = spawn('npx', ['ts-node', scriptPath, ...args], {
    cwd: serverDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  function addLog(line: string) {
    if (task.logs.length < MAX_LOGS) {
      task.logs.push(line);
    }
    broadcast(task, 'log', { line, ts: new Date().toISOString() });
  }

  let stdoutBuffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      addLog(line);
    }
  });

  let stderrBuffer = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      addLog(`[stderr] ${line}`);
    }
  });

  child.on('close', (code) => {
    // 刷新剩余 buffer
    if (stdoutBuffer) addLog(stdoutBuffer);
    if (stderrBuffer) addLog(`[stderr] ${stderrBuffer}`);

    task.status = code === 0 ? 'completed' : 'failed';
    task.exitCode = code ?? 1;
    task.finishedAt = new Date();
    runningTask = null;

    broadcast(task, 'status', {
      status: task.status,
      exitCode: task.exitCode,
    });

    // 关闭所有 SSE 连接
    for (const client of task.sseClients) {
      try { client.end(); } catch {}
    }
    task.sseClients.clear();
  });

  child.on('error', (err) => {
    addLog(`[error] 启动失败: ${err.message}`);
    task.status = 'failed';
    task.exitCode = 1;
    task.finishedAt = new Date();
    runningTask = null;
    broadcast(task, 'status', { status: 'failed', exitCode: 1 });
  });

  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Omit<Task, 'logs' | 'sseClients'>[] {
  return Array.from(tasks.values())
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map(({ logs, sseClients, ...rest }) => rest);
}

export function isRunning(): boolean {
  return runningTask !== null;
}
