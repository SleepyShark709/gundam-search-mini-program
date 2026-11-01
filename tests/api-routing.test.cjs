const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

function session(envVersion = 'develop') {
  const requests = [];
  const localRequests = [];
  const initializations = [];
  const timers = new Map();
  let timerId = 0;
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { appId: 'test-mini', envVersion } }),
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    request: (options) => localRequests.push(options),
    cloud: {
      init: (options) => initializations.push(options),
      callContainer: (options) => requests.push(options),
    },
  };
  const api = loadModule('miniprogram/utils/api.ts', {
    globals: {
      wx,
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  }).exports;
  return { api, wx, requests, localRequests, initializations, timers };
}

for (const envVersion of ['develop', 'trial', 'release']) {
  test(`${envVersion} 默认通过云托管读取资料，不发局域网请求或注入 mock openid`, async () => {
    const { api, requests, localRequests, initializations, timers } = session(envVersion);
    const reading = api.callAPI({ path: '/api/user/profile', method: 'GET' });
    assert.equal(api.USE_LOCAL, false);
    assert.equal(localRequests.length, 0);
    assert.equal(requests.length, 1);
    assert.equal(initializations.length, 1);
    assert.equal(requests[0].path, '/api/user/profile');
    assert.equal(requests[0].method, 'GET');
    assert.equal(Object.hasOwn(requests[0].header, 'X-WX-OPENID'), false);
    assert.equal(Object.values(requests[0].header).includes('local-dev-user'), false);
    requests[0].success({ statusCode: 200, data: { openid: 'cloud-user' } });
    assert.equal((await reading).openid, 'cloud-user');
    assert.equal(timers.size, 0);
  });
}

test('develop 云端 GET 仍在五秒后超时并清理计时器', async () => {
  const { api, requests, timers } = session();
  const reading = api.callAPI({ path: '/api/user/profile', method: 'GET' });
  assert.equal(requests.length, 1);
  assert.equal(timers.size, 1);
  const timer = Array.from(timers.values())[0];
  assert.equal(timer.delay, 5000);
  timer.callback();
  await assert.rejects(reading, /请求超时 \(5000ms\)/);
  assert.equal(timers.size, 0);
});

test('develop 云端资料写入等待回调，迟到 GET 仍不覆盖新资料', async () => {
  const { api, wx, requests, localRequests, initializations, timers } = session();
  const users = loadModule('miniprogram/utils/user-service.ts', {
    mocks: { './api': api },
    globals: { wx, console: { error() {} } },
  }).exports;
  const reading = users.loadUserInfo();
  let finished = false;
  const writing = users.updateUserProfile({ nickname: '新昵称' }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  assert.equal(localRequests.length, 0);
  assert.equal(initializations.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].data, '{"nickname":"新昵称"}');
  assert.equal(Object.hasOwn(requests[1].header, 'X-WX-OPENID'), false);
  assert.equal(timers.size, 1);
  const profile = { openid: 'cloud-user', avatarUrl: null, isAdmin: false };
  requests[1].success({ statusCode: 200, data: { ...profile, nickname: '新昵称' } });
  assert.equal((await writing).nickname, '新昵称');
  requests[0].success({ statusCode: 200, data: { ...profile, nickname: '旧昵称' } });
  assert.equal(await reading, true);
  assert.equal(users.getUserInfo().nickname, '新昵称');
  assert.equal(timers.size, 0);
});
