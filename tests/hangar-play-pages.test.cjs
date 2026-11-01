const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const model = (index, extra = {}) => ({ id: `hg-${index}`, series: 'hg', number: index, name: `机体 ${index}`, nameJa: `ガンダム ${index}`, nameEn: `Gundam ${index}`, imageUrl: '', releaseDate: '2026-01', price: 3000, priceTaxFree: 2700, isLimited: false, productUrl: '', ...extra });
const catalog = Array.from({ length: 40 }, (_, index) => model(index + 1));
const event = (id, index = 0) => ({ currentTarget: { dataset: { id, index } } });
const selection = (models) => ({ detail: { ids: models.map((item) => item.id), models } });
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function setup(page, { services = {}, storageValue, failStorage = false, poster } = {}) {
  const toasts = [];
  const writes = [];
  const navigation = [];
  const shares = [];
  const wx = {
    getStorageSync: () => storageValue,
    setStorageSync: (key, value) => { if (failStorage) throw new Error('storage full'); writes.push({ key, value: plain(value) }); },
    showToast: (value) => toasts.push(value),
    hideShareMenu: () => shares.push('hide'), showShareMenu: () => shares.push('show'),
    navigateTo: (value) => navigation.push(value), navigateBack: () => {}, switchTab: (value) => navigation.push(value),
    previewImage: (value) => navigation.push(value), showShareImageMenu: (value) => navigation.push(value), saveImageToPhotosAlbum: (value) => navigation.push(value),
  };
  const drafts = loadModule('miniprogram/utils/squad-draft.ts', { globals: { wx } }).exports;
  const { definition } = loadModule(`miniprogram/pages/${page}/${page}.ts`, {
    mocks: {
      '../../utils/model-service': { getAllModels: () => catalog, refreshMissingModels: async () => catalog },
      '../../utils/squad-draft': drafts,
      '../../utils/hangar-service': { createShare: async () => ({ id: 'share-123' }), getShare: async () => ({ id: 'share-123', kind: 'squad', title: '好友编队', models: catalog.slice(0, 3), captainId: 'hg-2' }), submitQuiz: async () => ({ score: 2, total: 3, correctAnswers: ['hg-1', 'hg-1', 'hg-1'] }), ...services },
      '../../utils/hangar-poster': { generateSquadPoster: poster || (async () => '/tmp/poster.png') },
    },
    globals: { wx, getApp: () => ({ globalData: { safeAreaBottom: 12 } }) },
  });
  const instance = { ...definition, data: structuredClone(definition.data), setData(update) { Object.assign(this.data, structuredClone(update)); } };
  return { instance, toasts, writes, navigation, shares, wx, drafts };
}

test('六机编队限制、队长调整和草稿持久化覆盖真实编辑流程', async () => {
  const { instance, writes, toasts } = setup('squad');
  await instance.onLoad({});
  instance.handleSelection(selection(catalog.slice(0, 6)));
  assert.equal(instance.data.models.length, 6);
  assert.equal(instance.data.captainId, 'hg-1');
  instance.handleSelection(selection(catalog.slice(0, 7)));
  assert.equal(instance.data.models.length, 6);
  assert.match(toasts.at(-1).title, /最多/);
  instance.handleCaptain(event('hg-4'));
  assert.equal(writes.at(-1).value.captainId, 'hg-4');
  instance.handleTitle({ detail: { value: '出击'.repeat(30) } });
  assert.equal(instance.data.title.length, 30);
  instance.handleRemove(event('hg-4'));
  assert.equal(instance.data.captainId, 'hg-1');
  assert.deepEqual(writes.at(-1).value.modelIds, ['hg-1', 'hg-2', 'hg-3', 'hg-5', 'hg-6']);
  assert.equal(writes.at(-1).value.version, 1);
});

test('草稿读取验证版本、格式、重复机体及队长，存储失败明确提示', async () => {
  const valid = { version: 1, title: '草稿', modelIds: ['hg-1', 'hg-2'], captainId: 'hg-2' };
  const { instance } = setup('squad', { storageValue: valid });
  await instance.onLoad({});
  assert.equal(instance.data.title, '草稿');
  assert.equal(instance.data.captainId, 'hg-2');
  for (const value of [{ ...valid, version: 2 }, { ...valid, modelIds: ['hg-1', 'hg-1'] }, { ...valid, captainId: 'unknown' }, { ...valid, title: 3 }]) {
    const state = setup('squad', { storageValue: value });
    await state.instance.onLoad({});
    assert.equal(state.instance.data.models.length, 0);
    assert.match(state.toasts[0].title, /草稿读取失败/);
  }
  const failed = setup('squad', { failStorage: true });
  failed.instance.handleSelection(selection([catalog[0]]));
  assert.match(failed.toasts.at(-1).title, /草稿保存失败/);
  failed.instance.handleSaveDraft();
  assert.equal(failed.toasts.at(-1).icon, 'none');
});

