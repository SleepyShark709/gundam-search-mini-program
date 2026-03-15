import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      openid: string;
    }
  }
}

/**
 * 从微信云托管自动注入的 X-WX-OPENID 请求头中提取 openid。
 * 如果请求头缺失则返回 401。
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const openid = req.headers['x-wx-openid'] as string | undefined;

  if (!openid) {
    res.status(401).json({ error: '未授权：缺少用户身份标识' });
    return;
  }

  req.openid = openid;
  next();
}
