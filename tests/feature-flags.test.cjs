const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const keys = ['discovery', 'sharing', 'squad', 'quiz', 'builds', 'lineage', 'compare', 'pilotRating'];
const closed = Object.fromEntries(keys.map((key) => [key, false]));
const all = Object.fromEntries(keys.map((key) => [key, true]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);
const event = (id) => ({ currentTarget: { dataset: { id } } });
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const catalog = ['hg-001', 'rg-002', 'mg-003'].map((id, i) => ({ id, series: id.slice(0, 2), number: i + 1, name: id, nameJa: id, releaseDate: '2026-01', price: 2000, priceTaxFree: 1800, imageUrl: '/model.jpg', productUrl: '', isLimited: false }));
const record = { modelId: 'hg-001', quantity: 3, completedCount: 1, buildingCount: 1, goal: '完成手臂', goalDoneDate: null };

function environment() {
  const calls = [];
  const navigation = [];
  const toasts = [];
  const menus = [];
  const storage = new Map();
  const reads = { catalog: 0, refresh: 0, purchases: 0, draft: 0 };
  let featureResponse = { version: 1, features: closed };
  let handlers = {};
  let activePage;
  const wx = {
    hideShareMenu: () => menus.push('hide'), showShareMenu: () => menus.push('show'),
    navigateTo: (value) => navigation.push(value.url), switchTab: (value) => navigation.push(value.url), navigateBack() {},
    showToast: (value) => toasts.push(value.title), nextTick() {},
    getStorageSync(key) { reads.draft++; return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, plain(value)); },
  };
  const flags = loadModule('miniprogram/utils/feature-flags.ts', {
    mocks: { './api': { async callAPI(options) {
      calls.push(options);
      if (options.path === '/api/features') return typeof featureResponse === 'function' ? featureResponse() : featureResponse;
      if (handlers[options.path]) return handlers[options.path](options);
      throw new Error(`unexpected ${options.path}`);
    } } },
  }).exports;
  const pageFeatures = loadModule('miniprogram/utils/feature-page.ts', { mocks: { './feature-flags': flags }, globals: { wx, getCurrentPages: () => activePage ? [activePage] : [] } }).exports;
  const service = loadModule('miniprogram/utils/hangar-service.ts', {
    mocks: {
      './feature-flags': flags, './cdn-config': { resolveImageUrl: (url) => url },
      './api': { async callAPI(options) { calls.push(options); if (handlers[options.path]) return handlers[options.path](options); throw new Error(`unexpected ${options.path}`); } },
    },
  }).exports;
  const lineages = loadModule('miniprogram/data/lineages.ts').exports;
  const discovery = loadModule('miniprogram/utils/discovery.ts', { mocks: { '../data/lineages': lineages } }).exports;
  const drafts = loadModule('miniprogram/utils/squad-draft.ts', { globals: { wx } }).exports;
  function page(name, extra = {}) {
    const { definition } = loadModule(`miniprogram/pages/${name}/${name}.ts`, {
      mocks: {
        '../../utils/feature-flags': flags, '../../utils/feature-page': pageFeatures,
        '../../utils/hangar-service': service,
        '../../utils/model-service': {
          getAllModels() { reads.catalog++; return catalog; }, getSeriesMeta: () => [{ code: 'hg' }], refreshSeriesMeta: async () => [{ code: 'hg' }],
          refreshModels: async () => { reads.refresh++; return catalog; },
          refreshModelsWithStatus: async () => { reads.refresh++; return { models: catalog, refreshed: true }; },
          refreshMissingModels: async () => { reads.refresh++; return catalog; },
        },
        '../../utils/purchase-service': {
          getPurchases: () => [{ modelId: 'hg-001', priceCny: 99, createdAt: '2026-01-01', purchaseDate: null, note: null }],
          async loadPurchases() { reads.purchases++; return true; },
        },
        '../../utils/cloud-favorites': { getWishlist: () => [], loadWishlist: async () => true },
        '../../utils/favorites': { migrateFavoritesIfNeeded() {} },
        '../../utils/discovery': discovery, '../../data/lineages': lineages,
        '../../utils/squad-draft': drafts, '../../utils/hangar-poster': { generateSquadPoster: async () => '/poster.png' },
        '../../utils/build-summary': loadModule('miniprogram/utils/build-summary.ts').exports,
        '../../utils/pilot-progress': loadModule('miniprogram/utils/pilot-progress.ts').exports,
        '../../utils/user-service': { getUserInfo: () => null }, '../../utils/api': {}, ...extra,
      },
      globals: { wx, getApp: () => ({ globalData: { windowWidth: 375, statusBarHeight: 20, safeAreaBottom: 12 }, loadUserInfo: async () => {} }) },
    });
    return { ...definition, data: structuredClone(definition.data), setData(update) { Object.assign(this.data, structuredClone(update)); } };
  }
  return {
    flags, service, page, wx, calls, reads, storage, navigation, toasts, menus,
    active(page) { activePage = page; },
    respond(value) { featureResponse = value; }, handlers(value) { handlers = value; },
    async enable(value) { featureResponse = { version: 1, features: { ...closed, ...value } }; await flags.refreshFeatures(); await flush(); },
  };
}

