const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-typescript.cjs');

const lineages = loadModule('miniprogram/data/lineages.ts').exports;
const discovery = loadModule('miniprogram/utils/discovery.ts', { mocks: { '../data/lineages': lineages } }).exports;
const { searchCatalog, recentModels, modelFacts, lineageById, lineageProgress, toggleCompareSelection, discoveryMode } = discovery;

function model(id, fields = {}) {
  return {
    id, series: id.split('-')[0], number: Number(id.split('-')[1]), name: '高达', nameJa: 'ガンダム',
    nameEn: 'Gundam', releaseDate: '2026-01', price: 2000, priceTaxFree: 1800,
    imageUrl: '', productUrl: '', isLimited: false, ...fields,
  };
}
const ids = (items) => Array.from(items, (item) => item.id);

test('全局搜索覆盖跨等级中日英、型号、编号和全角输入', () => {
  const models = [
    model('hg-001', { name: 'RX-78-2 高达', tags: ['联邦'] }),
    model('rg-032', { name: 'ν高达', nameJa: 'νガンダム', nameEn: 'Nu Gundam' }),
    model('mg-114', { name: 'Hi-ν高达', nameJa: 'Hi-νガンダム', nameEn: 'Hi-Nu Gundam' }),
  ];
  assert.deepEqual(ids(searchCatalog(models, '高达')), ['hg-001', 'rg-032', 'mg-114']);
  assert.deepEqual(ids(searchCatalog(models, 'νガンダム')), ['rg-032', 'mg-114']);
  assert.deepEqual(ids(searchCatalog(models, 'hi nu')), ['mg-114']);
  assert.deepEqual(ids(searchCatalog(models, 'ＲＧ－０３２')), ['rg-032']);
  assert.deepEqual(ids(searchCatalog(models, 'rg32')), ['rg-032']);
  assert.deepEqual(ids(searchCatalog(models, 'RX 78 2')), ['hg-001']);
  assert.deepEqual(ids(searchCatalog(models, '联邦')), ['hg-001']);
  assert.deepEqual(ids(searchCatalog(models, 'ZAKU')), []);
});

test('搜索空值和缺失可选字段不会丢失目录或修改原数组', () => {
  const models = [model('hg-001', { name: null, nameJa: undefined, nameEn: null, tags: null })];
  assert.deepEqual(ids(searchCatalog(models, null)), ['hg-001']);
  assert.deepEqual(ids(searchCatalog(models, '   ')), ['hg-001']);
  assert.deepEqual(ids(searchCatalog(models, '不存在')), []);
  assert.deepEqual(ids(searchCatalog(models, 'constructor')), []);
  assert.notEqual(searchCatalog(models, ''), models);
});

test('近期目录按有效年月日降序，保留未来日期并排除无效日期', () => {
  const models = [
    model('hg-001', { releaseDate: '2026-01' }),
    model('rg-002', { releaseDate: '2026-01-15' }),
    model('mg-003', { releaseDate: '2027-02' }),
    model('pg-004', { releaseDate: '' }),
    model('hg-005', { releaseDate: '2026-13' }),
    model('hg-006', { releaseDate: '2026-02-30' }),
    model('hg-007', { releaseDate: '2026-00' }),
  ];
  assert.deepEqual(ids(recentModels(models)), ['mg-003', 'rg-002', 'hg-001']);
  assert.equal(models[0].id, 'hg-001');
});

test('模型对比只使用目录等级比例、官方日元价、日期与限定属性', () => {
  assert.equal(modelFacts(model('hg-001')).scale, '1/144');
  assert.equal(modelFacts(model('rg-001')).scale, '1/144');
  assert.equal(modelFacts(model('mg-001')).scale, '1/100');
  assert.equal(modelFacts(model('pg-001')).scale, '1/60');
  assert.equal(modelFacts(model('rg-001')).priceText, '¥2,000 日元');
  assert.equal(modelFacts(model('rg-001', { price: 0, releaseDate: '' })).priceText, '未收录');
  assert.equal(modelFacts(model('rg-001', { price: NaN })).priceText, '未收录');
  assert.equal(modelFacts(model('rg-001', { isLimited: true, limitedType: 'pbandai' })).limitedText, 'PB 限定');
});

