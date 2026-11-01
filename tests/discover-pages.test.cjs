const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');
const { enabledFeatures } = require('./helpers/enabled-features.cjs');

const lineages = loadModule('miniprogram/data/lineages.ts').exports;
const discovery = loadModule('miniprogram/utils/discovery.ts', { mocks: { '../data/lineages': lineages } }).exports;
const flush = () => new Promise(setImmediate);
const event = (id) => ({ currentTarget: { dataset: { id } } });
function model(id, fields = {}) {
  return { id, series: id.split('-')[0], number: Number(id.split('-')[1]), name: `模型 ${id}`, nameJa: '',
    releaseDate: '2026-01', price: 2000, priceTaxFree: 1800, imageUrl: '', productUrl: '', isLimited: false, ...fields };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function page({ models = [model('rg-001'), model('mg-002'), model('pg-003')], query = {}, refresh, modelService, share, purchases, state = {} } = {}) {
  state.purchases ||= [];
  const calls = { navigation: [], toasts: [], shares: [], updates: [], copied: [] };
  const { definition } = loadModule('miniprogram/pages/discover/discover.ts', {
    mocks: {
      ...enabledFeatures().mocks,
      '../../utils/model-service': modelService || {
        getAllModels: () => models,
        refreshModelsWithStatus: async (code) => ({ models: refresh ? await refresh(code) : models.filter((item) => item.series === code), refreshed: true }),
      },
      '../../utils/purchase-service': { getPurchases: () => state.purchases, loadPurchases: purchases || (async () => true) },
      '../../utils/hangar-service': { createShare: async (payload) => { calls.shares.push(structuredClone(payload)); return share ? share(payload) : { id: 'snapshot-1' }; } },
      '../../utils/discovery': discovery,
      '../../data/lineages': lineages,
    },
    globals: { wx: {
      navigateTo: (options) => calls.navigation.push(options.url),
      navigateBack() {}, switchTab() {},
      showToast: (options) => calls.toasts.push(options.title),
      setClipboardData: (options) => calls.copied.push(options.data),
    } },
  });
  const instance = { ...definition, data: structuredClone(definition.data), catalog: [],
    setData(update) { calls.updates.push(structuredClone(update)); Object.assign(this.data, structuredClone(update)); },
  };
  instance.onLoad(query);
  return { instance, calls, state };
}
const ids = (items) => Array.from(items, (item) => item.id);

test('发现页本地即时显示，后台刷新按当前关键词而非旧查询呈现', async () => {
  const request = deferred();
  const { instance } = page({ models: [model('rg-001', { name: '旧模型' })], query: { keyword: '旧' }, refresh: (code) => code === 'rg' ? request.promise : Promise.resolve([]) });
  assert.deepEqual(ids(instance.data.models), ['rg-001']);
  instance.handleKeywordInput({ detail: { value: '新' } });
  assert.equal(instance.data.total, 0);
  request.resolve([model('rg-002', { name: '新模型' })]);
  await flush();
  assert.equal(instance.data.keyword, '新');
  assert.deepEqual(ids(instance.data.models), ['rg-002']);
});


test('较早的目录刷新晚到不覆盖新一轮刷新，离开页面后不更新', async () => {
  const old = deferred();
  const newer = deferred();
  let reads = 0;
  const { instance, calls } = page({ models: [model('rg-001')], refresh: (code) => code === 'rg' ? (++reads === 1 ? old.promise : newer.promise) : Promise.resolve([]) });
  const refreshing = instance.refreshCatalog();
  newer.resolve([model('rg-002')]);
  await refreshing;
  old.resolve([model('rg-003')]);
  await flush();
  assert.deepEqual(ids(instance.data.models), ['rg-002']);
  const pending = deferred();
  const other = page({ refresh: () => pending.promise });
  other.instance.onUnload();
  const count = other.calls.updates.length;
  pending.resolve([model('hg-999')]);
  await flush();
  assert.equal(other.calls.updates.length, count);
  assert.ok(calls.updates.length > 0);
});

test('无效模式与损坏转义安全回退，搜索结果按40台增量显示', async () => {
  const models = Array.from({ length: 85 }, (_, i) => model(`hg-${i}`));
  const { instance } = page({ models, query: { mode: 'bad', keyword: '%' } });
  assert.equal(instance.data.mode, 'search');
  assert.ok(instance.data.modeNotice);
  assert.equal(instance.data.keyword, '%');
  instance.handleKeywordInput({ detail: { value: '' } });
  assert.equal(instance.data.models.length, 40);
  instance.handleLoadMore();
  assert.equal(instance.data.models.length, 80);
  instance.handleLoadMore();
  assert.equal(instance.data.models.length, 85);
  await flush();
});

test('近期目录展示日期降序并导航到编码后的模型ID', async () => {
  const { instance, calls } = page({ query: { mode: 'new' }, models: [model('rg-001', { releaseDate: '2025-01' }), model('mg-002', { releaseDate: '2027-01' })] });
  assert.deepEqual(ids(instance.data.models), ['mg-002', 'rg-001']);
  instance.handleModel(event('mg-002'));
  assert.equal(calls.navigation[0], '/pages/model/model?id=mg-002');
  instance.handleModel(event('不存在'));
  assert.equal(calls.navigation.length, 1);
  await flush();
});

test('谱系显式切换关系，失败不会把未知入手进度当零', async () => {
  let success = false;
  const { instance, state, calls } = page({ query: { mode: 'lineage' }, models: [model('rg-001'), model('rg-032'), model('rg-036')], purchases: async () => success });
  instance.onShow();
  await flush();
  assert.equal(instance.data.purchasesError, true);
  assert.equal(instance.data.lineage.progressText, '待同步 / 1');
  instance.handleLineage(event('nu'));
  assert.equal(instance.data.lineage.total, 2);
  success = true;
  state.purchases = [{ modelId: 'rg-036' }];
  await instance.refreshPurchases();
  assert.equal(instance.data.lineage.progressText, '1 / 2');
  success = false;
  await instance.refreshPurchases();
  assert.equal(instance.data.purchasesError, true);
  assert.equal(instance.data.lineage.progressText, '1 / 2');
  instance.handleSource({ currentTarget: { dataset: { url: lineages.LINEAGES[1].entries[0].productUrl } } });
  assert.equal(calls.copied[0], 'https://bandai-hobby.net/item/01_2343/');
});

test('成功的空入手记录显示0且只计入当前映射目录', async () => {
  const { instance } = page({ query: { mode: 'lineage' }, models: [model('rg-001')] });
  await instance.refreshPurchases();
  assert.equal(instance.data.purchasesKnown, true);
  assert.equal(instance.data.lineage.progressText, '0 / 1');
  assert.equal(instance.data.lineage.entries[1].status, '目录未收录');
});

test('对比只选两台，拒绝第三台，选中状态不受搜索结果影响', async () => {
  const { instance, calls } = page({ query: { mode: 'compare' } });
  instance.handleSelectModel(event('rg-001'));
  instance.handleSelectModel(event('mg-002'));
  instance.handleSelectModel(event('pg-003'));
  assert.deepEqual(Array.from(instance.data.selectedIds), ['rg-001', 'mg-002']);
  assert.equal(calls.toasts.length, 1);
  assert.equal(instance.data.comparisonRows.length, 5);
  instance.handleKeywordInput({ detail: { value: '不存在' } });
  assert.equal(instance.data.total, 0);
  assert.equal(instance.data.selectedModels.length, 2);
  instance.handleSelectModel(event('rg-001'));
  assert.deepEqual(Array.from(instance.data.selectedIds), ['mg-002']);
  assert.equal(instance.data.comparisonRows.length, 0);
  await flush();
});

test('生成对比快照完成前不暴露分享链接，选择变化使旧ID失效', async () => {
  const request = deferred();
  const { instance, calls } = page({ query: { mode: 'compare' }, share: () => request.promise });
  await instance.handlePrepareShare();
  assert.equal(calls.shares.length, 0);
  instance.handleSelectModel(event('rg-001'));
  instance.handleSelectModel(event('mg-002'));
  const saving = instance.handlePrepareShare();
  assert.equal(instance.data.generatingShare, true);
  assert.equal(instance.onShareAppMessage().path, '/pages/home/home');
  request.resolve({ id: 'card/one' });
  await saving;
  assert.equal(instance.onShareAppMessage().path, '/pages/share/share?id=card%2Fone');
  assert.deepEqual(calls.shares[0], { kind: 'compare', title: '我的下一台出击', modelIds: ['rg-001', 'mg-002'] });
  instance.handleSelectModel(event('mg-002'));
  assert.equal(instance.data.shareId, '');
  assert.equal(instance.onShareAppMessage().path, '/pages/home/home');
});

test('分享生成途中更换选择，旧响应不能替换新对比快照', async () => {
  const first = deferred();
  const second = deferred();
  let writes = 0;
  const { instance } = page({ query: { mode: 'compare' }, share: () => ++writes === 1 ? first.promise : second.promise });
  instance.handleSelectModel(event('rg-001'));
  instance.handleSelectModel(event('mg-002'));
  const old = instance.handlePrepareShare();
  instance.handleSelectModel(event('mg-002'));
  instance.handleSelectModel(event('pg-003'));
  const current = instance.handlePrepareShare();
  second.resolve({ id: 'new-card' });
  await current;
  first.resolve({ id: 'old-card' });
  await old;
  assert.equal(instance.data.shareId, 'new-card');
  assert.equal(instance.onShareAppMessage().path, '/pages/share/share?id=new-card');
});

test('生成对比卡失败可重试，重复点击进行中的请求只创建一次', async () => {
  let fail = true;
  const { instance, calls } = page({ query: { mode: 'compare' }, share: async () => { if (fail) throw new Error('离线'); return { id: 'retry-card' }; } });
  instance.handleSelectModel(event('rg-001'));
  instance.handleSelectModel(event('mg-002'));
  const saving = instance.handlePrepareShare();
  await instance.handlePrepareShare();
  await saving;
  assert.equal(calls.shares.length, 1);
  assert.ok(instance.data.shareError);
  assert.equal(instance.data.shareId, '');
  fail = false;
  await instance.handlePrepareShare();
  assert.equal(instance.data.shareId, 'retry-card');
  assert.equal(instance.data.shareError, '');
});

test('首页保留等级轮播并将搜索、近期、玩法导航到对应页面', async () => {
  const navigation = [];
  const { definition } = loadModule('miniprogram/pages/home/home.ts', {
    mocks: {
      ...enabledFeatures().mocks,
      '../../utils/model-service': {
        getSeriesMeta: () => ['hg', 'rg', 'mg', 'pg'].map((code) => ({ code })), refreshSeriesMeta: async () => [],
        getAllModels: () => [model('rg-001')], refreshModels: async () => [],
      },
      '../../utils/favorites': { migrateFavoritesIfNeeded() {} }, '../../utils/discovery': discovery,
    },
    globals: { getApp: () => ({ globalData: { statusBarHeight: 20 } }), wx: { navigateTo: ({ url }) => navigation.push(url) } },
  });
  const instance = { ...definition, data: structuredClone(definition.data), setData(update) { Object.assign(this.data, structuredClone(update)); } };
  instance.onLoad();
  assert.deepEqual(Array.from(instance.data.series, (item) => item.code), ['hg', 'rg', 'mg', 'pg']);
  assert.equal(instance.data.recent.length, 1);
  instance.handleKeywordInput({ detail: { value: 'ν & RX' } });
  instance.handleSearch();
  assert.equal(navigation[0], '/pages/discover/discover?mode=search&keyword=%CE%BD%20%26%20RX');
  for (const entry of ['new', 'lineage', 'compare', 'squad', 'quiz', 'builds']) instance.handleEntry({ currentTarget: { dataset: { entry } } });
  assert.deepEqual(navigation.slice(1), ['/pages/discover/discover?mode=new', '/pages/discover/discover?mode=lineage', '/pages/discover/discover?mode=compare', '/pages/squad/squad', '/pages/quiz/quiz', '/pages/builds/builds']);
  instance.handleSwiperChange({ detail: { current: 2 } });
  assert.equal(instance.data.activeIndex, 2);
  for (const index of [undefined, -1, 99, 'invalid']) instance.scrollToIndex({ currentTarget: { dataset: { index } } });
  assert.equal(instance.data.activeIndex, 2);
  instance.scrollToIndex({ currentTarget: { dataset: { index: '1' } } });
  assert.equal(instance.data.activeIndex, 1);
  const count = navigation.length;
  for (const entry of ['constructor', '__proto__', 'missing', undefined]) instance.handleEntry({ currentTarget: { dataset: { entry } } });
  instance.handleModel(event(undefined));
  assert.equal(navigation.length, count);
  await flush();
});


test('切换发现模式清空对比快照，并使旧生成请求失效', async () => {
  const request = deferred();
  const { instance } = page({ query: { mode: 'compare' }, share: () => request.promise });
  instance.handleSelectModel(event('rg-001'));
  instance.handleSelectModel(event('mg-002'));
  const saving = instance.handlePrepareShare();
  instance.onLoad({ mode: 'search' });
  request.resolve({ id: 'stale-card' });
  await saving;
  assert.equal(instance.data.mode, 'search');
  assert.equal(instance.data.selectedIds.length, 0);
  assert.equal(instance.data.shareId, '');
  assert.equal(instance.data.generatingShare, false);
  assert.equal(instance.onShareAppMessage().path, '/pages/home/home');
});

// 使用真实目录 service，仅替换网络和微信存储边界，覆盖其吞错降级路径。
function realCatalog({ local = [], cached = [], cachedAt = Date.now(), callAPI }) {
  const storage = new Map();
  for (const code of ['hg', 'rg', 'mg', 'pg']) {
    const data = cached.filter((item) => item.series === code);
    if (data.length) storage.set(`gundam-cache-models-${code}`, { data, version: 'cached', timestamp: cachedAt });
  }
  const { exports: service } = loadModule('miniprogram/utils/model-service.ts', {
    mocks: {
      './api': { callAPI },
      './cdn-config': { resolveImageUrl: (url) => url },
    },
    globals: {
      console: { error() {} },
      wx: {
        getStorageSync: (key) => storage.get(key),
        setStorageSync: (key, value) => storage.set(key, value),
        getFileSystemManager: () => ({
          readFileSync: (path) => JSON.stringify(local.filter((item) => path === `/data/${item.series}.json`)),
        }),
      },
    },
  });
  return { service, storage };
}

test('发现页命中新鲜云端目录缓存时不请求，也不误报刷新失败', async () => {
  const requests = [];
  const cached = ['hg', 'rg', 'mg', 'pg'].map((code) => model(`${code}-001`));
  const { service } = realCatalog({ cached, async callAPI({ path }) {
    requests.push(path);
    throw new Error('不应请求');
  } });
  const { instance } = page({ modelService: service });
  await flush();
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.refreshError, false);
  assert.deepEqual(ids(instance.data.models).sort(), ids(cached).sort());
  await instance.refreshCatalog();
  assert.equal(instance.data.refreshError, false);
  assert.deepEqual(requests, []);
});