test('真实开关模块冷启动全关、并发合并，刷新确认前立即撤销旧开启值', async () => {
  const current = environment();
  const snapshots = [];
  const unsubscribe = current.flags.subscribeFeatures((value) => snapshots.push(plain(value)));
  assert.deepEqual(plain(current.flags.getFeatures()), closed);
  await current.enable(all);
  const pending = deferred();
  current.respond(() => pending.promise);
  const first = current.flags.refreshFeatures();
  assert.equal(current.flags.refreshFeatures(), first);
  assert.deepEqual(plain(current.flags.getFeatures()), closed);
  assert.equal(current.calls.filter((call) => call.path === '/api/features').length, 2);
  pending.reject(new Error('network unavailable'));
  assert.deepEqual(plain(await first), closed);
  assert.deepEqual(snapshots.at(-1), closed);
  unsubscribe();
});

test('真实API的401、404和网络失败均关闭全部功能，不保留之前启用状态', async () => {
  for (const status of [401, 404, 'network']) {
    let result = 200;
    const api = loadModule('miniprogram/utils/api.ts', { globals: { wx: {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      cloud: { init() {}, callContainer(options) {
        if (result === 'network') options.fail({ errMsg: 'offline' });
        else options.success({ statusCode: result, data: result === 200 ? { version: 1, features: all } : { error: 'missing' } });
      } },
    } } }).exports;
    const flags = loadModule('miniprogram/utils/feature-flags.ts', { mocks: { './api': api } }).exports;
    await flags.refreshFeatures();
    assert.equal(flags.isFeatureEnabled('builds'), true);
    result = status;
    assert.deepEqual(plain(await flags.refreshFeatures()), closed);
  }
});

test('版本、缺项、字符串布尔值等协议错误安全关闭，合法额外字段不进入客户端开关对象', async () => {
  const current = environment();
  for (const value of [null, {}, { version: 2, features: all }, { version: 1, features: { ...all, quiz: 'true' } }, { version: 1, features: { discovery: true } }]) {
    await current.enable(all);
    current.respond(value);
    assert.deepEqual(plain(await current.flags.refreshFeatures()), closed);
  }
  current.respond({ version: 1, features: { ...all, other: true } });
  assert.deepEqual(plain(await current.flags.refreshFeatures()), all);
});