test('三个精选关系逐项映射本地目录及同一官方商品来源', () => {
  const models = ['hg', 'rg', 'mg', 'pg'].flatMap((code) => JSON.parse(fs.readFileSync(path.join(__dirname, `../miniprogram/data/${code}.json`), 'utf8')));
  const catalog = new Map(models.map((item) => [item.id, item]));
  assert.equal(lineages.LINEAGES.length, 3);
  for (const lineage of lineages.LINEAGES) {
    assert.equal(new Set(lineage.entries.map((entry) => entry.modelId)).size, lineage.entries.length);
    for (const entry of lineage.entries) {
      const mapped = catalog.get(entry.modelId);
      assert.ok(mapped, entry.modelId);
      assert.equal(mapped.series, entry.series);
      assert.equal(mapped.productUrl, entry.productUrl);
      assert.match(entry.productUrl, /^https:\/\/bandai-hobby\.net\/item\//);
      assert.doesNotMatch(mapped.nameJa, /デカール|LEDユニット|拡張ユニット/);
    }
  }
  assert.deepEqual(Array.from(lineageById('nu').entries, (entry) => entry.modelId), ['rg-032', 'rg-036', 'mg-033', 'mg-114', 'pg-031']);
  assert.equal(lineageById('invalid').id, 'rx78');
});

test('谱系只计算实际映射的目录，未知入手状态不伪造零进度', () => {
  const lineage = { id: 'selected', name: 'selected', subtitle: '', entries: [
    { modelId: 'rg-001', variant: 'one' }, { modelId: 'mg-002', variant: 'two' }, { modelId: 'pg-003', variant: 'missing' },
  ] };
  const models = [model('rg-001'), model('mg-002'), model('hg-004', { name: 'selected' })];
  const purchases = [{ modelId: 'rg-001' }, { modelId: 'rg-001' }, { modelId: 'pg-003' }, { modelId: 'hg-004' }];
  const progress = lineageProgress(lineage, models, purchases, true);
  assert.equal(progress.total, 2);
  assert.equal(progress.owned, 1);
  assert.equal(progress.percent, 50);
  assert.equal(progress.entries[2].status, '目录未收录');
  const unknown = lineageProgress(lineage, models, purchases, false);
  assert.equal(unknown.progressText, '待同步 / 2');
  assert.equal(unknown.entries[0].status, '入手状态待同步');
  assert.equal(unknown.entries[0].owned, false);
  assert.equal(lineageProgress(lineage, [], purchases, true).percent, 0);
});

test('两台PK选择最多两台且不重复，点击已有模型移除', () => {
  const original = ['rg-001'];
  assert.deepEqual(Array.from(toggleCompareSelection(original, 'mg-002').ids), ['rg-001', 'mg-002']);
  assert.deepEqual(original, ['rg-001']);
  assert.deepEqual(Array.from(toggleCompareSelection(original, 'rg-001').ids), []);
  const full = toggleCompareSelection(['rg-001', 'mg-002'], 'pg-003');
  assert.equal(full.full, true);
  assert.deepEqual(Array.from(full.ids), ['rg-001', 'mg-002']);
  assert.deepEqual(Array.from(toggleCompareSelection(['rg-001', 'rg-001'], '').ids), ['rg-001']);
});

test('无效发现模式回退搜索', () => {
  for (const mode of [undefined, '', 'bad', 'SEARCH']) assert.equal(discoveryMode(mode), 'search');
  for (const mode of ['new', 'lineage', 'compare']) assert.equal(discoveryMode(mode), mode);
});


test('真实目录缺少英文全名时，明确的常用英文别名仍可检索', () => {
  const models = ['hg', 'rg', 'mg', 'pg'].flatMap((code) => JSON.parse(fs.readFileSync(path.join(__dirname, `../miniprogram/data/${code}.json`), 'utf8')));
  for (const [keyword, expected] of [['RX-78-2 Gundam', 'rg-001'], ['Unicorn Gundam', 'rg-025'], ['Nu Gundam', 'rg-032'], ['Hi-Nu Gundam', 'rg-036']]) {
    assert.ok(searchCatalog(models, keyword).some((item) => item.id === expected), keyword);
  }
  assert.ok(searchCatalog(models, 'Zaku').some((item) => item.nameJa.includes('ザク')));
});
