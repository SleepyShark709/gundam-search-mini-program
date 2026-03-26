import express from 'express';
import path from 'path';
import pool from './db';
import dataRouter from './routes/data';
import tasksRouter from './routes/tasks';

const app = express();
const PORT = 3000;

app.use(express.json());

// 静态文件：管理后台前端
app.use(express.static(path.join(__dirname, '../public')));

// 图片代理：访问 server/public/images/ 下的详情图
const IMAGE_DIR = path.join(__dirname, '../../server/public/images');
app.use('/local-images', express.static(IMAGE_DIR));

// API 路由
app.use('/api/data', dataRouter);
app.use('/api/tasks', tasksRouter);

// 启动
app.listen(PORT, async () => {
  // 验证数据库连接
  try {
    await pool.query('SELECT 1');
    console.log(`[admin] 数据库连接成功`);
  } catch (err) {
    console.error('[admin] 数据库连接失败:', err);
  }
  console.log(`[admin] 管理后台已启动: http://localhost:${PORT}`);
});
