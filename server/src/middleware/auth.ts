import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';

const expectedAppid = process.env.WX_APPID || 'wx422623fec834054c';
const allowLocalMockAuth = process.env.ALLOW_LOCAL_MOCK_AUTH === 'true';
if (allowLocalMockAuth && process.env.NODE_ENV !== 'development') {
  throw new Error('ALLOW_LOCAL_MOCK_AUTH=true 仅允许在 NODE_ENV=development 下启用');
}

declare global {
  namespace Express {
    interface Request {
      openid: string;
    }
  }
}

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const occurrences = (req.rawHeaders || []).filter((header, index) => index % 2 === 0 && header.toLowerCase() === name).length;
  return occurrences > 1 ? undefined : value;
}

/** 云端来源头只是纵深防护；公网伪造头必须由部署网关拒绝。 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const openid = singleHeader(req, 'x-wx-openid');
  const cloudSource = singleHeader(req, 'x-wx-source');
  const appid = singleHeader(req, 'x-wx-appid');
  const fromCloud = Boolean(cloudSource) && appid === expectedAppid;
  const fromLocalMock = allowLocalMockAuth
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');

  if (!openid || (!fromCloud && !fromLocalMock)) {
    res.status(401).json({ error: '未授权：缺少可信微信来源或用户身份标识' });
    return;
  }

  req.openid = openid;
  next();
}
