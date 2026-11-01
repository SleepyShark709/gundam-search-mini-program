const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/load-typescript.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function service(file, callAPI) {
  return loadModule(`miniprogram/utils/${file}.ts`, {
    mocks: { './api': { callAPI, isNetworkError: (error) => error.networkError === true } },
    globals: { console: { error() {} } },
  }).exports;
}

function purchase(modelId, fields = {}) {
  return {
    modelId, priceCny: null, purchaseDate: null, channel: null, note: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...fields,
  };
}

const flush = () => new Promise(setImmediate);

test('心愿单加载共享进行中的请求，完成后仍可刷新', async () => {
  const read = deferred();
  let calls = 0;
  const favorites = service('cloud-favorites', () => { calls++; return read.promise; });
  const first = favorites.loadWishlist();
  assert.equal(favorites.loadWishlist(), first);
  assert.equal(calls, 1);
  read.resolve({ modelIds: ['A'] });
  assert.equal(await first, true);
  assert.deepEqual(Array.from(favorites.getWishlist()), ['A']);
  await favorites.loadWishlist();
  assert.equal(calls, 2);
});

test('心愿单读取失败返回 false 并保留缓存，成功空记录返回 true', async () => {
  let failure = false;
  let ids = ['A'];
  const favorites = service('cloud-favorites', () => failure
    ? Promise.reject(new Error('读取失败'))
    : Promise.resolve({ modelIds: ids }));
  assert.equal(await favorites.loadWishlist(), true);
  failure = true;
  assert.equal(await favorites.loadWishlist(), false);
  assert.deepEqual(Array.from(favorites.getWishlist()), ['A']);
  failure = false;
  ids = [];
  assert.equal(await favorites.loadWishlist(), true);
  assert.deepEqual(Array.from(favorites.getWishlist()), []);
});

test('收藏旧 GET 不覆盖新写入，A 删除回滚不会撤销 B 的成功添加', async () => {
  const oldRead = deferred();
  const remove = deferred();
  let reads = 0;
  const favorites = service('cloud-favorites', (options) => {
    if (options.method === 'GET') return ++reads === 1 ? Promise.resolve({ modelIds: ['A'] }) : oldRead.promise;
    if (options.method === 'DELETE') return remove.promise;
    return Promise.resolve({ success: true });
  });
  await favorites.loadWishlist();
  const loading = favorites.loadWishlist();
  const removing = favorites.removeFromWishlist('A');
  assert.equal(await favorites.addToWishlist('B'), true);
  oldRead.resolve({ modelIds: ['A'] });
  await loading;
  assert.deepEqual(Array.from(favorites.getWishlist()), ['B']);
  remove.reject(new Error('HTTP 500'));
  assert.equal(await removing, false);
  assert.deepEqual(new Set(favorites.getWishlist()), new Set(['A', 'B']));
});

test('同模型连续 toggle 按顺序发送，最终状态与服务器操作顺序一致', async () => {
  const add = deferred();
  const remove = deferred();
  const methods = [];
  const favorites = service('cloud-favorites', ({ method }) => {
    methods.push(method);
    return method === 'POST' ? add.promise : remove.promise;
  });
  const first = favorites.toggleWishlist('A');
  const second = favorites.toggleWishlist('A');
  assert.deepEqual(methods, ['POST']);
  add.resolve({ success: true });
  assert.equal((await first).success, true);
  await flush();
  assert.deepEqual(methods, ['POST', 'DELETE']);
  remove.resolve({ success: true });
  const result = await second;
  assert.equal(result.success, true);
  assert.equal(result.isFavorite, false);
  assert.equal(favorites.isInWishlist('A'), false);
});

test('toggle 明确返回失败及回滚后的选中状态', async () => {
  const favorites = service('cloud-favorites', () => Promise.reject(new Error('HTTP 500')));
  const result = await favorites.toggleWishlist('A');
  assert.equal(result.success, false);
  assert.equal(result.isFavorite, false);
});

test('收藏 SDK 失败后核对最终状态，已提交的添加仍返回成功', async () => {
  const favorites = service('cloud-favorites', ({ method }) => method === 'GET'
    ? Promise.resolve({ modelIds: ['A'] })
    : Promise.reject({ networkError: true }));
  assert.equal(await favorites.addToWishlist('A'), true);
  assert.equal(favorites.isInWishlist('A'), true);
});

test('购买加载共享请求、规范日期，并保护 GET 期间成功保存的记录', async () => {
  const read = deferred();
  const calls = [];
  const purchases = service('purchase-service', (options) => {
    calls.push(options);
    return options.method === 'GET' ? read.promise : Promise.resolve({ success: true });
  });
  const loading = purchases.loadPurchases();
  assert.equal(purchases.loadPurchases(), loading);
  assert.equal(calls.length, 1);
  assert.equal(await purchases.addPurchase({ modelId: 'B', priceCny: 12, note: null }), true);
  assert.equal(purchases.isPurchased('B'), true);
  read.resolve({ purchases: [purchase('A', { purchaseDate: '2026-04-01T00:00:00.000Z' })] });
  assert.equal(await loading, true);
  assert.equal(purchases.getPurchaseRecord('A').purchaseDate, '2026-04-01');
  assert.equal(purchases.getPurchaseRecord('B').priceCny, 12);
  assert.equal(calls.filter((call) => call.method === 'GET').length, 1);
});