for (const source of ['cached', 'local', 'empty']) {
  test(`真实目录service断网时${source}降级仍报告刷新失败，保留结果且支持重试`, async () => {
    let offline = true;
    const requests = [];
    const old = model('rg-001');
    const { service } = realCatalog({
      cached: source === 'cached' ? [old] : [],
      cachedAt: Date.now() - 4 * 60 * 60 * 1000,
      local: source === 'local' ? [old] : [],
      async callAPI({ path }) {
        requests.push(path);
        if (offline) throw new Error('网络断开');
        return { data: [model(`${path.split('/').pop()}-002`)], version: 'fresh' };
      },
    });
    const { instance } = page({ modelService: service });
    assert.deepEqual(ids(instance.data.models), source === 'empty' ? [] : ['rg-001']);
    await flush();
    assert.equal(instance.data.refreshing, false);
    assert.equal(instance.data.refreshError, true);
    assert.deepEqual(ids(instance.data.models), source === 'empty' ? [] : ['rg-001']);
    assert.equal(requests.length, 4);
    offline = false;
    await instance.refreshCatalog();
    assert.equal(instance.data.refreshError, false);
    assert.deepEqual(ids(instance.data.models).sort(), ['hg-002', 'mg-002', 'pg-002', 'rg-002']);
    assert.equal(requests.length, 8);
  });
}

