import { Request, Response, NextFunction } from 'express';

/**
 * 全局错误处理中间件。
 * 捕获未被路由处理的异常，统一返回 JSON 格式错误响应。
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[Error]', err.message, err.stack);

  const statusCode = (err as any).statusCode || 500;
  const message = statusCode === 500 ? '服务器内部错误' : err.message;

  res.status(statusCode).json({ error: message });
}