test('关闭状态的旧backend直达玩法页不读取目录、草稿、分享和进度，不显示同步失败', async () => {
  const current = environment();
  current.storage.set('gundam-squad-draft', { version: 1, title: '旧编队', modelIds: ['hg-001'], captainId: 'hg-001' });
  for (const name of ['squad', 'quiz', 'share']) {
    const page = current.page(name);
    await page.onLoad({ id: 'old-share', shareId: 'old-share' });
    assert.equal(page.data.featureEnabled, false, name);
    assert.equal(page.data.loadError || '', '', name);
    page.onUnload();
  }
  for (const mode of ['search', 'new', 'lineage', 'compare']) {
    const page = current.page('discover');
    page.onLoad({ mode });
    page.onShow();
    assert.equal(page.data.featureEnabled, false, mode);
    page.onUnload();
  }
  const builds = current.page('builds');
  await builds.onShow();
  await builds.loadData();
  assert.equal(builds.data.featureEnabled, false);
  assert.equal(builds.data.error, '');
  assert.equal(builds.data.loading, false);
  assert.deepEqual(current.calls, []);
  assert.deepEqual(current.reads, { catalog: 0, refresh: 0, purchases: 0, draft: 0 });
});

test('首页保留等级入口，各新入口独立授权；发现关闭时不扫描或刷新全目录', async () => {
  const current = environment();
  const home = current.page('home');
  home.onLoad();
  home.handleSearch();
  home.handleEntry({ currentTarget: { dataset: { entry: 'builds' } } });
  assert.equal(home.data.series.length, 1);
  assert.equal(current.reads.catalog, 0);
  assert.equal(current.reads.refresh, 0);
  assert.deepEqual(current.navigation, []);
  await current.enable({ lineage: true, compare: true });
  for (const entry of ['lineage', 'compare', 'new', 'squad', 'quiz', 'builds']) home.handleEntry({ currentTarget: { dataset: { entry } } });
  assert.deepEqual(current.navigation, ['/pages/discover/discover?mode=lineage', '/pages/discover/discover?mode=compare']);
  assert.equal(current.reads.catalog, 0);
  await current.enable({ discovery: true });
  assert.equal(current.reads.catalog, 1);
  assert.equal(current.reads.refresh, 4);
  home.onUnload();
});

for (const mode of ['lineage', 'compare']) {
  test(`${mode}可在discovery关闭时独立使用，驻留页面关闭后禁止事件与后续刷新`, async () => {
    const current = environment();
    await current.enable({ [mode]: true });
    const page = current.page('discover');
    page.onLoad({ mode });
    await flush();
    assert.equal(page.data.featureEnabled, true);
    const reads = current.reads.refresh;
    await current.enable({ discovery: true });
    assert.equal(page.data.featureEnabled, false);
    page.handleModel(event('hg-001'));
    await page.refreshCatalog();
    assert.equal(current.reads.refresh, reads);
    assert.deepEqual(current.navigation, []);
    page.onUnload();
  });
}

test('服务层分享按kind的玩法开关守卫，关闭快照分享保留原始目录分享', async () => {
  const current = environment();
  current.handlers({ '/api/shares': () => ({ id: 'created' }), '/api/shares/old': () => ({ kind: 'squad', title: '旧编队', models: catalog }) });
  await current.enable({ sharing: true });
  for (const kind of ['squad', 'quiz', 'compare', 'report']) await assert.rejects(current.service.createShare({ kind, title: '测试', modelIds: ['hg-001'] }), /功能暂未开放/);
  await current.service.createShare({ kind: 'wishlist', title: '测试', modelIds: ['hg-001'] });
  await current.service.createShare({ kind: 'purchased', title: '测试', modelIds: ['hg-001'] });
  await assert.rejects(current.service.getShare('old'), /功能暂未开放/);
  const page = current.page('share');
  await page.onLoad({ id: 'old' });
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.loadError, '');
  assert.equal(page.onShareAppMessage().path, '/pages/home/home');
  await current.enable({});
  const count = current.calls.length;
  await assert.rejects(current.service.getShare('old'), /功能暂未开放/);
  assert.equal(current.calls.length, count);
});

