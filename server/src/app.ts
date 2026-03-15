import express from 'express';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import wishlistRouter from './routes/wishlist';
import purchasesRouter from './routes/purchases';

const app = express();
const PORT = 80;

// ---- 基础中间件 ----
app.use(express.json());

// ---- 健康检查（不需要认证） ----
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'gundam-menu-server' });
});

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
