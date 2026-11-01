const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyPublicBoundary } = require('../scripts/verify-cloud-auth.cjs');

test('公网验收发送三类随机身份只读请求，全部拒绝才通过这一项', async () => {
  const calls = [];
  const report = await verifyPublicBoundary(async (url, options) => {
    calls.push({ url, ...options });
    return { status: calls.length === 1 ? 403 : 401 };
  });
  assert.equal(report.publicRequestsRefused, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url.endsWith('/api/wishlist')));
  assert.match(calls[1].headers['X-WX-OPENID'], /^release-audit-/);
  assert.equal(calls[2].headers['X-WX-OPENID'], calls[1].headers['X-WX-OPENID']);
  assert.equal(calls[2].headers['X-WX-SOURCE'], 'wx_client');
  assert.match(report.scope, /必须单独验证/);
});

test('伪造身份被接受、服务不可用或网络失败都不能误报通过', async () => {
  for (const failure of [200, 404, 500, 'network']) {
    let count = 0;
    const report = await verifyPublicBoundary(async () => {
      if (++count !== 2) return { status: 401 };
      if (failure === 'network') throw new Error('network unavailable');
      return { status: failure };
    });
    assert.equal(report.publicRequestsRefused, false);
    assert.equal(report.probes[1].refused, false);
  }
});