test('购买读取失败返回 false 并保留缓存，成功空记录返回 true', async () => {
  let failure = false;
  let records = [purchase('A', { priceCny: 80 })];
  const purchases = service('purchase-service', () => failure
    ? Promise.reject(new Error('读取失败'))
    : Promise.resolve({ purchases: records }));
  assert.equal(await purchases.loadPurchases(), true);
  const cached = purchases.getPurchases();
  failure = true;
  assert.equal(await purchases.loadPurchases(), false);
  assert.equal(purchases.getPurchases(), cached);
  assert.equal(purchases.getPurchaseRecord('A').priceCny, 80);
  failure = false;
  records = [];
  assert.equal(await purchases.loadPurchases(), true);
  assert.equal(purchases.getPurchases().length, 0);
});

test('购买写成功不依赖后续读取，null 清空字段且未传字段保留', async () => {
  let reads = 0;
  let submitted;
  const purchases = service('purchase-service', (options) => {
    if (options.method === 'GET') {
      reads++;
      if (reads > 1) return Promise.reject(new Error('刷新失败'));
      return Promise.resolve({ purchases: [purchase('A', { priceCny: 10, channel: '店铺', note: '旧备注' })] });
    }
    submitted = options.data;
    return Promise.resolve({ success: true });
  });
  await purchases.loadPurchases();
  assert.equal(await purchases.updatePurchase('A', { priceCny: null, note: null }), true);
  assert.equal(submitted.priceCny, null);
  assert.equal(submitted.note, null);
  assert.equal(purchases.getPurchaseRecord('A').priceCny, null);
  assert.equal(purchases.getPurchaseRecord('A').note, null);
  assert.equal(purchases.getPurchaseRecord('A').channel, '店铺');
  await purchases.loadPurchases();
  assert.equal(purchases.getPurchaseRecord('A').note, null);
});

test('明确的购买写失败返回 false，缓存不伪装为已保存', async () => {
  const purchases = service('purchase-service', () => Promise.reject(new Error('HTTP 500')));
  assert.equal(await purchases.addPurchase({ modelId: 'A' }), false);
  assert.equal(purchases.isPurchased('A'), false);
  assert.equal(await purchases.updatePurchase('A', { note: '失败' }), false);
});

test('购买 SDK 失败会读取核对，匹配的已提交记录返回成功', async () => {
  const methods = [];
  const purchases = service('purchase-service', ({ method }) => {
    methods.push(method);
    return method === 'GET'
      ? Promise.resolve({ purchases: [purchase('A', { note: '已提交' })] })
      : Promise.reject({ networkError: true });
  });
  assert.equal(await purchases.addPurchase({ modelId: 'A', note: '已提交' }), true);
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(purchases.getPurchaseRecord('A').note, '已提交');
});

test('购买 A 删除失败按 ID 恢复，保留 B 的成功添加', async () => {
  const remove = deferred();
  const purchases = service('purchase-service', ({ method }) => {
    if (method === 'GET') return Promise.resolve({ purchases: [purchase('A')] });
    return method === 'DELETE' ? remove.promise : Promise.resolve({ success: true });
  });
  await purchases.loadPurchases();
  const removing = purchases.removePurchase('A');
  await purchases.addPurchase({ modelId: 'B' });
  remove.reject(new Error('HTTP 500'));
  assert.equal(await removing, false);
  assert.equal(purchases.isPurchased('A'), true);
  assert.equal(purchases.isPurchased('B'), true);
});

test('用户加载共享请求，旧 GET 不覆盖已更新的资料', async () => {
  const read = deferred();
  let calls = 0;
  const users = service('user-service', ({ method }) => {
    calls++;
    return method === 'GET' ? read.promise : Promise.resolve({ openid: 'u', nickname: '新昵称', avatarUrl: 'new', isAdmin: true });
  });
  const loading = users.loadUserInfo();
  assert.equal(users.loadUserInfo(), loading);
  assert.equal(calls, 1);
  await users.updateUserProfile({ nickname: '新昵称' });
  read.resolve({ openid: 'u', nickname: '旧昵称', avatarUrl: 'old', isAdmin: false });
  await loading;
  assert.equal(users.getUserInfo().nickname, '新昵称');
  assert.equal(users.isCurrentUserAdmin(), true);
});

