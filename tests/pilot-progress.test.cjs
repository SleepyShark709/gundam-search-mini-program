const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

const { pilotProgress } = loadModule('miniprogram/utils/pilot-progress.ts').exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const purchase = (modelId, patch = {}) => ({
  modelId, priceCny: 100, purchaseDate: '2026-01-01', channel: null, note: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...patch,
});
const build = (modelId, patch = {}) => ({ modelId, quantity: 1, completedCount: 0, buildingCount: 0, goal: '', goalDoneDate: null, ...patch });
const models = [{ id: 'hg-001', series: 'hg' }, { id: 'rg-002', series: 'rg' }, { id: 'mg-003', series: 'mg' }, { id: 'pg-004', series: 'pg' }];

test('驾驶员评级不使用购买金额、购买渠道或购买日期间隔', () => {
  const purchases = [purchase('hg-001'), purchase('rg-002', { purchaseDate: '2026-10-01' })];
  const progress = [build('hg-001', { completedCount: 1 }), build('rg-002', { buildingCount: 1, goal: '完成头部' })];
  const baseline = plain(pilotProgress(purchases, models, progress));
  const expensive = purchases.map((item) => ({ ...item, priceCny: 999999, channel: '高价渠道', purchaseDate: '2026-10-01', createdAt: '2026-10-01T00:00:00Z' }));
  assert.deepEqual(plain(pilotProgress(expensive, models, progress)), baseline);
  assert.deepEqual(plain(pilotProgress(purchases.map((item) => ({ ...item, priceCny: null })), models, progress)), baseline);
});

test('盒数进入完工与整备分母，没有进度的购买默认一盒', () => {
  const purchases = [purchase('hg-001'), purchase('rg-002')];
  const progress = [build('hg-001', { quantity: 3, completedCount: 1, buildingCount: 1 })];
  const result = pilotProgress(purchases, models, progress);
  assert.equal(result.dimensions[0], 1 / 4);
  assert.equal(result.dimensions[1], 2 / 4);
  assert.equal(result.details[0].valueText, '1/4盒');
  assert.equal(result.details[1].valueText, '2/4盒');
  const moreBoxes = pilotProgress(purchases, models, [build('hg-001', { quantity: 9, completedCount: 1, buildingCount: 1 })]);
  assert.equal(moreBoxes.dimensions[0], 1 / 10);
  assert.ok(moreBoxes.score < result.score);
});

test('开始拼装、完成模型和达成目标分别提升评级，仅填写目标不虚增分数', () => {
  const purchases = [purchase('hg-001')];
  const idle = pilotProgress(purchases, models, [build('hg-001')]);
  const planned = pilotProgress(purchases, models, [build('hg-001', { goal: '完成头部' })]);
  assert.equal(planned.score, idle.score);
  const building = pilotProgress(purchases, models, [build('hg-001', { buildingCount: 1 })]);
  const completed = pilotProgress(purchases, models, [build('hg-001', { completedCount: 1 })]);
  const goalDone = pilotProgress(purchases, models, [build('hg-001', { completedCount: 1, goal: '完成头部', goalDoneDate: '2026-01-01' })]);
  assert.ok(building.score > idle.score);
  assert.ok(completed.score > building.score);
  assert.ok(goalDone.score > completed.score);
  assert.equal(goalDone.details[4].valueText, '1/1款');
});

test('已经删除或属于其他账号的进度不计入评级，目录外已购买模型仍计入盒数', () => {
  const purchases = [purchase('hg-001'), purchase('unknown-model')];
  const progress = [build('hg-001', { completedCount: 1 })];
  const baseline = pilotProgress(purchases, models, progress);
  const withOrphan = pilotProgress(purchases, models, [...progress, build('rg-002', { quantity: 999, completedCount: 999, goalDoneDate: '2026-01-01' })]);
  assert.deepEqual(plain(withOrphan), plain(baseline));
  assert.equal(baseline.details[0].valueText, '1/2盒');
  assert.equal(baseline.details[3].valueText, '1/4系列');
});

test('没有购买记录时评级为零；各维度齐全可达到满分并保持数值有限', () => {
  const empty = pilotProgress([], models, []);
  assert.equal(empty.score, 0);
  assert.deepEqual(plain(empty.dimensions), [0, 0, 0, 0, 0]);
  assert.ok(empty.tip.length > 0);
  const full = pilotProgress(models.map((item) => purchase(item.id)), models,
    models.map((item) => build(item.id, { completedCount: 1, goal: '已完成', goalDoneDate: '2026-01-01' })));
  assert.equal(full.score, 100);
  assert.deepEqual(plain(full.dimensions), [1, 1, 1, 1, 1]);
  assert.ok(full.details.every((item) => Number.isFinite(item.percent)));
});

test('重复购买次数不增加纯消费分：相同整备比例与同系列探索维持同一评级', () => {
  const one = pilotProgress([purchase('hg-001')], models, [build('hg-001', { completedCount: 1 })]);
  const moreModels = [{ id: 'hg-001', series: 'hg' }, { id: 'hg-002', series: 'hg' }, { id: 'hg-003', series: 'hg' }];
  const several = pilotProgress(moreModels.map((item) => purchase(item.id)), moreModels,
    moreModels.map((item) => build(item.id, { completedCount: 1 })));
  assert.equal(several.score, one.score);
  assert.deepEqual(plain(several.dimensions), plain(one.dimensions));
});