test('驻留六机编队关闭不删草稿或编辑，迟到分享回包无法恢复按钮，恢复后保留当前编辑', async () => {
  const current = environment();
  await current.enable({ squad: true, sharing: true });
  const page = current.page('squad');
  await page.onLoad({});
  page.handleSelection({ detail: { ids: ['hg-001'], models: [catalog[0]] } });
  page.handleTitle({ detail: { value: '进行中的编队' } });
  const saved = plain([...current.storage.entries()]);
  const pending = deferred();
  current.handlers({ '/api/shares': () => pending.promise });
  const preparing = page.handlePrepareShare();
  await current.enable({});
  page.handleTitle({ detail: { value: '不能写入' } });
  page.handleQuiz();
  pending.resolve({ id: 'late' });
  await preparing;
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.preparedId, '');
  assert.equal(page.data.preparing, false);
  assert.equal(page.data.title, '进行中的编队');
  assert.deepEqual(plain([...current.storage.entries()]), saved);
  assert.equal(current.menus.includes('show'), false);
  assert.deepEqual(current.navigation, []);
  await current.enable({ squad: true });
  assert.equal(page.data.featureEnabled, true);
  assert.equal(page.data.title, '进行中的编队');
  assert.equal(page.data.models.length, 1);
});

test('机库开启时真实网络或合同错误保留旧记录并允许重试；关闭时拒绝迟到结果与写入', async () => {
  const current = environment();
  await current.enable({ builds: true });
  current.handlers({ '/api/builds': () => ({ builds: [record] }) });
  const page = current.page('builds');
  await page.onShow();
  const before = plain(page.data.items);
  for (const value of [undefined, {}, { builds: null }, { builds: {} }, { builds: [{ ...record, completedCount: 10 }] }]) {
    current.handlers({ '/api/builds': () => value });
    await page.loadData();
    assert.deepEqual(plain(page.data.items), before);
    assert.match(page.data.error, /同步失败.*原有记录已保留/);
  }
  current.handlers({ '/api/builds': () => { throw new Error('network failed'); } });
  await page.loadData();
  assert.deepEqual(plain(page.data.items), before);
  current.handlers({ '/api/builds': () => ({ builds: [record] }) });
  await page.loadData();
  assert.equal(page.data.error, '');
  const pending = deferred();
  current.handlers({ '/api/builds': () => pending.promise });
  const loading = page.loadData();
  await current.enable({});
  pending.resolve({ builds: [{ ...record, completedCount: 2 }] });
  await loading;
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.error, '');
  assert.deepEqual(plain(page.data.items), before);
  const count = current.calls.length;
  await page.loadData();
  await page.save(record);
  assert.equal(current.calls.length, count);
});

test('builds关闭时购买页不读进度，pilotRating单开也不伪造未知拼装评级，基础统计独立成功', async () => {
  const current = environment();
  await current.enable({ pilotRating: true });
  const page = current.page('purchased');
  page.onLoad();
  await page.onShow();
  assert.equal(page.data.totalCount, 1);
  assert.equal(page.data.totalSpentText, '99.00');
  assert.equal(page.data.loadError, false);
  assert.equal(page.data.buildSyncError, false);
  assert.equal(current.calls.some((call) => call.path === '/api/builds'), false);
  current.handlers({ '/api/builds': () => ({ builds: 'invalid' }) });
  await current.enable({ builds: true, pilotRating: true });
  await page.onShow();
  await flush();
  assert.equal(page.data.loadError, false);
  assert.equal(page.data.totalCount, 1);
  assert.equal(page.data.buildSyncError, true);
});

