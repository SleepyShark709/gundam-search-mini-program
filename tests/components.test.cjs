const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

function createInstance(definition, data = {}) {
  const instance = {
    data: {
      ...Object.fromEntries(Object.entries(definition.properties).map(([key, property]) => [key, property.value])),
      ...structuredClone(definition.data),
      ...data,
    },
    events: [],
    setData(update) {
      Object.assign(this.data, update);
    },
    triggerEvent(name, detail) {
      this.events.push({ name, detail });
    },
    ...definition.methods,
  };
  return instance;
}

function loadPurchaseForm() {
  return loadModule('miniprogram/components/purchase-form/purchase-form.ts').definition;
}

test('清空已有购买信息时，实际表单提交四个明确的 null', () => {
  const definition = loadPurchaseForm();
  const instance = createInstance(definition, {
    modelId: 'rg-001',
    priceCny: 199,
    purchaseDate: '2026-10-01',
    channel: '实体店',
    note: '旧备注',
  });
  definition.observers.open.call(instance, true);
  instance.handlePriceInput({ detail: { value: '' } });
  instance.handleDateClear();
  instance.handleChannelInput({ detail: { value: '' } });
  instance.handleNoteInput({ detail: { value: '' } });
  instance.handleSubmit();

  assert.deepEqual(structuredClone(instance.events), [{
    name: 'submit',
    detail: { modelId: 'rg-001', priceCny: null, purchaseDate: null, channel: null, note: null },
  }]);
});

test('点击清空日期后提交 null，其他购买字段保持原值', () => {
  const definition = loadPurchaseForm();
  const instance = createInstance(definition, {
    modelId: 'rg-001',
    priceCny: 0,
    purchaseDate: '2026-10-01',
    channel: '实体店',
    note: '保留备注',
  });
  definition.observers.open.call(instance, true);
  instance.handleDateClear();
  assert.equal(instance.data.formDate, '');
  instance.handleSubmit();

  assert.deepEqual(structuredClone(instance.events[0].detail), {
    modelId: 'rg-001', priceCny: 0, purchaseDate: null, channel: '实体店', note: '保留备注',
  });
});

test('只清空部分购买字段时保留其他值，价格 0 仍然提交为数字', () => {
  const definition = loadPurchaseForm();
  const instance = createInstance(definition, {
    modelId: 'rg-001',
    formPrice: '0',
    formDate: '2026-10-31',
    formChannel: '',
    formNote: '保留备注',
  });
  instance.handleSubmit();

  assert.deepEqual(structuredClone(instance.events[0].detail), {
    modelId: 'rg-001', priceCny: 0, purchaseDate: '2026-10-31', channel: null, note: '保留备注',
  });
  instance.data.formPrice = '199.50';
  instance.handleSubmit();
  assert.equal(instance.events[1].detail.priceCny, 199.5);
});

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function loadDetail(getModelImages, globals = {}) {
  return loadModule('miniprogram/components/model-detail/model-detail.ts', {
    mocks: {
      '../../utils/price': { formatJPY: String, formatCNY: String, calcTaxFree: (price) => price },
      '../../utils/format': { formatDate: String },
      '../../utils/model-service': { getModelImages },
    },
    globals,
  }).definition;
}

function openModel(definition, instance, id) {
  const model = { id, series: 'rg', imageUrl: `${id}-main.jpg` };
  instance.data.model = model;
  instance.data.open = true;
  definition.observers['model, open'].call(instance, model, true);
}

function captureImageRequests(instance) {
  const requests = [];
  const loadImages = instance._loadImages;
  instance._loadImages = function (...args) {
    const promise = loadImages.apply(this, args);
    requests.push(promise);
    return promise;
  };
  return requests;
}

test('A 图片比 B 晚返回时，真实详情函数仍保留 B 图集', async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  const definition = loadDetail((_series, id) => id === 'A' ? pendingA.promise : pendingB.promise);
  const instance = createInstance(definition);
  const requests = captureImageRequests(instance);
  openModel(definition, instance, 'A');
  openModel(definition, instance, 'B');
  pendingB.resolve(['B-1.jpg', 'B-2.jpg']);
  await requests[1];
  pendingA.resolve(['A-1.jpg']);
  await requests[0];

  assert.deepEqual([...instance.data.images], ['B-1.jpg', 'B-2.jpg']);
});

test('详情关闭期间返回的图片不回写，重开同模型后旧请求也不能覆盖', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const definition = loadDetail(() => (++calls === 1 ? first.promise : second.promise));
  const instance = createInstance(definition);
  const requests = captureImageRequests(instance);
  openModel(definition, instance, 'A');
  instance.data.open = false;
  definition.observers['model, open'].call(instance, instance.data.model, false);
  first.resolve(['A-old.jpg']);
  await requests[0];
  assert.deepEqual([...instance.data.images], ['A-main.jpg']);

  openModel(definition, instance, 'A');
  second.resolve(['A-new.jpg']);
  await requests[1];
  assert.deepEqual([...instance.data.images], ['A-new.jpg']);
});

test('快速关闭并重开相同模型时，请求编号阻止上一轮响应覆盖', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const definition = loadDetail(() => (++calls === 1 ? first.promise : second.promise));
  const instance = createInstance(definition);
  const requests = captureImageRequests(instance);
  openModel(definition, instance, 'A');
  instance.data.open = false;
  definition.observers['model, open'].call(instance, instance.data.model, false);
  openModel(definition, instance, 'A');
  second.resolve(['A-new.jpg']);
  await requests[1];
  first.resolve(['A-old.jpg']);
  await requests[0];
  assert.deepEqual([...instance.data.images], ['A-new.jpg']);
});

test('详情销毁后尚未完成的图片请求不再写入', async () => {
  const pending = deferred();
  const definition = loadDetail(() => pending.promise);
  const instance = createInstance(definition);
  const requests = captureImageRequests(instance);
  openModel(definition, instance, 'A');
  definition.lifetimes.detached.call(instance);
  pending.resolve(['A-gallery.jpg']);
  await requests[0];
  assert.deepEqual([...instance.data.images], ['A-main.jpg']);
});

test('后台恢复的 nextTick 在切换模型后不会恢复旧图集', () => {
  const ticks = [];
  const definition = loadDetail(() => new Promise(() => {}), {
    wx: { nextTick: (callback) => ticks.push(callback) },
  });
  const instance = createInstance(definition);
  openModel(definition, instance, 'A');
  definition.pageLifetimes.show.call(instance);
  openModel(definition, instance, 'B');
  ticks[0]();
  assert.deepEqual([...instance.data.images], ['B-main.jpg']);
});
