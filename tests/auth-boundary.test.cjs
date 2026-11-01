const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const appid = 'wx422623fec834054c';
const cloudHeaders = { 'x-wx-source': 'wx_devtools', 'x-wx-appid': appid, 'x-wx-openid': 'cloud-user' };

function auth(env = {}) {
  return loadModule('server/src/middleware/auth.ts', {
    mocks: { 'dotenv/config': {} }, globals: { process: { env } },
  }).exports.authMiddleware;
}

function invoke(middleware, { headers = cloudHeaders, remoteAddress = '203.0.113.10', rawHeaders = [], body = {} } = {}) {
  const request = { headers, rawHeaders, body, socket: { remoteAddress } };
  let continued = false;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  middleware(request, response, () => { continued = true; });
  return { request, response, continued };
}

test('完整云端来源和匹配appid才使用请求头身份，不读取body身份', () => {
  for (const source of ['wx_devtools', 'other-source-format']) {
    const result = invoke(auth(), { headers: { ...cloudHeaders, 'x-wx-source': source }, body: { openid: 'spoof-user' } });
    assert.equal(result.continued, true);
    assert.equal(result.request.openid, 'cloud-user');
  }
  const custom = invoke(auth({ WX_APPID: 'configured-appid' }), { headers: { ...cloudHeaders, 'x-wx-appid': 'configured-appid' } });
  assert.equal(custom.continued, true);
});

test('缺失、空白、错appid或数组来源头均返回401', () => {
  const invalid = [{}, { 'x-wx-openid': 'cloud-user' }, { ...cloudHeaders, 'x-wx-appid': 'wrong-appid' }];
  for (const name of Object.keys(cloudHeaders)) {
    for (const value of [undefined, '', ' ', [cloudHeaders[name]], [cloudHeaders[name], cloudHeaders[name]]]) {
      invalid.push({ ...cloudHeaders, [name]: value });
    }
  }
  for (const headers of invalid) {
    const result = invoke(auth(), { headers, body: { openid: 'body-user' } });
    assert.equal(result.response.statusCode, 401);
    assert.equal(result.continued, false);
    assert.equal(result.request.openid, undefined);
  }
});

test('重复来源头通过原始rawHeaders识别并拒绝', () => {
  for (const name of Object.keys(cloudHeaders)) {
    const result = invoke(auth(), { rawHeaders: [name, cloudHeaders[name], name.toUpperCase(), cloudHeaders[name]] });
    assert.equal(result.response.statusCode, 401);
    assert.equal(result.continued, false);
  }
});

test('仅显式development本机mock允许openid，使用实际socket地址', () => {
  const headers = { 'x-wx-openid': 'local-dev-user' };
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(invoke(auth({ NODE_ENV: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' }), { headers, remoteAddress }).continued, true);
    assert.equal(invoke(auth({ NODE_ENV: 'development' }), { headers, remoteAddress }).response.statusCode, 401);
  }
  for (const remoteAddress of ['203.0.113.10', '192.168.1.8', null]) {
    const result = invoke(auth({ NODE_ENV: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' }), {
      headers: { ...headers, 'x-forwarded-for': '127.0.0.1' }, remoteAddress,
    });
    assert.equal(result.response.statusCode, 401);
  }
  assert.equal(invoke(auth({ NODE_ENV: 'development', ALLOW_LOCAL_MOCK_AUTH: 'true' }), {
    headers: { 'x-wx-openid': ['local-dev-user'] }, remoteAddress: '127.0.0.1',
  }).response.statusCode, 401);
});

test('production、test或未设置NODE_ENV时误开mock会在启动时失败', () => {
  for (const NODE_ENV of ['production', 'test', undefined]) {
    assert.throws(() => auth({ NODE_ENV, ALLOW_LOCAL_MOCK_AUTH: 'true' }), /ALLOW_LOCAL_MOCK_AUTH=true.*NODE_ENV=development/);
  }
  assert.doesNotThrow(() => auth({ NODE_ENV: 'production', ALLOW_LOCAL_MOCK_AUTH: 'false' }));
});