test('编队分享仅在创建完成后启用，编辑清掉旧id，生成中编辑也丢弃旧回包', async () => {
  const pending = deferred();
  const { instance, shares } = setup('squad', { services: { createShare: () => pending.promise } });
  await instance.onLoad({});
  instance.handleSelection(selection(catalog.slice(0, 2)));
  const creating = instance.handlePrepareShare();
  assert.equal(instance.data.preparedId, '');
  instance.handleCaptain(event('hg-2'));
  pending.resolve({ id: 'stale' });
  await creating;
  assert.equal(instance.data.preparedId, '');
  assert.equal(shares.includes('show'), false);

  const ready = setup('squad');
  ready.instance.handleSelection(selection([catalog[0]]));
  await ready.instance.handlePrepareShare();
  assert.equal(ready.instance.data.preparedId, 'share-123');
  assert.deepEqual(plain(ready.instance.onShareAppMessage()), { title: '我的六机出击', path: '/pages/share/share?id=share-123' });
  assert.equal(typeof ready.instance.onShareAppMessage().then, 'undefined');
  ready.instance.handleTitle({ detail: { value: '新编队' } });
  assert.equal(ready.instance.data.preparedId, '');
  assert.equal(ready.shares.at(-1), 'hide');
});

test('编队创建分享失败可重试，公开编队可复制到本地草稿', async () => {
  let attempts = 0;
  const state = setup('squad', { services: { createShare: async () => { if (!attempts++) throw new Error('offline'); return { id: 'retry-ok' }; } } });
  state.instance.handleSelection(selection([catalog[0]]));
  await state.instance.handlePrepareShare();
  assert.match(state.instance.data.shareError, /失败/);
  await state.instance.handlePrepareShare();
  assert.equal(state.instance.data.preparedId, 'retry-ok');
  const copy = setup('squad');
  await copy.instance.onLoad({ shareId: 'friend-squad' });
  assert.equal(copy.instance.data.title, '好友编队');
  assert.equal(copy.instance.data.captainId, 'hg-2');
  assert.equal(copy.writes.at(-1).value.modelIds.length, 3);
  const badCopy = setup('squad', { services: { getShare: async () => { throw new Error('gone'); } } });
  await badCopy.instance.onLoad({ shareId: 'gone' });
  assert.match(badCopy.instance.data.loadError, /无法复制/);
});

test('海报生成失败可重试，成功图片可预览、分享、保存，编辑清除旧海报', async () => {
  let attempts = 0;
  const state = setup('squad', { poster: async () => { if (!attempts++) throw new Error('canvas failed'); return '/tmp/poster.png'; } });
  state.instance.handleSelection(selection([catalog[0]]));
  await state.instance.handlePoster();
  assert.match(state.instance.data.posterError, /失败/);
  await state.instance.handlePoster();
  state.instance.handlePreviewPoster();
  state.instance.handleSharePoster();
  state.instance.handleSavePoster();
  assert.deepEqual(plain(state.navigation[0].urls), ['/tmp/poster.png']);
  assert.equal(state.navigation[1].path, '/tmp/poster.png');
  assert.equal(state.navigation[2].filePath, '/tmp/poster.png');
  state.instance.handleTitle({ detail: { value: '另一个编队' } });
  assert.equal(state.instance.data.posterPath, '');
});

function fillQuiz(instance) {
  for (let index = 0; index < 3; index += 1) {
    instance.handleOpenPicker(event('', index));
    instance.handleSelection(selection(catalog.slice(index * 3, index * 3 + 3)));
    instance.handleAnswer(event(`hg-${index * 3 + 1}`, index));
    instance.handleClosePicker();
  }
}

test('默契测试强制三题各三个选项并手选答案，题目并集支持九台机体', async () => {
  const inputs = [];
  const state = setup('quiz', { services: { createShare: async (input) => { inputs.push(plain(input)); return { id: 'quiz-ready' }; } } });
  await state.instance.onLoad();
  await state.instance.handlePrepareShare();
  assert.equal(inputs.length, 0);
  fillQuiz(state.instance);
  await state.instance.handlePrepareShare();
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].modelIds.length, 9);
  assert.equal(inputs[0].questions.length, 3);
  assert.ok(inputs[0].questions.every((question) => question.optionIds.length === 3 && question.optionIds.includes(question.answerId)));
  assert.equal(state.instance.onShareAppMessage().path, '/pages/share/share?id=quiz-ready');
  assert.equal(typeof state.instance.onShareAppMessage().then, 'undefined');
  state.instance.handleAnswer(event('hg-2', 0));
  assert.equal(state.instance.data.preparedId, '');
});