test('真实App启动与回前台都刷新配置，启动紧接前台共用同一请求', async () => {
  const current = environment();
  const first = deferred();
  current.respond(() => first.promise);
  let app;
  loadModule('miniprogram/app.ts', {
    mocks: {
      './utils/feature-flags': current.flags,
      './utils/cloud-favorites': { loadWishlist() {} }, './utils/purchase-service': { loadPurchases() {} },
      './utils/model-service': { refreshSeriesMeta() {} },
      './utils/user-service': { getUserInfo: () => null, loadUserInfo: async () => true },
    },
    globals: { wx: { getWindowInfo: () => ({ screenHeight: 800, windowWidth: 375 }) }, App(value) { app = value; } },
  });
  app.loadExchangeRate = () => {};
  app.onLaunch();
  app.onShow();
  assert.equal(current.calls.length, 1);
  first.resolve({ version: 1, features: all });
  await flush();
  assert.equal(current.flags.isFeatureEnabled('builds'), true);
  current.respond(() => Promise.reject(new Error('旧backend404')));
  app.onShow();
  assert.deepEqual(plain(current.flags.getFeatures()), closed);
  await flush();
  assert.equal(current.calls.length, 2);
  assert.deepEqual(plain(current.flags.getFeatures()), closed);
});

test('独立开启quiz不读取关闭的旧squad草稿，驻留编辑在关闭和恢复后保留', async () => {
  const current = environment();
  await current.enable({ quiz: true });
  const page = current.page('quiz');
  await page.onLoad();
  assert.equal(current.reads.draft, 0);
  page.handleTitle({ detail: { value: '未完成的题目' } });
  page.handleSelection({ detail: { ids: catalog.map((item) => item.id), models: catalog } });
  const before = plain(page.data.questions);
  await current.enable({});
  page.handleTitle({ detail: { value: '不得覆盖' } });
  page.handleUseSquad();
  await page.handlePrepareShare();
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.title, '未完成的题目');
  await current.enable({ quiz: true });
  assert.equal(page.data.featureEnabled, true);
  assert.equal(page.data.title, '未完成的题目');
  assert.deepEqual(plain(page.data.questions), before);
  assert.equal(current.reads.draft, 0);
});

test('旧编队复制链接仍要求sharing，关闭时展示未开放且不读取快照或草稿', async () => {
  const current = environment();
  await current.enable({ squad: true });
  const page = current.page('squad');
  await page.onLoad({ shareId: 'old-squad' });
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.loadError, '');
  assert.equal(current.reads.draft, 0);
  assert.equal(current.calls.filter((call) => call.path.startsWith('/api/shares')).length, 0);
});

test('真实清单组件在sharing关闭后隐藏并丢弃迟到快照，不导航也不发送prepared事件', async () => {
  const current = environment();
  await current.enable({ sharing: true });
  const pending = deferred();
  current.handlers({ '/api/shares': () => pending.promise });
  const pageFeatures = loadModule('miniprogram/utils/feature-page.ts', { mocks: { './feature-flags': current.flags }, globals: { wx: current.wx } }).exports;
  const { definition } = loadModule('miniprogram/components/collection-share/collection-share.ts', {
    mocks: { '../../utils/feature-flags': current.flags, '../../utils/feature-page': pageFeatures, '../../utils/hangar-service': current.service },
    globals: { wx: current.wx },
  });
  const events = [];
  const component = {
    ...definition.methods, data: { ...structuredClone(definition.data), kind: 'wishlist', modelIds: ['hg-001'] },
    setData(update) { Object.assign(this.data, structuredClone(update)); }, triggerEvent(...value) { events.push(value); },
  };
  definition.lifetimes.attached.call(component);
  const preparing = component.handlePrepare();
  await current.enable({});
  pending.resolve({ id: 'too-late' });
  await preparing;
  assert.equal(component.data.featureEnabled, false);
  assert.equal(component.data.preparing, false);
  assert.deepEqual(events, []);
  assert.deepEqual(current.navigation, []);
  assert.deepEqual(current.toasts, []);
  definition.lifetimes.detached.call(component);
});