test('真实目录service部分等级刷新失败时保留该等级缓存，同时展示成功更新的等级', async () => {
  const { service } = realCatalog({ local: [model('rg-001')], async callAPI({ path }) {
    const code = path.split('/').pop();
    if (code === 'rg') throw new Error('RG 请求失败');
    return { data: [model(`${code}-002`)], version: 'fresh' };
  } });
  const { instance } = page({ modelService: service });
  await flush();
  assert.equal(instance.data.refreshError, true);
  assert.deepEqual(ids(instance.data.models).sort(), ['hg-002', 'mg-002', 'pg-002', 'rg-001']);
});

test('带状态刷新返回缓存时refreshed为false，旧refreshModels仍返回数组并在恢复后更新缓存', async () => {
  let offline = true;
  const { service, storage } = realCatalog({ local: [model('rg-001')], async callAPI() {
    if (offline) throw new Error('网络断开');
    return { data: [model('rg-002')], version: 'v2' };
  } });
  const failed = await service.refreshModelsWithStatus('rg');
  assert.equal(failed.refreshed, false);
  assert.deepEqual(ids(failed.models), ['rg-001']);
  assert.deepEqual(ids(await service.refreshModels('rg')), ['rg-001']);
  offline = false;
  const success = await service.refreshModelsWithStatus('rg');
  assert.equal(success.refreshed, true);
  assert.deepEqual(ids(success.models), ['rg-002']);
  assert.deepEqual(ids(service.getModels('rg')), ['rg-002']);
  assert.equal(storage.get('gundam-cache-models-rg').version, 'v2');
  offline = true;
  assert.deepEqual(ids(await service.refreshModels('rg')), ['rg-002']);
});

test('目录API空响应保留已有目录并标记未刷新，旧方法降级契约保持', async () => {
  const { service } = realCatalog({ local: [model('rg-001')], callAPI: async () => ({ data: [], version: 'empty' }) });
  const result = await service.refreshModelsWithStatus('rg');
  assert.equal(result.refreshed, false);
  assert.deepEqual(ids(result.models), ['rg-001']);
  assert.deepEqual(ids(await service.refreshModels('rg')), ['rg-001']);
  const empty = await service.refreshModelsWithStatus('mg');
  assert.equal(empty.refreshed, false);
  assert.deepEqual(ids(empty.models), []);
});
