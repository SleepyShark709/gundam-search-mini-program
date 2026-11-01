const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');
const { enabledFeatures } = require('./helpers/enabled-features.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function model(id) {
  return {
    id, series: id.split('-')[0], number: Number(id.split('-')[1]) || 1,
    name: id, nameJa: id, price: 2000, priceTaxFree: 1800,
    releaseDate: '2026-01', isLimited: false, imageUrl: '', productUrl: '',
  };
}

function purchase(modelId, fields = {}) {
  return {
    modelId, priceCny: 50, purchaseDate: null, channel: null, note: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...fields,
  };
}

function catalog(localModels = [], cloudModels = []) {
  const requests = [];
  const { exports } = loadModule('miniprogram/utils/model-service.ts', {
    mocks: {
      './cdn-config': { resolveImageUrl: (url) => url },
      './api': {
        async callAPI({ path }) {
          requests.push(path);
          const code = path.split('/').pop();
          return { data: cloudModels.filter((item) => item.series === code), version: 'test' };
        },
      },
      '../data/series-meta': [],
    },
    globals: {
      wx: {
        getStorageSync() {}, setStorageSync() {},
        getFileSystemManager: () => ({
          readFileSync: (path) => JSON.stringify(localModels.filter((item) => path === `/data/${item.series}.json`)),
        }),
      },
    },
  });
  return { service: exports, requests };
}

function page(name, { models = [], modelService, state = {}, wishlist = {}, purchases = {}, user = {}, app = {} } = {}) {
  state.ids ||= [];
  state.records ||= [];
  const toasts = [];
  const modals = [];
  const updates = [];
  const wx = {
    showToast: (value) => toasts.push(value),
    showModal: (value) => modals.push(value),
    nextTick() {}, getStorageSync() {},
  };
  const appInstance = {
    globalData: { statusBarHeight: 20, safeAreaBottom: 0, windowWidth: 375, exchangeRate: 0.05, userInfoLoaded: true },
    async loadUserInfo() {},
    ...app,
  };
  const { definition } = loadModule(`miniprogram/pages/${name}/${name}.ts`, {
    mocks: {
      ...enabledFeatures().mocks,
      '../../utils/model-service': modelService || { getAllModels: () => models, refreshMissingModels: async () => models },
      '../../utils/cloud-favorites': {
        getWishlist: () => state.ids,
        loadWishlist: async () => true,
        isInWishlist: (id) => state.ids.includes(id),
        toggleWishlist: async () => ({ success: true, isFavorite: false }),
        ...wishlist,
      },
      '../../utils/purchase-service': {
        getPurchases: () => state.records,
        getPurchaseRecord: (id) => state.records.find((record) => record.modelId === id),
        isPurchased: (id) => state.records.some((record) => record.modelId === id),
        loadPurchases: async () => true,
        addPurchase: async () => true,
        updatePurchase: async () => true,
        removePurchase: async () => true,
        ...purchases,
      },
      '../../utils/user-service': { getUserInfo: () => state.user || null, updateUserProfile: async () => null, ...user },
      '../../utils/api': { ensureCloudInit() {} },
      '../../utils/hangar-service': { loadBuildProgress: async () => [] },
      '../../utils/pilot-progress': loadModule('miniprogram/utils/pilot-progress.ts').exports,
    },
    globals: { wx, getApp: () => appInstance },
  });
  const instance = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { updates.push(patch); Object.assign(this.data, patch); },
  };
  instance.onLoad();
  return { instance, state, toasts, modals, updates };
}

function cloudRecords() {
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
  const wishlist = loadModule('miniprogram/utils/cloud-favorites.ts', {
    mocks: { './api': api },
    globals: { console: { error() {} } },
  }).exports;
  const purchases = loadModule('miniprogram/utils/purchase-service.ts', {
    mocks: { './api': api },
    globals: { console: { error() {} } },
  }).exports;
  return { wishlist, purchases, requests, timers };
}

for (const existing of [false, true]) {
  for (const success of [false, true]) {
    test(`心愿单${existing ? '编辑' : '新增'}购买返回 ${success} 时准确保留表单和状态`, async () => {
      const writes = [];
      const { instance, toasts } = page('wishlist', {
        state: { records: existing ? [purchase('hg-001')] : [] },
        purchases: {
          async addPurchase(data) { writes.push(['add', data.modelId]); return success; },
          async updatePurchase(id) { writes.push(['update', id]); return success; },
        },
      });
      instance.data.formOpen = true;
      instance.data.selectedIsPurchased = existing;
      await instance.handleFormSubmit({ detail: { modelId: 'hg-001', priceCny: 80 } });
      assert.deepEqual(writes, [[existing ? 'update' : 'add', 'hg-001']]);
      assert.equal(instance.data.formOpen, !success);
      assert.equal(instance.data.selectedIsPurchased, success || existing);
      assert.equal(toasts.at(-1).title, success ? '保存成功' : '保存失败');
    });
  }
}

