const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function component({ kind = 'wishlist', modelIds = ['hg-001'], share } = {}) {
  const calls = [];
  const updates = [];
  const events = [];
  const navigations = [];
  const toasts = [];
  const { definition } = loadModule('miniprogram/components/collection-share/collection-share.ts', {
    mocks: { '../../utils/hangar-service': { createShare: async (input) => { calls.push(plain(input)); return share ? share(input) : { id: 'created-share' }; } } },
    globals: { wx: { navigateTo: (value) => navigations.push(value), showToast: (value) => toasts.push(value) } },
  });
  const instance = {
    ...definition.methods,
    data: { ...structuredClone(definition.data), kind, modelIds: [...modelIds] },
    setData(patch) { updates.push(structuredClone(patch)); Object.assign(this.data, structuredClone(patch)); },
    triggerEvent(name, detail) { events.push({ name, detail: plain(detail) }); },
  };
  definition.lifetimes.attached.call(instance);
  return { instance, definition, calls, updates, events, navigations, toasts };
}

test('清单分享只发送前50个字符串模型 ID，正确区分心愿单与已购买类型', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `hg-${i + 1}`);
  for (const kind of ['wishlist', 'purchased']) {
    const current = component({ kind, modelIds: ids });
    await current.instance.handlePrepare();
    assert.deepEqual(current.calls, [{ kind, title: kind === 'wishlist' ? '我的高达心愿单' : '我的高达收藏', modelIds: ids.slice(0, 50) }]);
    assert.deepEqual(current.events, [{ name: 'prepared', detail: { id: 'created-share' } }]);
    assert.equal(current.navigations[0].url, '/pages/share/share?id=created-share');
    assert.equal(current.instance.data.preparing, false);
  }
  const empty = component({ modelIds: [] });
  await empty.instance.handlePrepare();
  assert.equal(empty.calls.length, 0);
});

test('清单生成失败允许重试且不弹出成功结果，生成期间拒绝重复提交', async () => {
  const pending = deferred();
  const current = component({ share: () => pending.promise });
  const running = current.instance.handlePrepare();
  await current.instance.handlePrepare();
  assert.equal(current.calls.length, 1);
  assert.equal(current.instance.data.preparing, true);
  pending.reject(new Error('network failed'));
  await running;
  assert.equal(current.instance.data.preparing, false);
  assert.equal(current.events.length, 0);
  assert.equal(current.navigations.length, 0);
  assert.equal(current.toasts[0].title, '清单生成失败，请重试');
});

test('生成期间清单内容变化时拒绝旧快照 ID', async () => {
  const pending = deferred();
  const current = component({ modelIds: ['hg-001', 'rg-002'], share: () => pending.promise });
  const running = current.instance.handlePrepare();
  current.instance.data.modelIds = ['rg-002', 'mg-003'];
  pending.resolve({ id: 'stale-share' });
  await running;
  assert.equal(current.events.length, 0);
  assert.equal(current.navigations.length, 0);
  assert.equal(current.instance.data.preparing, false);
});

test('组件 detached 后的成功或失败结果不更新 UI、不导航也不弹 Toast', async () => {
  for (const failed of [false, true]) {
    const pending = deferred();
    const current = component({ share: () => pending.promise });
    const running = current.instance.handlePrepare();
    current.definition.lifetimes.detached.call(current.instance);
    const count = current.updates.length;
    if (failed) pending.reject(new Error('network failed'));
    else pending.resolve({ id: 'old-share' });
    await running;
    assert.equal(current.updates.length, count);
    assert.equal(current.events.length, 0);
    assert.equal(current.navigations.length, 0);
    assert.equal(current.toasts.length, 0);
  }
});

test('个人清单按服务真实类型读取：心愿单为 ID 数组，购买列表为记录对象', () => {
  const catalog = [{ id: 'hg-001', series: 'hg', number: 1, name: '高达', price: 1000 }];
  const purchases = [{ modelId: 'hg-001', priceCny: 99, purchaseDate: null, channel: null, note: null, createdAt: '2026-01-01' },
    { modelId: 'mg-999', priceCny: null, purchaseDate: null, channel: null, note: null, createdAt: '2026-01-01' }];
  const pilot = loadModule('miniprogram/utils/pilot-progress.ts').exports;
  for (const kind of ['wishlist', 'purchased']) {
    const { definition } = loadModule(`miniprogram/pages/${kind}/${kind}.ts`, {
      mocks: {
        '../../utils/model-service': { getAllModels: () => catalog },
        '../../utils/cloud-favorites': { getWishlist: () => ['hg-001', 'mg-999'] },
        '../../utils/purchase-service': { getPurchases: () => purchases },
        '../../utils/hangar-service': {}, '../../utils/pilot-progress': pilot,
      },
      globals: { wx: { nextTick() {} } },
    });
    const page = {
      ...definition, _allModels: catalog,
      data: structuredClone(definition.data),
      setData(patch) { Object.assign(this.data, structuredClone(patch)); },
    };
    page.refreshList();
    assert.deepEqual(page.data.shareModelIds, ['hg-001']);
    assert.equal(page.data.totalCount, 2);
    const items = kind === 'wishlist' ? page.data.wishlistItems : page.data.purchaseItems;
    assert.equal(items.filter((item) => item.model === null).length, 1);
    if (kind === 'purchased') assert.equal(items.find((item) => item.modelId === 'hg-001').record.priceCny, 99);
  }
});
