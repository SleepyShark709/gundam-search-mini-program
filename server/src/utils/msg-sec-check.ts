import https from 'https';
import fs from 'fs';

/**
 * 微信内容安全检测 v2 (security.msgSecCheck) - 微信云托管版本
 *
 * 工作原理：
 *   1. 云托管会把 cloudbase_access_token 推送到容器内文件
 *      /.tencentcloudbase/wx/cloudbase_access_token（每 10 分钟刷新，30 分钟有效）
 *   2. 用 token 拼到 query 调用 https://api.weixin.qq.com/wxa/msg_sec_check
 *
 * 前置条件（一次性）：
 *   微信云托管控制台 → 云调用 → 微信令牌配置 → 添加接口路径 /wxa/msg_sec_check
 *
 * 本地开发（无 token 文件）：
 *   - 自动跳过审核（return pass: true）
 *   - 也可以显式设置 SKIP_MSG_SEC_CHECK=true 强制跳过
 *
 * scene 取值：1 资料 / 2 评论 / 3 论坛 / 4 社交日志。论坛取 3。
 */

interface MsgSecCheckResult {
  pass: boolean;
  reason?: string;
}

const TOKEN_FILE = '/.tencentcloudbase/wx/cloudbase_access_token';
const SKIP = process.env.SKIP_MSG_SEC_CHECK === 'true';
const SCENE_FORUM = 3;

function readToken(): string | null {
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    return token || null;
  } catch {
    return null;
  }
}

interface WxApiResponse {
  errcode: number;
  errmsg?: string;
  result?: { suggest?: 'pass' | 'review' | 'risky'; label?: number };
  detail?: Array<{ suggest?: string; label?: number; keyword?: string }>;
}

function postJson(url: string, body: unknown): Promise<WxApiResponse> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf-8');
    const u = new URL(url);
    const req = https.request(
      {
        host: u.host,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('Invalid JSON response: ' + raw));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('msg_sec_check timeout')));
    req.write(data);
    req.end();
  });
}

export async function msgSecCheck(content: string, openid: string): Promise<MsgSecCheckResult> {
  if (SKIP) return { pass: true };

  const token = readToken();
  if (!token) {
    // 非云托管环境（本地开发或令牌还没下发）：跳过审核
    return { pass: true };
  }

  try {
    const url = `https://api.weixin.qq.com/wxa/msg_sec_check?cloudbase_access_token=${encodeURIComponent(token)}`;
    const result = await postJson(url, {
      version: 2,
      scene: SCENE_FORUM,
      openid,
      content,
    });

    if (result.errcode === 0) {
      if (result.result?.suggest === 'risky') {
        return { pass: false, reason: '内容包含违规信息' };
      }
      // 'pass' 和 'review' 都放行，'review' 在小程序合规上可后续人工再审
      return { pass: true };
    }

    console.error('[msgSecCheck] API error', result);
    return { pass: false, reason: result.errmsg || '内容审核失败' };
  } catch (e) {
    console.error('[msgSecCheck] request failed', e);
    return { pass: false, reason: '内容审核服务不可用' };
  }
}