for (const success of [false, true]) {
  test(`已购编辑返回 ${success} 时${success ? '关闭' : '保留'}表单`, async () => {
    const { instance, toasts } = page('purchased', { purchases: { updatePurchase: async () => success } });
    instance.data.formOpen = true;
    await instance.handleFormSubmit({ detail: { modelId: 'hg-001', priceCny: null } });
    assert.equal(instance.data.formOpen, !success);
    assert.equal(toasts.at(-1).title, success ? '保存成功' : '保存失败');
  });
}

test('个人页等待冷启动中的用户资料、心愿单和购买加载后自动更新', async () => {
  const wishlistLoad = deferred();
  const purchaseLoad = deferred();
  const userLoad = deferred();
  const state = {};
  const { instance } = page('profile', {
    state,
    wishlist: { async loadWishlist() { await wishlistLoad.promise; state.ids = ['hg-001', 'rg-001']; return true; } },
    purchases: { async loadPurchases() { await purchaseLoad.promise; state.records = [purchase('hg-001')]; } },
    app: {
      globalData: { statusBarHeight: 20, safeAreaBottom: 0, userInfoLoaded: false },
      async loadUserInfo() { await userLoad.promise; state.user = { nickname: '驾驶员', avatarUrl: 'cloud://avatar' }; },
    },
  });
  const showing = instance.onShow();
  assert.equal(instance.data.wishlistCount, 0);
  wishlistLoad.resolve();
  purchaseLoad.resolve();
  userLoad.resolve();
  await showing;
  assert.equal(instance.data.wishlistCount, 2);
  assert.equal(instance.data.purchasedCount, 1);
  assert.equal(instance.data.nickname, '驾驶员');
});

for (const name of ['wishlist', 'purchased']) {
  test(`${name} 等待两种用户记录加载后同步列表与详情`, async () => {
    const wishlistLoad = deferred();
    const purchaseLoad = deferred();
    const item = model('hg-001');
    const state = {};
    const { instance } = page(name, {
      models: [item], state,
      wishlist: { async loadWishlist() { await wishlistLoad.promise; state.ids = [item.id]; return true; } },
      purchases: { async loadPurchases() { await purchaseLoad.promise; state.records = [purchase(item.id)]; return true; } },
    });
    instance.data.selectedModel = item;
    const showing = instance.onShow();
    wishlistLoad.resolve();
    await Promise.resolve();
    assert.equal(instance.data.loading, true);
    purchaseLoad.resolve();
    await showing;
    assert.equal(instance.data.totalCount, 1);
    assert.equal(instance.data.selectedIsWishlist, true);
    if (name === 'wishlist') assert.equal(instance.data.selectedIsPurchased, true);
  });

  test(`${name} 收藏失败使用服务确认的最终状态并反馈失败`, async () => {
    for (const isFavorite of [false, true]) {
      const item = model('hg-001');
      const { instance, toasts } = page(name, {
        models: [item], state: { ids: isFavorite ? [item.id] : [] },
        wishlist: { toggleWishlist: async () => ({ success: false, isFavorite }) },
      });
      instance.data.selectedModel = item;
      instance.data.selectedIsWishlist = !isFavorite;
      await instance.handleToggleWishlist({ detail: { id: item.id } });
      assert.equal(instance.data.selectedIsWishlist, isFavorite);
      assert.equal(toasts.at(-1).title, '心愿单更新失败');
    }
  });

  test(`${name} 关联云端新增模型，只刷新缺失系列，并保留仍未匹配记录`, async () => {
    const known = model('hg-001');
    const cloudOnly = model('rg-999');
    const { service, requests } = catalog([known], [cloudOnly]);
    const state = { ids: [known.id, cloudOnly.id, 'mg-missing', 'unknown-id'], records: [
      purchase(known.id), purchase(cloudOnly.id), purchase('mg-missing'), purchase('unknown-id'),
    ] };
    const { instance } = page(name, { modelService: service, state });
    await instance.onShow();
    assert.deepEqual(requests.sort(), ['/api/models/mg', '/api/models/rg']);
    const items = name === 'wishlist' ? instance.data.wishlistItems : instance.data.purchaseItems;
    const idOf = (item) => name === 'wishlist' ? item.id : item.modelId;
    assert.equal(instance.data.totalCount, 4);
    assert.equal(items.find((item) => idOf(item) === cloudOnly.id).model.name, cloudOnly.name);
    assert.equal(items.find((item) => idOf(item) === 'mg-missing').model, null);
    assert.equal(items.find((item) => idOf(item) === 'unknown-id').model, null);
    assert.equal(instance.data.allModels, undefined);
    if (name === 'purchased') {
      assert.equal(instance.data.totalSpentText, '200.00');
      assert.equal(instance.data.hasCompare, false);
      assert.equal(instance.data.radarDimensions[2], 0);
      const index = items.findIndex((item) => item.modelId === 'mg-missing');
      instance.handleInfoTap({ currentTarget: { dataset: { index } } });
      assert.equal(instance.data.formModelId, 'mg-missing');
      assert.match(instance.data.formModelName, /模型信息暂未同步/);
    }
  });
}

