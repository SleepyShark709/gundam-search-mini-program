const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const flags = {
  discovery: 'FEATURE_DISCOVERY', sharing: 'FEATURE_SHARING', squad: 'FEATURE_SQUAD', quiz: 'FEATURE_QUIZ',
  builds: 'FEATURE_BUILDS', lineage: 'FEATURE_LINEAGE', compare: 'FEATURE_COMPARE', pilotRating: 'FEATURE_PILOT_RATING',
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function config(env = {}) {
  return loadModule('server/src/utils/features.ts', { globals: { process: { env } } }).exports;
}

test('八个服务端功能默认全开，返回值均为布尔值', () => {
  const actual = plain(config().getFeatures());
  assert.deepEqual(actual, Object.fromEntries(Object.keys(flags).map((name) => [name, true])));
});

test('服务端功能独立映射环境变量，只有精确 true 开启', () => {
  for (const [name, envName] of Object.entries(flags)) {
    for (const value of ['true', 'false', 'TRUE', 'True', '1', ' true', 'true ', '']) {
      const actual = plain(config({ [envName]: value }).getFeatures());
      assert.deepEqual(actual, Object.fromEntries(Object.keys(flags).map((key) => [key, key === name ? value === 'true' : true])));
    }
  }
});

test('功能配置在请求时读取，不缓存过期环境值', () => {
  const env = { FEATURE_QUIZ: 'false' };
  const current = config(env);
  assert.equal(current.getFeatures().quiz, false);
  env.FEATURE_QUIZ = 'true';
  assert.equal(current.getFeatures().quiz, true);
  env.FEATURE_QUIZ = 'false';
  assert.equal(current.getFeatures().quiz, false);
});

test('GET /api/features 无需身份且禁止缓存，合同版本和八项开关固定', () => {
  const registrations = [];
  const app = {
    use(...args) { registrations.push({ method: 'use', args }); },
    get(...args) { registrations.push({ method: 'get', args }); },
  };
  const express = () => app;
  express.json = () => 'json';
  express.static = () => 'static';
  const auth = () => { throw new Error('features 不应执行认证'); };
  const features = config();
  loadModule('server/src/app.ts', {
    mocks: {
      express: { default: express }, path: { default: path },
      './middleware/auth': { authMiddleware: auth }, './middleware/error-handler': { errorHandler() {} },
      './routes/models': { default: 'models' }, './routes/wishlist': { default: 'wishlist' },
      './routes/purchases': { default: 'purchases' }, './routes/user': { default: 'user' },
      './routes/forum': { default: 'forum' }, './routes/shares': { default: 'shares', publicSharesRouter: 'publicShares' },
      './routes/builds': { default: 'builds' }, './utils/features': features,
    },
    globals: { __dirname: '/server/src', process: { env: {} } },
  });
  const index = registrations.findIndex(({ method, args }) => method === 'get' && args[0] === '/api/features');
  assert.ok(index >= 0);
  assert.ok(index < registrations.findIndex(({ args }) => args[1] === auth));
  const response = {
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = plain(body); return this; },
  };
  registrations[index].args[1]({}, response);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body, { version: 1, features: plain(features.getFeatures()) });
});