test('默契测试复用编队候选但不猜答案，修改中的过期创建结果不启用分享', async () => {
  const pending = deferred();
  const state = setup('quiz', { storageValue: { version: 1, title: '编队', modelIds: ['hg-1', 'hg-2', 'hg-3'], captainId: 'hg-1' }, services: { createShare: () => pending.promise } });
  await state.instance.onLoad();
  state.instance.handleOpenPicker(event('', 0));
  state.instance.handleUseSquad();
  assert.equal(state.instance.data.questions[0].optionIds.length, 3);
  assert.equal(state.instance.data.questions[0].answerId, '');
  fillQuiz(state.instance);
  const creating = state.instance.handlePrepareShare();
  state.instance.handleTemplate({ currentTarget: { dataset: { index: 0 } }, detail: { value: 2 } });
  pending.resolve({ id: 'stale-quiz' });
  await creating;
  assert.equal(state.instance.data.preparedId, '');
  assert.equal(state.shares.includes('show'), false);
});

const quizSnapshot = () => ({
  id: 'public-quiz', kind: 'quiz', title: '你懂我的机库吗', models: catalog.slice(0, 3),
  questions: Array.from({ length: 3 }, (_, index) => ({ prompt: `第${index + 1}题`, optionIds: ['hg-1', 'hg-2', 'hg-3'], answerId: 'hg-1' })),
});

test('公开测试加载时不保留答案，全部作答后只使用服务端判分并揭晓答案', async () => {
  const submissions = [];
  const state = setup('share', { services: {
    getShare: async () => quizSnapshot(),
    submitQuiz: async (id, answers) => { submissions.push({ id, answers: plain(answers) }); return { score: 1, total: 3, correctAnswers: ['hg-2', 'hg-2', 'hg-2'] }; },
  } });
  await state.instance.onLoad({ id: 'public-quiz' });
  assert.equal(JSON.stringify(state.instance.data).includes('answerId'), false);
  assert.ok(state.instance.data.snapshot.questions.every((question) => question.correctId === ''));
  await state.instance.handleSubmitQuiz();
  assert.equal(submissions.length, 0);
  for (let index = 0; index < 3; index += 1) state.instance.handleAnswer(event(index === 0 ? 'hg-2' : 'hg-1', index));
  await state.instance.handleSubmitQuiz();
  assert.deepEqual(submissions, [{ id: 'public-quiz', answers: ['hg-2', 'hg-1', 'hg-1'] }]);
  assert.deepEqual(state.instance.data.result, { score: 1, total: 3 });
  assert.ok(state.instance.data.snapshot.questions.every((question) => question.correctId === 'hg-2' && question.correctName === '机体 2'));
  state.instance.handleAnswer(event('hg-3', 0));
  assert.equal(state.instance.data.answers[0], 'hg-2');
});

test('公开测试判分失败保留答案且允许重试', async () => {
  let attempts = 0;
  const state = setup('share', { services: { getShare: async () => quizSnapshot(), submitQuiz: async () => { if (!attempts++) throw new Error('offline'); return { score: 3, total: 3, correctAnswers: ['hg-1', 'hg-1', 'hg-1'] }; } } });
  await state.instance.onLoad({ id: 'public-quiz' });
  for (let index = 0; index < 3; index += 1) state.instance.handleAnswer(event('hg-1', index));
  await state.instance.handleSubmitQuiz();
  assert.match(state.instance.data.submitError, /保留答案/);
  assert.deepEqual(state.instance.data.answers, ['hg-1', 'hg-1', 'hg-1']);
  assert.equal(state.instance.data.result, null);
  await state.instance.handleSubmitQuiz();
  assert.equal(state.instance.data.result.score, 3);
});

for (const kind of ['squad', 'wishlist', 'purchased', 'compare', 'report']) {
  test(`公开${kind}仅装载白名单字段，原链接再分享且可直达模型`, async () => {
    const snapshot = { id: 'server-id', kind, title: '好友的机库', models: [model(1, { priceCny: 999, purchaseDate: '秘密日期', channel: '秘密渠道', note: '秘密备注' })], captainId: 'hg-1', report: { quantity: 8, completedCount: 3, buildingCount: 2, amountCny: 999 } };
    const state = setup('share', { services: { getShare: async () => snapshot } });
    await state.instance.onLoad({ id: 'original-share' });
    const json = JSON.stringify(state.instance.data);
    for (const privateField of ['priceCny', '秘密', 'amountCny', 'priceTaxFree']) assert.equal(json.includes(privateField), false);
    assert.equal(state.instance.onShareAppMessage().path, '/pages/share/share?id=original-share');
    state.instance.handleModel(event('hg-1'));
    assert.equal(state.navigation.at(-1).url, '/pages/model/model?id=hg-1');
    state.instance.handleCreate();
    assert.equal(state.navigation.at(-1).url, '/pages/squad/squad');
    if (kind === 'squad') { state.instance.handleCopySquad(); assert.equal(state.navigation.at(-1).url, '/pages/squad/squad?shareId=original-share'); }
    if (kind === 'report') assert.deepEqual(state.instance.data.snapshot.report, { quantity: 8, completedCount: 3, buildingCount: 2 });
  });
}