test('目录已匹配全部记录时不刷新任何系列', async () => {
  const { service, requests } = catalog([model('hg-001')]);
  const result = await service.refreshMissingModels(['hg-001']);
  assert.equal(result.length, 1);
  assert.deepEqual(requests, []);
});

test('心愿单首次仅展示40项，追加到末尾后与完整记录一致', async () => {
  const models = Array.from({ length: 93 }, (_, index) => model(`hg-${String(index + 1).padStart(3, '0')}`));
  const { instance, updates } = page('wishlist', { models, state: { ids: models.map((item) => item.id) } });
  await instance.onShow();
  assert.equal(instance.data.totalCount, 93);
  assert.equal(instance.data.wishlistItems.length, 40);
  assert.ok(updates.every((patch) => !Object.hasOwn(patch, 'allModels')));
  instance.handleLoadMore();
  assert.equal(instance.data.wishlistItems.length, 80);
  instance.handleLoadMore();
  assert.equal(instance.data.wishlistItems.length, 93);
  const updateCount = updates.length;
  instance.handleLoadMore();
  assert.equal(updates.length, updateCount);
  assert.deepEqual(Array.from(instance.data.wishlistItems, (item) => item.id), models.map((item) => item.id));
});

test('未同步的心愿记录仍可移除，未同步的购买记录仍可删除', async () => {
  const state = { ids: ['hg-missing'], records: [purchase('hg-missing')] };
  const wishlistPage = page('wishlist', {
    state,
    wishlist: { async toggleWishlist(id) { state.ids = state.ids.filter((item) => item !== id); return { success: true, isFavorite: false }; } },
  });
  await wishlistPage.instance.onShow();
  await wishlistPage.instance.handleRemoveMissing({ currentTarget: { dataset: { id: 'hg-missing' } } });
  assert.equal(wishlistPage.instance.data.totalCount, 0);
  const purchasedPage = page('purchased', {
    state,
    purchases: { async removePurchase(id) { state.records = state.records.filter((item) => item.modelId !== id); return true; } },
  });
  await purchasedPage.instance.onShow();
  purchasedPage.instance.handleDelete({ currentTarget: { dataset: { modelId: 'hg-missing' } } });
  await purchasedPage.modals[0].success({ confirm: true });
  assert.equal(purchasedPage.instance.data.totalCount, 0);
});

for (const failure of ['断网', '超时']) {
  test(`心愿单真实加载链路${failure}显示错误，重试合并请求并恢复列表`, async () => {
    const { wishlist, requests, timers } = cloudRecords();
    const item = model('hg-001');
    const { instance } = page('wishlist', { models: [item], wishlist });
    const showing = instance.onShow();
    assert.equal(instance.data.loading, true);
    if (failure === '超时') {
      const timer = Array.from(timers.values())[0];
      assert.equal(timer.delay, 5000);
      timer.callback();
    } else {
      requests[0].fail({ errMsg: '断网' });
    }
    await showing;
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.loadError, true);
    assert.equal(instance.data.totalCount, 0);
    instance.refreshList();
    assert.equal(instance.data.loadError, true);
    const retrying = instance.handleRetry();
    assert.equal(instance.data.loading, true);
    assert.equal(instance.data.loadError, false);
    assert.equal(instance.handleRetry(), retrying);
    assert.equal(instance.onShow(), retrying);
    assert.equal(requests.length, 2);
    instance.refreshList();
    assert.equal(instance.data.loading, true);
    requests[1].success({ statusCode: 200, data: { modelIds: [item.id] } });
    await retrying;
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.loadError, false);
    assert.equal(instance.data.totalCount, 1);
    assert.equal(instance.data.wishlistItems[0].id, item.id);
  });
}

