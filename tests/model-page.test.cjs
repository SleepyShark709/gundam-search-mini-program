const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const kit = { id: 'hg-001', series: 'hg', number: 1, name: '高达', nameJa: 'ガンダム', imageUrl: '/images/hg-001.jpg' };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function session({ catalog = [kit], refresh, wishlist = {}, purchases = {}, records = [] } = {}) {
  const updates = [];
  const writes = [];
  const toasts = [];
  const requests = [];
  const { definition } = loadModule('miniprogram/pages/model/model.ts', {
    mocks: {
      '../../utils/model-service': { getAllModels: () => catalog, refreshMissingModels: async (ids) => { requests.push(plain(ids)); return refresh ? refresh(ids) : catalog; } },
      '../../utils/cloud-favorites': {
        loadWishlist: async () => true, isInWishlist: () => false,
        toggleWishlist: async () => ({ success: true, isFavorite: true }), ...wishlist,
      },
      '../../utils/purchase-service': {
        loadPurchases: async () => true, getPurchaseRecord: (id) => records.find((record) => record.modelId === id),
        addPurchase: async (data) => { writes.push({ method: 'add', data: plain(data) }); return true; },
        updatePurchase: async (id, data) => { writes.push({ method: 'update', id, data: plain(data) }); return true; },
        ...purchases,
      },
    },
    globals: {
      wx: { showToast: (value) => toasts.push(value) },
      getApp: () => ({ globalData: { exchangeRate: 0.06 } }),
    },
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { updates.push(structuredClone(patch)); Object.assign(this.data, structuredClone(patch)); },
  };
  return { page, updates, writes, toasts, requests };
}

test('模型直链验证参数；从目录加载展示并生成可直接打开的单模型分享', async () => {
  const current = session();
  await current.page.onLoad({ id: 'hg-001' });
  assert.deepEqual(current.requests, [['hg-001']]);
  assert.equal(current.page.data.model.id, 'hg-001');
  assert.equal(current.page.data.exchangeRate, 0.06);
  assert.equal(current.page.data.loading, false);
  assert.deepEqual(plain(current.page.onShareAppMessage()), { title: '高达', path: '/pages/model/model?id=hg-001', imageUrl: '/images/hg-001.jpg' });
  assert.deepEqual(plain(current.page.onShareTimeline()), { title: '高达', query: 'id=hg-001' });
  const invalid = session();
  await invalid.page.onLoad({ id: '../user/profile' });
  assert.equal(invalid.requests.length, 0);
  assert.equal(invalid.page.data.error, '模型链接无效');
  assert.equal(invalid.page.data.loading, false);
});

test('模型目录加载失败后可重试；已有本地模型在刷新失败时继续展示', async () => {
  let failing = true;
  const current = session({ catalog: [], refresh: async () => { if (failing) throw new Error('offline'); return [kit]; } });
  await current.page.onLoad({ id: 'hg-001' });
  assert.equal(current.page.data.model, null);
  assert.equal(current.page.data.error, '模型加载失败，请重试');
  failing = false;
  await current.page.loadModel();
  assert.equal(current.page.data.model.id, 'hg-001');
  assert.equal(current.page.data.error, '');
  const local = session({ refresh: async () => { throw new Error('offline'); } });
  await local.page.onLoad({ id: 'hg-001' });
  assert.equal(local.page.data.model.id, 'hg-001');
  assert.equal(local.page.data.error, '');
});

test('私人收藏同步失败限制写操作，重试后按购买对象填充编辑表单', async () => {
  let synced = false;
  let favoriteWrites = 0;
  const current = session({
    records: [{ modelId: 'hg-001', priceCny: 88, purchaseDate: '2026-10-01', channel: '商店', note: '私人记录' }],
    wishlist: {
      loadWishlist: async () => synced, isInWishlist: (id) => id === 'hg-001',
      toggleWishlist: async () => { favoriteWrites++; return { success: true, isFavorite: false }; },
    },
  });
  await current.page.onLoad({ id: 'hg-001' });
  await current.page.onShow();
  assert.equal(current.page.data.syncError, true);
  await current.page.handleFavorite();
  current.page.handlePurchase();
  assert.equal(favoriteWrites, 0);
  assert.equal(current.page.data.formOpen, false);
  synced = true;
  await current.page.syncPersonal();
  assert.equal(current.page.data.syncError, false);
  assert.equal(current.page.data.favorite, true);
  assert.equal(current.page.data.purchased, true);
  current.page.handlePurchase();
  assert.equal(current.page.data.formOpen, true);
  assert.equal(current.page.data.formPriceCny, 88);
  assert.equal(current.page.data.formPurchaseDate, '2026-10-01');
  assert.equal(current.page.data.formNote, '私人记录');
  await current.page.handleFavorite();
  assert.equal(favoriteWrites, 1);
  assert.equal(current.page.data.favorite, false);
});

test('模型入手保存失败保持表单打开，成功更新按真实模型 ID 写入', async () => {
  let success = false;
  const writes = [];
  const current = session({ purchases: { addPurchase: async (data) => { writes.push(plain(data)); return success; } } });
  await current.page.onLoad({ id: 'hg-001' });
  await current.page.onShow();
  current.page.handlePurchase();
  const detail = { modelId: 'spoof-model', priceCny: 99, note: '我的备注' };
  await current.page.handleFormSubmit({ detail });
  assert.equal(current.page.data.formOpen, true);
  assert.equal(current.page.data.purchased, false);
  assert.equal(current.toasts.at(-1).title, '保存失败，请重试');
  success = true;
  await current.page.handleFormSubmit({ detail });
  assert.equal(current.page.data.formOpen, false);
  assert.equal(current.page.data.purchased, true);
  assert.deepEqual(writes, [{ modelId: 'hg-001', priceCny: 99, note: '我的备注' }, { modelId: 'hg-001', priceCny: 99, note: '我的备注' }]);
});

test('模型页卸载后加载、个人同步与购买保存的迟到结果均不更新 UI', async () => {
  for (const operation of ['load', 'personal', 'purchase']) {
    const pending = deferred();
    const current = session({
      ...(operation === 'load' ? { catalog: [], refresh: () => pending.promise } : {}),
      ...(operation === 'personal' ? { wishlist: { loadWishlist: () => pending.promise } } : {}),
      ...(operation === 'purchase' ? { purchases: { addPurchase: () => pending.promise } } : {}),
    });
    let running;
    if (operation === 'load') running = current.page.onLoad({ id: 'hg-001' });
    else {
      await current.page.onLoad({ id: 'hg-001' });
      running = operation === 'personal' ? current.page.onShow() : current.page.handleFormSubmit({ detail: { priceCny: 88 } });
    }
    current.page.onUnload();
    const count = current.updates.length;
    pending.resolve(operation === 'load' ? [kit] : true);
    await running;
    assert.equal(current.updates.length, count, operation);
    assert.equal(current.toasts.length, 0, operation);
  }
});