test('接收页处理缺失/无效id、已失效链接、加载重试和卸载后的异步响应', async () => {
  for (const id of [undefined, '', '../private', 'x'.repeat(101)]) {
    let called = false;
    const state = setup('share', { services: { getShare: async () => { called = true; return {}; } } });
    await state.instance.onLoad({ id });
    assert.equal(called, false);
    assert.match(state.instance.data.loadError, /无效/);
  }
  let attempts = 0;
  const retry = setup('share', { services: { getShare: async () => { if (!attempts++) throw new Error('deleted'); return { id: 'share-123', kind: 'wishlist', title: '恢复', models: [] }; } } });
  await retry.instance.onLoad({ id: 'share-123' });
  assert.match(retry.instance.data.loadError, /失效/);
  await retry.instance.loadSnapshot();
  assert.equal(retry.instance.data.snapshot.title, '恢复');
  const pending = deferred();
  const unloaded = setup('share', { services: { getShare: () => pending.promise } });
  const loading = unloaded.instance.onLoad({ id: 'share-123' });
  unloaded.instance.onUnload();
  pending.resolve({ id: 'share-123', kind: 'wishlist', title: '不能回写', models: [] });
  await loading;
  assert.equal(unloaded.instance.data.snapshot, null);
});

test('目录选择器支持中日英检索、分页、数量上限和取消选择', () => {
  const toasts = [];
  const { definition } = loadModule('miniprogram/components/model-picker/model-picker.ts', { mocks: { '../../utils/model-service': { getAllModels: () => catalog, refreshModels: async () => catalog, filterModels: (models, { keyword }) => models.filter((item) => [item.name, item.nameJa, item.nameEn].some((name) => name.toLowerCase().includes(keyword.toLowerCase()))) } }, globals: { wx: { showToast: (toast) => toasts.push(toast) } } });
  const instance = { ...definition.methods, data: { ...structuredClone(definition.data), selectedIds: [], limit: 3 }, setData(update) { Object.assign(this.data, structuredClone(update)); }, triggerEvent(_name, detail) { this.data.selectedIds = detail.ids; this.updateCandidates(); } };
  instance.data._allModels = catalog;
  instance.updateCandidates();
  assert.equal(instance.data.candidates.length, 24);
  instance.handleMore();
  assert.equal(instance.data.candidates.length, 40);
  for (const keyword of ['机体 30', 'ガンダム 30', 'gundam 30']) { instance.handleSearch({ detail: { value: keyword } }); assert.equal(instance.data.candidates[0].id, 'hg-30'); }
  for (let index = 1; index <= 4; index += 1) instance.handleSelect(event(`hg-${index}`));
  assert.deepEqual(plain(instance.data.selectedIds), ['hg-1', 'hg-2', 'hg-3']);
  assert.match(toasts.at(-1).title, /最多选择 3/);
  instance.handleSelect(event('hg-2'));
  assert.deepEqual(plain(instance.data.selectedIds), ['hg-1', 'hg-3']);
});

test('Canvas海报下载跨域图片失败时绘制文字占位，导出失败可重试', async () => {
  const text = [];
  const ctx = { fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText(value) { text.push(value); }, measureText: (value) => ({ width: value.length * 15 }), drawImage() { throw new Error('下载失败不应绘制图片'); } };
  const canvas = { getContext: () => ctx };
  let failedExport = true;
  const wx = {
    createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(callback) { callback([{ node: canvas }]); } }),
    downloadFile: (options) => options.fail(new Error('domain not allowed')),
    canvasToTempFilePath: (options) => failedExport ? options.fail(new Error('export')) : options.success({ tempFilePath: '/tmp/local.png' }),
  };
  const { generateSquadPoster } = loadModule('miniprogram/utils/hangar-poster.ts', { globals: { wx } }).exports;
  await assert.rejects(generateSquadPoster({}, '出击', [model(1, { imageUrl: 'https://blocked.example/image.png' })], 'hg-1'), /海报导出失败/);
  assert.ok(text.includes('机体图像暂缺'));
  assert.ok(text.some((value) => value.includes('小程序卡片')));
  assert.equal(text.some((value) => value.includes('扫码')), false);
  failedExport = false;
  assert.equal(await generateSquadPoster({}, '出击', [model(1)], 'hg-1'), '/tmp/local.png');
  assert.equal(canvas.width, 900);
  assert.equal(canvas.height, 1360);
});