test('心愿单真实读取成功且为空时显示正常空状态', async () => {
  const { wishlist, requests } = cloudRecords();
  const { instance } = page('wishlist', { wishlist });
  const showing = instance.onShow();
  requests[0].success({ statusCode: 200, data: { modelIds: [] } });
  await showing;
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.loadError, false);
  assert.equal(instance.data.totalCount, 0);
});

test('心愿单缓存已有记录时刷新失败保留展示内容并反馈错误', async () => {
  const { wishlist, requests } = cloudRecords();
  const item = model('hg-001');
  const seeding = wishlist.loadWishlist();
  requests[0].success({ statusCode: 200, data: { modelIds: [item.id] } });
  await seeding;
  const { instance } = page('wishlist', { models: [item], wishlist });
  const cachedItems = instance.data.wishlistItems;
  assert.equal(instance.data.totalCount, 1);
  const showing = instance.onShow();
  requests[1].fail({ errMsg: '断网' });
  await showing;
  assert.equal(instance.data.wishlistItems, cachedItems);
  assert.equal(instance.data.totalCount, 1);
  assert.equal(instance.data.loadError, true);
  assert.equal(instance.data.loading, false);
});

test('心愿单页面卸载后忽略迟到的读取结果', async () => {
  const { wishlist, requests } = cloudRecords();
  const { instance, updates } = page('wishlist', { wishlist });
  const showing = instance.onShow();
  instance.onUnload();
  const updateCount = updates.length;
  requests[0].success({ statusCode: 200, data: { modelIds: ['hg-001'] } });
  await showing;
  await instance.handleRetry();
  assert.equal(updates.length, updateCount);
  assert.equal(requests.length, 1);
});

test('心愿单页面卸载后忽略迟到的目录刷新', async () => {
  const refreshing = deferred();
  const started = deferred();
  const { instance, updates } = page('wishlist', {
    state: { ids: ['hg-001'] },
    modelService: {
      getAllModels: () => [],
      refreshMissingModels() { started.resolve(); return refreshing.promise; },
    },
  });
  const showing = instance.onShow();
  await started.promise;
  instance.onUnload();
  const updateCount = updates.length;
  refreshing.resolve([model('hg-001')]);
  await showing;
  assert.equal(updates.length, updateCount);
});

test('购买加载失败不会误报心愿单读取失败，目录失败仍展示占位记录', async () => {
  const { instance } = page('wishlist', {
    state: { ids: ['hg-missing'] },
    purchases: { async loadPurchases() { throw new Error('购买读取失败'); } },
    modelService: {
      getAllModels: () => [],
      async refreshMissingModels() { throw new Error('目录读取失败'); },
    },
  });
  await instance.onShow();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.loadError, false);
  assert.equal(instance.data.totalCount, 1);
  assert.equal(instance.data.wishlistItems[0].model, null);
});

for (const failure of ['断网', '超时']) {
  test(`已购真实加载链路${failure}显示错误，重试合并请求并恢复列表与统计`, async () => {
    const { purchases, requests, timers } = cloudRecords();
    const item = model('hg-001');
    const { instance } = page('purchased', { models: [item], purchases });
    const showing = instance.onShow();
    assert.equal(instance.data.loading, true);
    if (failure === '超时') {
      const timer = Array.from(timers.values())[0];
      assert.equal(timer.delay, 5000);
      timer.callback();
    } else {
      requests[0].fail({ errMsg: '断网' });
    }
    await showing;
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.loadError, true);
    assert.equal(instance.data.totalCount, 0);
    assert.equal(instance.data.hasStats, false);
    instance.refreshList();
    assert.equal(instance.data.loadError, true);
    const retrying = instance.handleRetry();
    assert.equal(instance.data.loading, true);
    assert.equal(instance.data.loadError, false);
    assert.equal(instance.handleRetry(), retrying);
    assert.equal(instance.onShow(), retrying);
    assert.equal(requests.length, 2);
    instance.refreshList();
    assert.equal(instance.data.loading, true);
    requests[1].success({ statusCode: 200, data: { purchases: [purchase(item.id)] } });
    await retrying;
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.loadError, false);
    assert.equal(instance.data.totalCount, 1);
    assert.equal(instance.data.purchaseItems[0].modelId, item.id);
    assert.equal(instance.data.hasStats, true);
    assert.equal(instance.data.totalSpentText, '50.00');
  });
}