test('购买页在前台重新确认开关后保留已知进度，恢复时同步失败继续使用旧记录', async () => {
  const current = environment();
  await current.enable({ builds: true, pilotRating: true });
  current.handlers({ '/api/builds': () => ({ builds: [record] }) });
  const page = current.page('purchased');
  page.onLoad();
  await page.onShow();
  await flush();
  assert.equal(page.data.buildProgressKnown, true);
  const score = page.data.pilotScore;
  const previous = plain(page._buildProgress);
  current.handlers({ '/api/builds': () => { throw new Error('offline'); } });
  await current.enable({ builds: true, pilotRating: true });
  await page.onShow();
  await flush();
  assert.equal(page.data.buildSyncError, true);
  assert.equal(page.data.buildProgressKnown, true);
  assert.deepEqual(plain(page._buildProgress), previous);
  assert.equal(page.data.pilotScore, score);
  assert.equal(page.data.loadError, false);
});

test('后台驻留订阅页关闭不会操作当前模型页的原始分享菜单', async () => {
  const current = environment();
  await current.enable(all);
  current.handlers({ '/api/builds': () => ({ builds: [record] }), '/api/shares/card': () => ({ kind: 'wishlist', title: '心愿单', models: catalog }) });
  const home = current.page('home');
  home.onLoad();
  const squad = current.page('squad');
  current.active(squad);
  await squad.onLoad({});
  const quiz = current.page('quiz');
  current.active(quiz);
  await quiz.onLoad();
  const share = current.page('share');
  current.active(share);
  await share.onLoad({ id: 'card' });
  const purchased = current.page('purchased');
  purchased.onLoad();
  await purchased.onShow();
  const model = { onShareAppMessage: () => ({ title: 'HG 原始模型分享', path: '/pages/model/model?id=hg-001' }) };
  current.active(model);
  const menuCount = current.menus.length;
  await current.enable({});
  assert.equal(current.menus.length, menuCount);
  assert.deepEqual(model.onShareAppMessage(), { title: 'HG 原始模型分享', path: '/pages/model/model?id=hg-001' });
});

test('前台确认期间机库编辑弹层和未保存输入保持，重新开放不覆盖用户输入', async () => {
  const current = environment();
  await current.enable({ builds: true });
  current.handlers({ '/api/builds': () => ({ builds: [record] }) });
  const page = current.page('builds');
  await page.onShow();
  page.handleEdit(event('hg-001'));
  page.handleInput({ currentTarget: { dataset: { field: 'quantityInput' } }, detail: { value: '8' } });
  page.handleInput({ currentTarget: { dataset: { field: 'goalInput' } }, detail: { value: '尚未保存的新目标' } });
  const waiting = deferred();
  current.respond(() => waiting.promise);
  const refreshing = current.flags.refreshFeatures();
  assert.equal(page.data.featureEnabled, false);
  assert.equal(page.data.editOpen, true);
  assert.equal(page.data.quantityInput, '8');
  waiting.resolve({ version: 1, features: { ...closed, builds: true } });
  await refreshing;
  await flush();
  assert.equal(page.data.featureEnabled, true);
  assert.equal(page.data.editOpen, true);
  assert.equal(page.data.quantityInput, '8');
  assert.equal(page.data.goalInput, '尚未保存的新目标');
});

