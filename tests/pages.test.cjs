const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function model(number, fields = {}) {
  return {
    id: `hg-${number}`, series: 'hg', number, name: `模型 ${number}`, nameJa: '',
    price: number * 100, priceTaxFree: number * 90, releaseDate: '2026-01',
    isLimited: false, imageUrl: '', productUrl: '', ...fields,
  };
}

function models(count) {
  return Array.from({ length: count }, (_, index) => model(count - index));
}

const catalog = loadModule('miniprogram/utils/model-service.ts', {
  mocks: { './cdn-config': { resolveImageUrl: (url) => url }, './api': {} },
}).exports;

function seriesPage({ data = models(1), refresh, wishlist = {}, purchases = {}, state = {} } = {}) {
  state.ids ||= [];
  state.records ||= [];
  const updates = [];
  const toasts = [];
  const timers = new Map();
  let timerId = 0;
  const app = { globalData: { statusBarHeight: 20, safeAreaBottom: 0, exchangeRate: 0.05 } };
  const { definition } = loadModule('miniprogram/pages/series/series.ts', {
    mocks: {
      '../../utils/model-service': {
        ...catalog, getModels: () => data, refreshModels: refresh || (async () => data),
      },
      '../../utils/cloud-favorites': {
        getWishlist: () => state.ids,
        loadWishlist: async () => {},
        isInWishlist: (id) => state.ids.includes(id),
        toggleWishlist: async () => ({ success: true, isFavorite: false }),
        ...wishlist,
      },
      '../../utils/purchase-service': {
        loadPurchases: async () => {},
        getPurchaseRecord: (id) => state.records.find((record) => record.modelId === id),
        isPurchased: (id) => state.records.some((record) => record.modelId === id),
        ...purchases,
      },
    },
    globals: {
      wx: { showToast: (toast) => toasts.push(toast) },
      getApp: () => app,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  const instance = {
    ...definition,
    data: structuredClone(definition.data),
    setData(update) {
      updates.push(structuredClone(update));
      for (const [key, value] of Object.entries(update)) {
        const indexed = /^processedModels\[(\d+)\]$/.exec(key);
        if (indexed) this.data.processedModels[Number(indexed[1])] = structuredClone(value);
        else this.data[key] = structuredClone(value);
      }
    },
  };
  instance.onLoad({ code: 'hg' });
  return { instance, updates, toasts, timers, app, state };
}

const numbers = (items) => Array.from(items, (item) => item.number);
const descending = (from, to) => Array.from({ length: from - to + 1 }, (_, index) => from - index);
const flush = () => new Promise(setImmediate);

for (const existing of [false, true]) {
  for (const outcome of [false, true, 'throw']) {
    test(`系列页${existing ? '编辑' : '新增'}购买 ${outcome} 时保留准确的表单及购买状态`, async () => {
      const writes = [];
      const state = { records: existing ? [{ modelId: 'hg-1' }] : [] };
      async function save(method, id, data) {
        writes.push({ method, id, data });
        if (outcome === 'throw') throw new Error('保存异常');
        if (outcome) state.records = [{ modelId: id, ...data }];
        return outcome;
      }
      const { instance, toasts } = seriesPage({
        state,
        purchases: {
          addPurchase: (data) => save('add', data.modelId, data),
          updatePurchase: (id, data) => save('update', id, data),
        },
      });
      instance.handleModelSelect({ detail: { model: model(1) } });
      instance.handlePurchaseAction({ detail: { id: 'hg-1', name: '模型 1' } });
      const detail = { modelId: 'hg-1', priceCny: null, purchaseDate: null, channel: null, note: '备注' };
      await instance.handleFormSubmit({ detail });

      assert.deepEqual(writes, [{ method: existing ? 'update' : 'add', id: 'hg-1', data: detail }]);
      assert.equal(instance.data.formOpen, outcome !== true);
      assert.equal(instance.data.selectedIsPurchased, existing || outcome === true);
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].icon, outcome === true ? 'success' : 'none');
      assert.match(toasts[0].title, outcome === true ? /保存成功/ : /保存失败/);
    });
  }
}

test('系列页首批只发送 40 条，后续按索引追加，全部结果保持顺序且不存入 data', () => {
  const allModels = models(95);
  const { instance, updates } = seriesPage({ data: allModels });
  assert.equal(instance.data.resultCount, 95);
  assert.deepEqual(numbers(instance.data.processedModels), descending(40, 1).reverse());
  assert.equal(instance._allModels, allModels);
  assert.equal(instance._processedModels.length, 95);
  assert.equal(Object.values(instance.data).some((value) => Array.isArray(value) && value.length === 95), false);
  assert.equal(Object.keys(instance.data).some((key) => /allModels|_processedModels/.test(key)), false);

  updates.length = 0;
  instance.handleLoadMore();
  assert.equal(instance.data.processedModels.length, 80);
  assert.deepEqual(Object.keys(updates[0]), Array.from({ length: 40 }, (_, index) => `processedModels[${40 + index}]`));
  instance.handleLoadMore();
  assert.deepEqual(Object.keys(updates[1]), Array.from({ length: 15 }, (_, index) => `processedModels[${80 + index}]`));
  assert.deepEqual(numbers(instance.data.processedModels), descending(95, 1).reverse());
  instance.handleLoadMore();
  assert.equal(updates.length, 2);
  assert.equal(instance.data.resultCount, 95);
});

for (const mixed of [false, true]) {
  test(`系列页兼容${mixed ? '数字与布尔混合' : '数字0/1'}目录，tab计数、筛选与分页一致`, () => {
    const regular = models(45).map((item, index) => ({ ...item, isLimited: mixed && index % 2 ? false : 0 }));
    const limited = [
      model(101, { isLimited: 1, limitedType: 'event' }),
      model(102, { isLimited: mixed ? true : 1, limitedType: 'event' }),
      model(103, { isLimited: 1, limitedType: 'other' }),
    ];
    const { instance } = seriesPage({ data: regular.concat(limited) });

    assert.equal(instance.data.regularCount, 45);
    assert.equal(instance.data.limitedCount, 3);
    assert.equal(instance.data.resultCount, 45);
    assert.equal(instance.data.processedModels.length, 40);
    instance.handleLoadMore();
    assert.deepEqual(numbers(instance.data.processedModels), descending(45, 1).reverse());

    instance.handleTabChange({ detail: { tab: 'limited' } });
    assert.equal(instance.data.resultCount, 3);
    assert.deepEqual(numbers(instance.data.processedModels), [101, 102, 103]);
    instance.handleLimitedChange({ detail: { value: 'event' } });
    assert.equal(instance.data.resultCount, 2);
    assert.deepEqual(numbers(instance.data.processedModels), [101, 102]);
    instance.handleTabChange({ detail: { tab: 'regular' } });
    assert.equal(instance.data.resultCount, 45);
    assert.equal(instance.data.processedModels.length, 40);
  });
}

test('系列页刷新为真实API键名转换后的数字布尔记录时仍显示卡片', async () => {
  const { toCamelCase } = loadModule('server/src/utils/case-convert.ts').exports;
  const refresh = deferred();
  const { instance } = seriesPage({ data: models(2), refresh: () => refresh.promise });
  const rows = models(45).concat(model(101, { isLimited: true, limitedType: 'event' }));
  const response = rows.map(({ isLimited, ...row }) => toCamelCase({ ...row, is_limited: Number(isLimited) }));
  assert.equal(response[0].isLimited, 0);
  assert.equal(response.at(-1).isLimited, 1);

  refresh.resolve(response);
  await flush();
  assert.equal(instance.data.regularCount, 45);
  assert.equal(instance.data.resultCount, 45);
  assert.equal(instance.data.processedModels.length, 40);
  instance.handleTabChange({ detail: { tab: 'limited' } });
  assert.equal(instance.data.limitedCount, 1);
  assert.equal(instance.data.resultCount, 1);
  assert.deepEqual(numbers(instance.data.processedModels), [101]);
});

test('筛选、排序及重置均重置首批，后续追加覆盖完整筛选结果', () => {
  const { instance } = seriesPage({ data: models(95) });
  instance.handleLoadMore();
  instance.handleFilterChange({ detail: { field: 'numberFrom', value: '11' } });
  assert.equal(instance.data.processedModels.length, 40);
  assert.equal(instance.data.resultCount, 85);
  instance.handleFilterChange({ detail: { field: 'numberTo', value: '90' } });
  instance.handleSortChange({ detail: { value: 'number-desc' } });
  assert.equal(instance.data.resultCount, 80);
  assert.deepEqual(numbers(instance.data.processedModels), descending(90, 51));
  instance.handleLoadMore();
  assert.deepEqual(numbers(instance.data.processedModels), descending(90, 11));
  instance.handleFilterReset();
  assert.equal(instance.data.resultCount, 95);
  assert.deepEqual(numbers(instance.data.processedModels), descending(95, 56));
});

test('搜索防抖使用真实筛选，卸载时清理计时器', () => {
  const { instance, timers, updates } = seriesPage({ data: models(95) });
  instance.handleSearchInput({ detail: { value: '模型 1' } });
  instance.handleSearchInput({ detail: { value: '模型 9' } });
  assert.equal(timers.size, 1);
  const search = Array.from(timers.values())[0];
  search();
  assert.deepEqual(numbers(instance.data.processedModels), [9, 90, 91, 92, 93, 94, 95]);
  assert.equal(instance.data.resultCount, 7);
  instance.handleSearchInput({ detail: { value: '模型 2' } });
  const lateSearch = Array.from(timers.values()).at(-1);
  instance.onUnload();
  const updateCount = updates.length;
  lateSearch();
  assert.equal(updates.length, updateCount);
  assert.equal(instance.data.debouncedKeyword, '模型 9');
  assert.equal(timers.has(instance._debounceTimer), false);
});

test('系列页 onShow 等待心愿单和购买加载后才刷新选中状态及汇率', async () => {
  const wishlist = deferred();
  const purchases = deferred();
  const state = {};
  const { instance, updates, app } = seriesPage({
    state,
    wishlist: { loadWishlist: () => wishlist.promise },
    purchases: { loadPurchases: () => purchases.promise },
  });
  instance.handleModelSelect({ detail: { model: model(1) } });
  const beforeShow = updates.length;
  const showing = instance.onShow();
  state.ids = ['hg-1'];
  state.records = [{ modelId: 'hg-1' }];
  app.globalData.exchangeRate = 0.06;
  wishlist.resolve();
  await flush();
  assert.equal(updates.length, beforeShow);
  purchases.resolve();
  await showing;
  assert.equal(instance.data.favMap['hg-1'], true);
  assert.equal(instance.data.selectedIsFav, true);
  assert.equal(instance.data.selectedIsPurchased, true);
  assert.equal(instance.data.exchangeRate, 0.06);
});

test('服务刷新有新数组时更新计数，并重新从首批展示', async () => {
  const refresh = deferred();
  const { instance } = seriesPage({ data: models(95), refresh: () => refresh.promise });
  instance.handleLoadMore();
  const updated = models(51).concat(model(100, { isLimited: true, limitedType: 'event' }));
  refresh.resolve(updated);
  await flush();
  assert.equal(instance._allModels, updated);
  assert.equal(instance.data.regularCount, 51);
  assert.equal(instance.data.limitedCount, 1);
  assert.equal(instance.data.resultCount, 51);
  assert.deepEqual(numbers(instance.data.processedModels), descending(40, 1).reverse());
});

for (const empty of [false, true]) {
  test(`服务刷新返回${empty ? '空结果' : '相同缓存引用'}时不重绘已加载列表`, async () => {
    const refresh = deferred();
    const data = models(95);
    const { instance, updates } = seriesPage({ data, refresh: () => refresh.promise });
    instance.handleLoadMore();
    const updateCount = updates.length;
    refresh.resolve(empty ? [] : data);
    await flush();
    assert.equal(updates.length, updateCount);
    assert.equal(instance.data.processedModels.length, 80);
    assert.equal(instance._allModels, data);
  });
}

test('卸载后的目录刷新及 onShow 加载完成都不回写页面', async () => {
  const refresh = deferred();
  const wishlist = deferred();
  const data = models(45);
  const { instance, updates } = seriesPage({
    data, refresh: () => refresh.promise, wishlist: { loadWishlist: () => wishlist.promise },
  });
  const showing = instance.onShow();
  instance.onUnload();
  const updateCount = updates.length;
  refresh.resolve(models(2));
  wishlist.resolve();
  await showing;
  await flush();
  assert.equal(updates.length, updateCount);
  assert.equal(instance._allModels, data);
  assert.equal(instance.data.resultCount, 45);
});

test('限定分类计数覆盖全量目录，组件按计数禁用空分类，切换后重置子分类', () => {
  const data = [
    ...models(45),
    model(101, { isLimited: true, limitedType: 'pbandai' }),
    model(102, { isLimited: true, limitedType: 'pbandai' }),
    model(103, { isLimited: true, limitedType: 'gbase' }),
    model(104, { isLimited: true }),
    model(105, { isLimited: true, limitedType: 'other' }),
  ];
  const { instance } = seriesPage({ data });
  assert.equal(instance.data.regularCount, 45);
  assert.equal(instance.data.limitedCount, 5);
  assert.deepEqual(instance.data.limitedCounts, { all: 5, pbandai: 2, gbase: 1, other: 2 });
  const definition = loadModule('miniprogram/components/limited-filter/limited-filter.ts').definition;
  const component = {
    data: structuredClone(definition.data),
    events: [],
    setData(update) { Object.assign(this.data, update); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); },
    ...definition.methods,
  };
  definition.observers.counts.call(component, instance.data.limitedCounts);
  assert.deepEqual(Array.from(component.data.filters, ({ key, count, disabled }) => ({ key, count, disabled })), [
    { key: 'all', count: 5, disabled: false },
    { key: 'pbandai', count: 2, disabled: false },
    { key: 'gbase', count: 1, disabled: false },
    { key: 'event', count: 0, disabled: true },
    { key: 'sidef', count: 0, disabled: true },
    { key: 'other', count: 2, disabled: false },
  ]);
  component.handleTap({ currentTarget: { dataset: { key: 'event' } } });
  assert.equal(component.events.length, 0);
  component.handleTap({ currentTarget: { dataset: { key: 'pbandai' } } });
  assert.equal(component.events[0].detail.value, 'pbandai');
  instance.handleTabChange({ detail: { tab: 'limited' } });
  instance.handleLimitedChange({ detail: component.events[0].detail });
  assert.deepEqual(numbers(instance.data.processedModels), [101, 102]);
  instance.handleLimitedChange({ detail: { value: 'other' } });
  assert.deepEqual(numbers(instance.data.processedModels), [104, 105]);
  instance.handleTabChange({ detail: { tab: 'regular' } });
  instance.handleTabChange({ detail: { tab: 'limited' } });
  assert.equal(instance.data.limitedSubFilter, 'all');
  assert.equal(instance.data.resultCount, 5);
});
