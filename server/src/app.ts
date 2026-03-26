import express from 'express';
import path from 'path';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import modelsRouter from './routes/models';
import wishlistRouter from './routes/wishlist';
import purchasesRouter from './routes/purchases';

const app = express();
const PORT = 80;

// ---- 基础中间件 ----
app.use(express.json());

// ---- 静态文件：产品图片 ----
const IMAGE_DIR = process.env.IMAGE_STORAGE_PATH || path.join(__dirname, '../public/images');
app.use('/images', express.static(IMAGE_DIR, { maxAge: '7d', immutable: true }));

// ---- 健康检查（不需要认证） ----
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'gundam-menu-server' });
});

// ---- 公开 API 路由（不需要认证） ----
app.use('/api', modelsRouter);

// ---- 需要认证的 API 路由 ----
app.use('/api', authMiddleware);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/purchases', purchasesRouter);

// ---- 全局错误处理 ----
app.use(errorHandler);

// ---- 启动服务 ----
app.listen(PORT, () => {
  console.log(`[gundam-menu-server] 服务已启动，监听端口 ${PORT}`);
});

export default app;
