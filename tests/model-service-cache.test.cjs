const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const TTL = 4 * 60 * 60 * 1000;
const names = (items) => Array.from(items, (item) => item.name);
function model(id) {
  return { id, series: id.split('-')[0], name: id, imageUrl: '' };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function catalog({ storage = new Map(), localMeta = [], localModels = [], callAPI, now = 1000 } = {}) {
  const clock = { now };
  const requests = [];
  const writes = [];
  const { exports: service } = loadModule('miniprogram/utils/model-service.ts', {
    mocks: {
      './api': { callAPI(options) { requests.push(options.path); return callAPI(options); } },
      './cdn-config': { resolveImageUrl: (url) => url ? `cdn:${url}` : url },
      '../data/series-meta': localMeta,
    },
    globals: {
      Date: { now: () => clock.now },
      console: { error() {} },
      wx: {
        getStorageSync: (key) => structuredClone(storage.get(key)),
        setStorageSync(key, value) { writes.push(key); storage.set(key, structuredClone(value)); },
        getFileSystemManager: () => ({
          readFileSync: (path) => JSON.stringify(localModels.filter((item) => path === `/data/${item.series}.json`)),
        }),
      },
    },
  });
  return { service, storage, clock, requests, writes };
}

const targets = [
  { name: '元信息', key: 'gundam-cache-meta', path: '/api/series-meta',
    data: (name) => [{ code: 'hg', name }], read: (service) => service.getSeriesMeta(),
    refresh: (service) => service.refreshSeriesMeta() },
  { name: '模型', key: 'gundam-cache-models-rg', path: '/api/models/rg',
    data: (name) => [{ ...model(`rg-${name}`), name }], read: (service) => service.getModels('rg'),
    refresh: (service) => service.refreshModels('rg') },
];

for (const target of targets) {
  test(`${target.name}成功时间戳同时用于内存和storage，缓存读取不续期且满4小时刷新`, async () => {
    const { service, storage, clock, requests, writes } = catalog({
      async callAPI() { clock.now += 7; return { data: target.data(`cloud-${requests.length}`), version: 'same-day' }; },
    });
    await target.refresh(service);
    const timestamp = clock.now;
    assert.equal(storage.get(target.key).timestamp, timestamp);
    clock.now = timestamp + TTL - 1;
    assert.deepEqual(names(target.read(service)), ['cloud-1']);
    assert.deepEqual(names(await target.refresh(service)), ['cloud-1']);
    assert.equal(requests.length, 1);
    assert.equal(writes.length, 1);
    assert.equal(storage.get(target.key).timestamp, timestamp);
    clock.now = timestamp + TTL;
    assert.deepEqual(names(await target.refresh(service)), ['cloud-2']);
    assert.equal(requests.length, 2);
    assert.equal(storage.get(target.key).timestamp, clock.now);
    assert.equal(storage.get(target.key).version, 'same-day');
  });

  test(`${target.name}新鲜storage命中无需请求，提升到内存后仍沿用原始过期时间`, async () => {
    const timestamp = 500;
    const storage = new Map([[target.key, { data: target.data('stored'), version: 'stored', timestamp }]]);
    const { service, clock, requests, writes } = catalog({ storage, now: timestamp + TTL - 2,
      callAPI: async () => ({ data: target.data('updated'), version: 'new' }),
    });
    assert.deepEqual(names(await target.refresh(service)), ['stored']);
    clock.now += 1;
    assert.deepEqual(names(target.read(service)), ['stored']);
    assert.deepEqual(names(await target.refresh(service)), ['stored']);
    assert.equal(requests.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(storage.get(target.key).timestamp, timestamp);
    clock.now += 1;
    assert.deepEqual(names(await target.refresh(service)), ['updated']);
    assert.deepEqual(requests, [target.path]);
  });

  test(`${target.name}过期storage保留离线展示，失败和空响应不覆盖或续期且下一次可重试`, async () => {
    const entry = { data: target.data('offline'), version: 'old', timestamp: 50 };
    const storage = new Map([[target.key, entry]]);
    const { service, clock, requests, writes } = catalog({ storage, now: 50 + TTL,
      async callAPI() {
        if (requests.length === 1) throw new Error('离线');
        if (requests.length === 2) return { data: [], version: 'empty' };
        return { data: target.data('recovered'), version: 'new' };
      },
    });
    assert.deepEqual(names(target.read(service)), ['offline']);
    assert.equal(requests.length, 0);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.deepEqual(names(await target.refresh(service)), ['offline']);
      assert.deepEqual(storage.get(target.key), entry);
      assert.equal(writes.length, 0);
      clock.now += 1;
    }
    assert.deepEqual(names(await target.refresh(service)), ['recovered']);
    assert.equal(requests.length, 3);
    assert.equal(storage.get(target.key).timestamp, clock.now);
  });

  test(`${target.name}打包fallback不算新鲜云端缓存，空响应后仍请求直到恢复`, async () => {
    const local = target.data('bundled');
    const { service, requests, storage } = catalog({
      localMeta: local, localModels: local,
      callAPI: async () => ({ data: requests.length === 1 ? [] : target.data('cloud'), version: 'v1' }),
    });
    assert.deepEqual(names(target.read(service)), ['bundled']);
    assert.deepEqual(names(await target.refresh(service)), ['bundled']);
    assert.equal(storage.size, 0);
    assert.deepEqual(names(await target.refresh(service)), ['cloud']);
    assert.equal(requests.length, 2);
  });
}

test('元信息并发只发一次请求，失败后释放inflight并可恢复', async () => {
  const first = deferred();
  const { service, requests } = catalog({ localMeta: [{ code: 'hg', name: 'local' }],
    callAPI: () => requests.length === 1 ? first.promise : Promise.resolve({ data: [{ code: 'hg', name: 'cloud' }], version: 'v1' }),
  });
  const one = service.refreshSeriesMeta();
  const two = service.refreshSeriesMeta();
  assert.deepEqual(requests, ['/api/series-meta']);
  first.reject(new Error('离线'));
  assert.deepEqual((await Promise.all([one, two])).map(names), [['local'], ['local']]);
  assert.deepEqual(names(await service.refreshSeriesMeta()), ['cloud']);
  assert.equal(requests.length, 2);
});

test('模型按系列合并并发，不同系列独立完成，空响应和失败均释放inflight', async () => {
  const rg = deferred();
  const mg = deferred();
  let retry = false;
  const { service, requests } = catalog({ localModels: [model('rg-local'), model('mg-local')],
    callAPI: ({ path }) => retry ? Promise.resolve({ data: [model(`${path.split('/').pop()}-cloud`)], version: 'v1' }) : path.endsWith('/rg') ? rg.promise : mg.promise,
  });
  const rgOne = service.refreshModelsWithStatus('rg');
  const rgTwo = service.refreshModels('rg');
  const mgOne = service.refreshModelsWithStatus('mg');
  assert.deepEqual(requests, ['/api/models/rg', '/api/models/mg']);
  mg.resolve({ data: [], version: 'empty' });
  assert.equal((await mgOne).refreshed, false);
  rg.reject(new Error('离线'));
  assert.equal((await rgOne).refreshed, false);
  assert.deepEqual(names(await rgTwo), ['rg-local']);
  retry = true;
  assert.equal((await service.refreshModelsWithStatus('rg')).refreshed, true);
  assert.equal((await service.refreshModelsWithStatus('mg')).refreshed, true);
  assert.equal(requests.length, 4);
});

test('缺失用户模型突破新鲜缓存，仅强刷缺失系列并合并同系列并发，未知ID保留', async () => {
  const pending = deferred();
  const storage = new Map(['hg', 'rg', 'mg', 'pg'].map((code) => [
    `gundam-cache-models-${code}`, { data: [model(`${code}-known`)], version: 'v1', timestamp: 1000 },
  ]));
  const ids = ['rg-new', 'rg-still-missing', 'unknown-id'];
  const { service, requests } = catalog({ storage, callAPI: () => pending.promise });
  assert.equal((await service.refreshModelsWithStatus('rg')).refreshed, true);
  assert.equal(requests.length, 0);
  const one = service.refreshMissingModels(ids);
  const two = service.refreshMissingModels(['hg-known', 'rg-new']);
  assert.deepEqual(requests, ['/api/models/rg']);
  pending.resolve({ data: [model('rg-known'), model('rg-new')], version: 'v1' });
  for (const result of await Promise.all([one, two])) {
    assert.ok(result.some((item) => item.id === 'rg-new'));
    assert.ok(result.some((item) => item.id === 'hg-known'));
  }
  assert.deepEqual(ids, ['rg-new', 'rg-still-missing', 'unknown-id']);
  await service.refreshMissingModels(['unknown-id', 'rg-new']);
  assert.equal(requests.length, 1);
});

test('模型新鲜命中仍返回刷新成功且图片只在成功更新时重写一次', async () => {
  const { service, requests } = catalog({
    callAPI: async () => ({ data: [{ ...model('rg-cloud'), imageUrl: 'cover.png' }], version: 'v1' }),
  });
  const first = await service.refreshModelsWithStatus('rg');
  const second = await service.refreshModelsWithStatus('rg');
  assert.equal(first.refreshed, true);
  assert.equal(second.refreshed, true);
  assert.equal(second.models[0].imageUrl, 'cdn:cover.png');
  assert.equal(requests.length, 1);
});