test('已购真实读取成功且为空时清理旧统计并显示正常空状态', async () => {
  const { purchases, requests } = cloudRecords();
  const item = model('hg-001');
  const seeding = purchases.loadPurchases();
  requests[0].success({ statusCode: 200, data: { purchases: [purchase(item.id)] } });
  await seeding;
  const { instance } = page('purchased', { models: [item], purchases });
  assert.equal(instance.data.totalCount, 1);
  assert.equal(instance.data.hasStats, true);
  const showing = instance.onShow();
  requests[1].success({ statusCode: 200, data: { purchases: [] } });
  await showing;
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.loadError, false);
  assert.equal(instance.data.totalCount, 0);
  assert.equal(instance.data.hasStats, false);
  assert.equal(instance.data.totalSpentText, '0.00');
});

test('已购缓存已有记录时刷新失败保留卡片和统计并反馈错误', async () => {
  const { purchases, requests } = cloudRecords();
  const item = model('hg-001');
  const seeding = purchases.loadPurchases();
  requests[0].success({ statusCode: 200, data: { purchases: [purchase(item.id, { priceCny: 120 })] } });
  await seeding;
  const { instance } = page('purchased', { models: [item], purchases });
  await instance.refreshBuildProgress();
  const cachedItems = instance.data.purchaseItems;
  const cachedDimensions = instance.data.radarDimensions;
  const cachedBreakdown = instance.data.seriesBreakdown;
  assert.equal(instance.data.totalCount, 1);
  const showing = instance.onShow();
  assert.equal(instance.data.loading, true);
  assert.equal(instance.data.purchaseItems, cachedItems);
  requests[1].fail({ errMsg: '断网' });
  await showing;
  assert.equal(instance.data.purchaseItems, cachedItems);
  assert.deepEqual(instance.data.radarDimensions, cachedDimensions);
  assert.equal(instance.data.seriesBreakdown, cachedBreakdown);
  assert.equal(instance.data.totalCount, 1);
  assert.equal(instance.data.totalSpentText, '120.00');
  assert.equal(instance.data.hasStats, true);
  assert.equal(instance.data.loadError, true);
  assert.equal(instance.data.loading, false);
});

test('已购页面卸载后忽略迟到的读取结果和重试', async () => {
  const { purchases, requests } = cloudRecords();
  const { instance, updates } = page('purchased', { purchases });
  const showing = instance.onShow();
  instance.onUnload();
  const updateCount = updates.length;
  requests[0].success({ statusCode: 200, data: { purchases: [purchase('hg-001')] } });
  await showing;
  await instance.handleRetry();
  assert.equal(updates.length, updateCount);
  assert.equal(requests.length, 1);
});

test('已购页面卸载后忽略迟到的目录刷新', async () => {
  const refreshing = deferred();
  const started = deferred();
  const { instance, updates } = page('purchased', {
    state: { records: [purchase('hg-001')] },
    modelService: {
      getAllModels: () => [],
      refreshMissingModels() { started.resolve(); return refreshing.promise; },
    },
  });
  const showing = instance.onShow();
  await started.promise;
  instance.onUnload();
  const updateCount = updates.length;
  refreshing.resolve([model('hg-001')]);
  await showing;
  assert.equal(updates.length, updateCount);
});

for (const rejected of [false, true]) {
  test(`心愿单读取${rejected ? '异常' : '失败'}不会误报已购失败，目录失败仍展示占位记录和统计`, async () => {
    const { instance } = page('purchased', {
      state: { records: [purchase('hg-missing')] },
      wishlist: { async loadWishlist() { if (rejected) throw new Error('心愿单读取失败'); return false; } },
      modelService: {
        getAllModels: () => [],
        async refreshMissingModels() { throw new Error('目录读取失败'); },
      },
    });
    await instance.onShow();
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.loadError, false);
    assert.equal(instance.data.totalCount, 1);
    assert.equal(instance.data.purchaseItems[0].model, null);
    assert.equal(instance.data.totalSpentText, '50.00');
    assert.equal(instance.data.hasCompare, false);
  });
}
