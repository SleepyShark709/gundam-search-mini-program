const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');
const { enabledFeatures } = require('./helpers/enabled-features.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
const summary = loadModule('miniprogram/utils/build-summary.ts').exports;
const event = (id) => ({ currentTarget: { dataset: { id } } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function record(modelId = 'hg-001', patch = {}) {
  return { modelId, quantity: 3, completedCount: 1, buildingCount: 1, goal: '完成手臂', goalDoneDate: null, ...patch };
}

function session({ records = [record()], load, refresh, save, share } = {}) {
  const updates = [];
  const writes = [];
  const shares = [];
  const toasts = [];
  const navigations = [];
  const catalog = records.map(({ modelId }) => ({ id: modelId, name: `模型 ${modelId}`, imageUrl: '/image.jpg', series: 'hg' }));
  const { definition } = loadModule('miniprogram/pages/builds/builds.ts', {
    mocks: {
      ...enabledFeatures().mocks,
      '../../utils/model-service': { getAllModels: () => catalog, refreshMissingModels: refresh || (async () => catalog) },
      '../../utils/build-summary': summary,
      '../../utils/hangar-service': {
        loadBuildProgress: load || (async () => records),
        saveBuildProgress: async (input) => { writes.push(plain(input)); return save ? save(input) : input; },
        createShare: async (input) => { shares.push(plain(input)); return share ? share(input) : { id: 'saved-share' }; },
      },
    },
    globals: {
      wx: {
        showToast: (value) => toasts.push(value), navigateTo: (value) => navigations.push(value),
        switchTab: (value) => navigations.push(value), navigateBack: (value) => navigations.push(value),
      },
    },
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { updates.push(structuredClone(patch)); Object.assign(this.data, structuredClone(patch)); },
  };
  return { page, updates, writes, shares, toasts, navigations, catalog };
}

test('机库读取失败保留已同步数据和汇总，重试期间去重并可恢复', async () => {
  let next = [record()];
  let calls = 0;
  const current = session({ load: () => { calls++; return next; } });
  await current.page.onShow();
  const before = structuredClone(current.page.data.items);
  const beforeSummary = structuredClone(current.page.data.summary);
  next = Promise.reject(new Error('network failed'));
  await current.page.onShow();
  assert.deepEqual(current.page.data.items, before);
  assert.deepEqual(current.page.data.summary, beforeSummary);
  assert.match(current.page.data.error, /原有记录已保留/);
  assert.equal(current.page.data.loading, false);
  const retry = deferred();
  next = retry.promise;
  const pending = current.page.loadData();
  assert.equal(current.page.loadData(), pending);
  assert.equal(current.page.data.loading, true);
  assert.deepEqual(current.page.data.items, before);
  retry.resolve([record('hg-001', { completedCount: 2, buildingCount: 0 })]);
  await pending;
  assert.equal(calls, 3);
  assert.equal(current.page.data.summary.completedCount, 2);
  assert.equal(current.page.data.error, '');
  assert.equal(current.page.data.loading, false);
});

test('无购买记录显示空机库，抽选及生成战报不创建记录', async () => {
  const current = session({ records: [] });
  await current.page.onShow();
  assert.deepEqual(current.page.data.items, []);
  assert.deepEqual(current.page.data.summary, { quantity: 0, completedCount: 0, buildingCount: 0, backlogCount: 0, percent: 0 });
  assert.equal(current.page.data.loading, false);
  current.page.handleDraw();
  await current.page.handlePrepareReport();
  assert.equal(current.page.data.selected, null);
  assert.equal(current.shares.length, 0);
  assert.equal(current.writes.length, 0);
  current.page.handleExplore();
  assert.equal(current.navigations.at(-1).url, '/pages/home/home');
});

test('盒数与完成进度必须为有效整数且总数不超额', async () => {
  const current = session();
  await current.page.onShow();
  current.page.handleEdit(event('hg-001'));
  const invalid = [
    { quantityInput: '0' }, { quantityInput: '1000' }, { quantityInput: '1.5' }, { quantityInput: 'oops' },
    { quantityInput: '' }, { completedInput: '-1' }, { completedInput: '0.5' },
    { buildingInput: '4' }, { completedInput: '2', buildingInput: '2' }, { goalInput: '字'.repeat(101) },
  ];
  for (const patch of invalid) {
    current.page.setData({ quantityInput: '3', completedInput: '1', buildingInput: '1', goalInput: '完成手臂', ...patch });
    await current.page.handleSave();
    assert.equal(current.page.data.editOpen, true);
    assert.equal(current.writes.length, 0, JSON.stringify(patch));
  }
  assert.equal(current.toasts.length, invalid.length);
  current.page.setData({ quantityInput: '999', completedInput: '998', buildingInput: '1', goalInput: '  完成手臂  ' });
  await current.page.handleSave();
  assert.deepEqual(current.writes[0], record('hg-001', { quantity: 999, completedCount: 998, buildingCount: 1 }));
  assert.equal(current.page.data.editOpen, false);
});

test('保存失败不丢表单编辑和旧进度，保存期间不关闭编辑且拒绝重复提交', async () => {
  const write = deferred();
  const current = session({ save: () => write.promise });
  await current.page.onShow();
  current.page.handleEdit(event('hg-001'));
  current.page.handleInput({ currentTarget: { dataset: { field: 'goalInput' } }, detail: { value: '新的计划' } });
  current.page.setData({ quantityInput: '4' });
  const pending = current.page.handleSave();
  assert.equal(current.page.data.saving, true);
  current.page.handleCloseEdit();
  await current.page.handleSave();
  assert.equal(current.page.data.editOpen, true);
  assert.equal(current.writes.length, 1);
  write.reject(new Error('save failed'));
  await pending;
  assert.equal(current.page.data.editOpen, true);
  assert.equal(current.page.data.quantityInput, '4');
  assert.equal(current.page.data.goalInput, '新的计划');
  assert.equal(current.page.data.items[0].quantity, 3);
  assert.equal(current.page.data.items[0].goal, '完成手臂');
  assert.equal(current.page.data.saving, false);
  assert.equal(current.toasts.at(-1).title, '保存失败，请重试');
});

test('同一天重复达成目标不重复写入；更换目标会清除旧完成日期', async () => {
  const current = session();
  await current.page.onShow();
  await current.page.handleGoalDone(event('hg-001'));
  assert.equal(current.writes[0].goalDoneDate, summary.localDate());
  assert.equal(current.page.data.items[0].doneToday, true);
  await current.page.handleGoalDone(event('hg-001'));
  assert.equal(current.writes.length, 1);
  current.page.handleEdit(event('hg-001'));
  current.page.setData({ goalInput: '完成腿部' });
  await current.page.handleSave();
  assert.equal(current.writes[1].goalDoneDate, null);
  assert.equal(current.page.data.items[0].doneToday, false);
  const withoutGoal = session({ records: [record('hg-001', { goal: '' })] });
  await withoutGoal.page.onShow();
  await withoutGoal.page.handleGoalDone(event('hg-001'));
  assert.equal(withoutGoal.writes.length, 0);
});

test('过滤只改变显示列表，汇总与抽选仍依据完整机库', async () => {
  const current = session({ records: [record('hg-001'), record('rg-002', { quantity: 2, completedCount: 2, buildingCount: 0 })] });
  await current.page.onShow();
  current.page.handleFilter(event('backlog'));
  assert.deepEqual(current.page.data.items.map((item) => item.modelId), ['hg-001']);
  assert.equal(current.page.data.summary.quantity, 5);
  current.page.handleFilter(event('completed'));
  assert.equal(current.page.data.items.length, 2);
  current.page.handleDraw();
  assert.equal(current.page.data.filter, 'all');
  assert.equal(current.page.data.selected.modelId, 'hg-001');
});

test('战报仅发送前 50 款的对应数量汇总，排除目标与购买信息', async () => {
  const records = Array.from({ length: 51 }, (_, i) => record(`hg-${i + 1}`, {
    quantity: i === 50 ? 999 : 2, completedCount: i === 50 ? 999 : 1, buildingCount: 0,
    goal: '私人目标', goalDoneDate: '2026-01-01', priceCny: 888, channel: '私人渠道', note: '私人备注',
  }));
  const current = session({ records });
  await current.page.onShow();
  await current.page.handlePrepareReport();
  assert.deepEqual(current.shares, [{
    kind: 'report', title: '我的机库整备战报', modelIds: records.slice(0, 50).map((item) => item.modelId),
    report: { quantity: 100, completedCount: 50, buildingCount: 0 },
  }]);
  assert.equal(current.page.data.summary.quantity, 1099);
  assert.equal(current.page.data.shareId, 'saved-share');
  assert.equal(current.navigations[0].url, '/pages/share/share?id=saved-share');
  assert.equal(current.page.onShareAppMessage().path, '/pages/share/share?id=saved-share');
  for (const privateText of ['私人', 'goal', 'priceCny', 'channel', 'note']) assert.equal(JSON.stringify(current.shares).includes(privateText), false);
});

test('生成战报期间进度更新后忽略旧分享结果，重新生成使用新进度', async () => {
  const first = deferred();
  let request = 0;
  const current = session({ share: () => ++request === 1 ? first.promise : { id: 'latest-share' } });
  await current.page.onShow();
  const sharing = current.page.handlePrepareReport();
  current.page.handleEdit(event('hg-001'));
  current.page.setData({ completedInput: '2', buildingInput: '0' });
  await current.page.handleSave();
  first.resolve({ id: 'stale-share' });
  await sharing;
  assert.equal(current.page.data.shareId, '');
  assert.equal(current.page.data.sharing, false);
  assert.equal(current.navigations.length, 0);
  assert.equal(current.page.onShareAppMessage().path, '/pages/builds/builds');
  await current.page.handlePrepareReport();
  assert.equal(current.shares[1].report.completedCount, 2);
  assert.equal(current.page.data.shareId, 'latest-share');
});

test('卸载后异步读取、保存和分享均不更新页面或弹出结果', async () => {
  for (const operation of ['load', 'save', 'share']) {
    const pending = deferred();
    const current = session({
      ...(operation === 'load' ? { load: () => pending.promise } : {}),
      ...(operation === 'save' ? { save: () => pending.promise } : {}),
      ...(operation === 'share' ? { share: () => pending.promise } : {}),
    });
    let running;
    if (operation === 'load') running = current.page.onShow();
    else {
      await current.page.onShow();
      running = operation === 'save' ? current.page.save(record()) : current.page.handlePrepareReport();
    }
    current.page.onUnload();
    const count = current.updates.length;
    pending.resolve(operation === 'load' ? [record()] : operation === 'save' ? record() : { id: 'unloaded-share' });
    await running;
    assert.equal(current.updates.length, count, operation);
    assert.equal(current.toasts.length, 0, operation);
    assert.equal(current.navigations.length, 0, operation);
  }
});

test('机库汇总按盒数计算分母，空机库百分比为零，本地日期保留本地日历', () => {
  assert.deepEqual(plain(summary.summarizeBuilds([record(), record('rg-002', { quantity: 7, completedCount: 3, buildingCount: 2 })])), {
    quantity: 10, completedCount: 4, buildingCount: 3, backlogCount: 3, percent: 40,
  });
  assert.equal(summary.summarizeBuilds([]).percent, 0);
  assert.equal(summary.localDate({ getFullYear: () => 2026, getMonth: () => 0, getDate: () => 2 }), '2026-01-02');
});
