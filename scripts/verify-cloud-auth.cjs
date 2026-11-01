const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const baseUrl = 'https://express-v0yz-233588-9-1411463139.sh.run.tcloudbase.com';
const appid = 'wx422623fec834054c';

/** 只读探测随机不存在的身份，不读取或创建真实用户数据。 */
async function verifyPublicBoundary(request = fetch) {
  const openid = `release-audit-${randomUUID()}`;
  const cases = [
    { name: 'without-identity', headers: {} },
    { name: 'forged-openid', headers: { 'X-WX-OPENID': openid } },
    { name: 'forged-wechat-headers', headers: { 'X-WX-OPENID': openid, 'X-WX-APPID': appid, 'X-WX-SOURCE': 'wx_client' } },
  ];
  const probes = [];
  for (const item of cases) {
    try {
      const response = await request(`${baseUrl}/api/wishlist`, {
        headers: item.headers, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      probes.push({ name: item.name, httpStatus: response.status, refused: [401, 403].includes(response.status) });
      // 不保存响应中的任何账号数据。
      await response.body?.cancel();
    } catch (error) {
      probes.push({ name: item.name, refused: false, error: error.message });
    }
  }
  return {
    checkedAt: new Date().toISOString(), baseUrl, probes,
    publicRequestsRefused: probes.every((probe) => probe.refused),
    scope: '仅检查公网伪造请求被拒绝；还必须单独验证真实微信 callContainer 成功。',
  };
}

if (require.main === module) {
  (async () => {
    const report = await verifyPublicBoundary();
    report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gundam-cloud-auth-evidence-'));
    const output = path.join(folder, 'result.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, evidence: output }, null, 2));
    process.exitCode = report.publicRequestsRefused ? 0 : 1;
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyPublicBoundary };
