import http from 'http';

/**
 * 微信内容安全检测 v2 (security.msgSecCheck)
 *
 * 在微信云托管运行环境内调用 http://api.weixin.qq.com/...
 * （HTTP 而非 HTTPS）由网关自动注入 access_token，无需自行管理。
 * 需要在云托管控制台 → 服务设置 → 微信令牌中开启 wxa/msg_sec_check 调用权限。
 *
 * 本地开发环境（无微信网关）跳过审核，直接 pass。
 */

interface MsgSecCheckResult {
  pass: boolean;
  reason?: string;
}

// 默认在生产环境开启，本地开发可设置 SKIP_MSG_SEC_CHECK=true 跳过。
// 微信云托管必须能调通 http://api.weixin.qq.com/wxa/msg_sec_check（控制台开启免鉴权）。
const SHOULD_CHECK = process.env.SKIP_MSG_SEC_CHECK !== 'true';

function postJson(host: string, path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host,
        port: 80,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks));
          } catch (e) {
            reject(new Error('Invalid JSON response: ' + chunks));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('msg_sec_check timeout'));
    });
    req.write(data);
    req.end();
  });
}

export async function msgSecCheck(content: string, openid: string): Promise<MsgSecCheckResult> {
  if (!SHOULD_CHECK) {
    return { pass: true };
  }

  try {
    const result = await postJson('api.weixin.qq.com', '/wxa/msg_sec_check?access_token=', {
      version: 2,
      scene: 1,
      openid,
      content,
    });

    if (result.errcode === 0) {
      const suggest = result.result?.suggest;
      if (suggest === 'risky') {
        return { pass: false, reason: '内容包含违规信息' };
      }
      return { pass: true };
    }

    console.error('[msgSecCheck] API error', result);
    return { pass: false, reason: result.errmsg || '内容审核失败' };
  } catch (e: any) {
    console.error('[msgSecCheck] request failed', e);
    return { pass: false, reason: '内容审核服务不可用' };
  }
}