for (const readFirst of [false, true]) {
  const order = readFirst ? 'GET 先返回' : '失败写先返回';

  test(`收藏首次加载与失败写并发时保留服务端记录（${order}）`, async () => {
    const read = deferred();
    const write = deferred();
    const favorites = service('cloud-favorites', ({ method }) => method === 'GET' ? read.promise : write.promise);
    const loading = favorites.loadWishlist();
    const changing = favorites.toggleWishlist('A');
    if (readFirst) {
      read.resolve({ modelIds: ['A'] });
      await loading;
    }
    write.reject(new Error('HTTP 500'));
    const result = await changing;
    if (!readFirst) read.resolve({ modelIds: ['A'] });
    await loading;
    assert.equal(result.success, false);
    assert.equal(favorites.isInWishlist('A'), true);
    if (readFirst) assert.equal(result.isFavorite, true);
  });

  test(`购买首次加载与新增冲突并发时保留已有记录（${order}）`, async () => {
    const read = deferred();
    const write = deferred();
    const purchases = service('purchase-service', ({ method }) => method === 'GET' ? read.promise : write.promise);
    const loading = purchases.loadPurchases();
    const adding = purchases.addPurchase({ modelId: 'A', note: '新备注' });
    if (readFirst) {
      read.resolve({ purchases: [purchase('A', { note: '已有备注' })] });
      await loading;
    }
    write.reject(new Error('HTTP 409'));
    assert.equal(await adding, false);
    if (!readFirst) read.resolve({ purchases: [purchase('A', { note: '已有备注' })] });
    await loading;
    assert.equal(purchases.getPurchaseRecord('A').note, '已有备注');
  });

  test(`用户首次加载与失败更新并发时保留已有资料（${order}）`, async () => {
    const read = deferred();
    const write = deferred();
    const users = service('user-service', ({ method }) => method === 'GET' ? read.promise : write.promise);
    const profile = { openid: 'u', nickname: '已有昵称', avatarUrl: 'existing', isAdmin: true };
    const loading = users.loadUserInfo();
    const updating = users.updateUserProfile({ nickname: '新昵称' });
    if (readFirst) {
      read.resolve(profile);
      await loading;
    }
    write.reject(new Error('HTTP 500'));
    assert.equal(await updating, null);
    if (!readFirst) read.resolve(profile);
    await loading;
    assert.equal(users.getUserInfo().nickname, '已有昵称');
    assert.equal(users.getCurrentOpenid(), 'u');
    assert.equal(users.isCurrentUserAdmin(), true);
    assert.equal(users.isUserInfoLoaded(), true);
  });
}

test('购买网络核对确认写入未生效时，旧 GET 不覆盖核对后的记录', async () => {
  const oldRead = deferred();
  let reads = 0;
  const purchases = service('purchase-service', ({ method }) => {
    if (method !== 'GET') return Promise.reject({ networkError: true });
    return ++reads === 1 ? oldRead.promise : Promise.resolve({ purchases: [purchase('A', { note: '服务端备注' })] });
  });
  const loading = purchases.loadPurchases();
  assert.equal(await purchases.updatePurchase('A', { note: '未提交备注' }), false);
  oldRead.resolve({ purchases: [] });
  await loading;
  assert.equal(purchases.getPurchaseRecord('A').note, '服务端备注');
});

test('收藏网络核对确认移除未生效时，旧 GET 不覆盖核对后的状态', async () => {
  const oldRead = deferred();
  let reads = 0;
  const favorites = service('cloud-favorites', ({ method }) => {
    if (method !== 'GET') return Promise.reject({ networkError: true });
    return ++reads === 2 ? oldRead.promise : Promise.resolve({ modelIds: ['A'] });
  });
  await favorites.loadWishlist();
  const loading = favorites.loadWishlist();
  assert.equal(await favorites.removeFromWishlist('A'), false);
  oldRead.resolve({ modelIds: [] });
  await loading;
  assert.equal(favorites.isInWishlist('A'), true);
});

function cloudAPI() {
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const api = loadModule('miniprogram/utils/api.ts', {
    globals: {
      wx: {
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
        cloud: { init() {}, callContainer: (options) => requests.push(options) },
      },
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  }).exports;
  return { api, requests, timers };
}

test('云端 GET 成功、失败及超时后均清理计时器', async () => {
  const { api, requests, timers } = cloudAPI();
  const success = api.callAPI({ path: '/read', method: 'GET' });
  assert.equal(timers.size, 1);
  requests[0].success({ statusCode: 200, data: { ok: true } });
  assert.equal((await success).ok, true);
  assert.equal(timers.size, 0);
  const failure = api.callAPI({ path: '/read', method: 'GET' });
  requests[1].fail({ errMsg: '断网' });
  await assert.rejects(failure, (error) => api.isNetworkError(error));
  assert.equal(timers.size, 0);
  const timeout = api.callAPI({ path: '/read', method: 'GET' });
  const pending = Array.from(timers.values())[0];
  assert.equal(pending.delay, 5000);
  pending.callback();
  await assert.rejects(timeout, /请求超时/);
  assert.equal(timers.size, 0);
});

test('云端写操作不会被五秒计时器提前判失败，并保留 null payload', async () => {
  const { api, requests, timers } = cloudAPI();
  let finished = false;
  const write = api.callAPI({ path: '/write', method: 'PUT', data: { note: null } }).then(() => { finished = true; });
  assert.equal(timers.size, 0);
  await flush();
  assert.equal(finished, false);
  assert.equal(requests[0].data, '{"note":null}');
  requests[0].success({ statusCode: 200, data: { success: true } });
  await write;
  assert.equal(finished, true);
  assert.equal(timers.size, 0);
});