for (const graded of [false, true]) {
  test(`真实App前台重新确认同一测试快照保留${graded ? '已判分结果与答案揭晓' : '未提交答案'}，最新kind关闭仍禁用`, async () => {
    const current = environment();
    const snapshot = { kind: 'quiz', title: '好友测试', models: catalog,
      questions: ['本命', '第一盒', '下一台'].map((prompt) => ({ prompt, optionIds: catalog.map((model) => model.id) })) };
    current.handlers({
      '/api/shares/public-quiz': () => snapshot,
      '/api/shares/public-quiz/answers': () => ({ score: 1, total: 3, correctAnswers: ['hg-001', 'hg-001', 'hg-001'] }),
    });
    await current.enable({ sharing: true, quiz: true });
    const page = current.page('share');
    current.active(page);
    await page.onLoad({ id: 'public-quiz' });
    page.handleAnswer({ currentTarget: { dataset: { index: 0, id: 'hg-001' } } });
    page.handleAnswer({ currentTarget: { dataset: { index: 1, id: 'rg-002' } } });
    if (graded) {
      page.handleAnswer({ currentTarget: { dataset: { index: 2, id: 'mg-003' } } });
      await page.handleSubmitQuiz();
    }
    const before = plain({ answers: page.data.answers, questions: page.data.snapshot.questions, result: page.data.result });
    let app;
    loadModule('miniprogram/app.ts', {
      mocks: {
        './utils/feature-flags': current.flags,
        './utils/cloud-favorites': {}, './utils/purchase-service': {}, './utils/model-service': {},
        './utils/user-service': { getUserInfo: () => null },
      },
      globals: { wx: { getWindowInfo: () => ({ screenHeight: 800, windowWidth: 375 }) }, App(value) { app = value; } },
    });
    const waiting = deferred();
    current.respond(() => waiting.promise);
    app.onShow();
    assert.equal(page.data.featureEnabled, false);
    page.handleAnswer({ currentTarget: { dataset: { index: 0, id: 'mg-003' } } });
    await page.handleSubmitQuiz();
    assert.deepEqual(plain(page.data.answers), before.answers);
    waiting.resolve({ version: 1, features: { ...closed, sharing: true, quiz: true } });
    await flush();
    assert.equal(page.data.featureEnabled, true);
    assert.deepEqual(plain({ answers: page.data.answers, questions: page.data.snapshot.questions, result: page.data.result }), before);
    current.respond({ version: 1, features: { ...closed, sharing: true } });
    app.onShow();
    await flush();
    assert.equal(page.data.featureEnabled, false);
    const requestCount = current.calls.length;
    page.handleAnswer({ currentTarget: { dataset: { index: 0, id: 'mg-003' } } });
    await page.handleSubmitQuiz();
    assert.equal(current.calls.length, requestCount);
    assert.deepEqual(plain(page.data.answers), before.answers);
    assert.equal(page.onShareAppMessage().path, '/pages/home/home');
  });
}

test('接收者切换快照ID初始化新答案，同一ID题目改变时不复用旧判分', async () => {
  const current = environment();
  const snapshot = { kind: 'quiz', title: '好友测试', models: catalog,
    questions: ['本命', '第一盒', '下一台'].map((prompt) => ({ prompt, optionIds: catalog.map((model) => model.id) })) };
  let next = snapshot;
  current.handlers({
    '/api/shares/first-quiz': () => snapshot,
    '/api/shares/second-quiz': () => next,
    '/api/shares/second-quiz/answers': () => ({ score: 3, total: 3, correctAnswers: ['hg-001', 'hg-001', 'hg-001'] }),
  });
  await current.enable({ sharing: true, quiz: true });
  const page = current.page('share');
  await page.onLoad({ id: 'first-quiz' });
  page.handleAnswer({ currentTarget: { dataset: { index: 0, id: 'hg-001' } } });
  await page.onLoad({ id: 'second-quiz' });
  assert.deepEqual(plain(page.data.answers), ['', '', '']);
  assert.equal(page.data.result, null);
  for (const index of [0, 1, 2]) page.handleAnswer({ currentTarget: { dataset: { index, id: 'hg-001' } } });
  await page.handleSubmitQuiz();
  assert.equal(page.data.result.score, 3);
  next = { ...snapshot, questions: snapshot.questions.map((question, index) => index ? question : { ...question, prompt: '新题目' }) };
  await current.enable({ sharing: true, quiz: true });
  assert.deepEqual(plain(page.data.answers), ['', '', '']);
  assert.equal(page.data.result, null);
  assert.ok(page.data.snapshot.questions.every((question) => !question.selectedId && !question.correctId && !question.correctName));
});
