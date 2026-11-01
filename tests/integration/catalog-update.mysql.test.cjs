const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const { createMysqlFixture } = require('../helpers/mysql-fixture.cjs');

const root = path.resolve(__dirname, '../..');
const updatePath = path.join(root, 'server/data-updates/2026-11-01');
const run = promisify(execFile);
const seriesCodes = ['hg', 'rg', 'mg', 'pg'];
const columns = ['id', 'series', 'number', 'name', 'name_ja', 'name_en', 'price', 'price_tax_free',
  'release_date', 'is_limited', 'limited_type', 'image_url', 'product_url', 'tags'];

function modelRow(model) {
  return {
    id: model.id, series: model.series, number: model.number, name: model.name,
    name_ja: model.nameJa, name_en: model.nameEn || null, price: model.price,
    price_tax_free: model.priceTaxFree ?? 0, release_date: model.releaseDate || null,
    is_limited: Number(Boolean(model.isLimited)), limited_type: model.limitedType || null,
    image_url: model.imageUrl, product_url: model.productUrl, tags: model.tags || null,
  };
}

test('2026-11-01 发布目录 SQL 在真实旧目录上更新、重跑和回退', {
  skip: process.env.MYSQL_INTEGRATION === '1' ? false : '请显式设置 MYSQL_INTEGRATION=1，并使用 MYSQL_TEST_* 指向本机测试实例',
  timeout: 60000,
}, async (t) => {
  const manifest = JSON.parse(await fs.readFile(path.join(updatePath, 'manifest.json'), 'utf8'));
  const oldModels = [];
  const currentModels = [];
  for (const series of seriesCodes) {
    const { stdout } = await run('git', ['show', `aaf2465:miniprogram/data/${series}.json`], {
      cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 10000,
    });
    const before = JSON.parse(stdout);
    const after = JSON.parse(await fs.readFile(path.join(root, `miniprogram/data/${series}.json`), 'utf8'));
    const summary = manifest.summary.find((entry) => entry.series === series);
    assert.equal(before.length, summary.before, `${series} 旧提交数量`);
    assert.equal(after.length, summary.after, `${series} 当前目录数量`);
    assert.equal(after.length - before.length, summary.added, `${series} 新增数量`);
    assert.equal(manifest.priceChanges.filter((entry) => entry.series === series).length, summary.priceChanges);
    oldModels.push(...before);
    currentModels.push(...after);
  }
  const oldById = new Map(oldModels.map((model) => [model.id, model]));
  const currentById = new Map(currentModels.map((model) => [model.id, model]));
  const additions = currentModels.filter((model) => !oldById.has(model.id));
  const priceChanges = currentModels.filter((model) => oldById.has(model.id)
    && (model.price !== oldById.get(model.id).price || model.priceTaxFree !== oldById.get(model.id).priceTaxFree));
  assert.deepEqual(new Set(additions.map((model) => model.id)), new Set(manifest.additions.map((model) => model.id)));
  assert.deepEqual(new Set(priceChanges.map((model) => model.id)), new Set(manifest.priceChanges.map((model) => model.id)));
  for (const change of manifest.priceChanges) {
    for (const key of ['price', 'priceTaxFree']) {
      assert.equal(oldById.get(change.id)[key], change.before[key]);
      assert.equal(currentById.get(change.id)[key], change.after[key]);
    }
  }
  for (const addition of manifest.additions) assert.deepEqual(modelRow(currentById.get(addition.id)), modelRow(addition));

  const { connection, database, close } = await createMysqlFixture();
  t.after(async () => {
    await close();
    t.diagnostic(`已验证目录验收随机库 ${database} 完整清理`);
  });
  const query = (sql, values) => connection.query({ sql, timeout: 10000 }, values);
  await query('DELETE FROM models');
  await query('DELETE FROM series_meta');
  for (let offset = 0; offset < oldModels.length; offset += 200) {
    const values = oldModels.slice(offset, offset + 200).map((model) => Object.values(modelRow(model))
      .map((value, index) => columns[index] === 'tags' && value !== null ? JSON.stringify(value) : value));
    await query(`INSERT INTO models (${columns.join(', ')}) VALUES ?`, [values]);
  }
  for (const summary of manifest.summary) {
    await query(`INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count)
      VALUES (?, ?, ?, ?, ?, ?)`, [summary.series, `已有${summary.series}名称`, summary.series.toUpperCase(), '保留比例', '/images/existing-cover.jpg', summary.before]);
  }
  await query("INSERT INTO users (openid, nickname, avatar_url) VALUES ('catalog-sentinel', '保留昵称', 'cloud://integration/avatar.jpg')");
  await query("UPDATE purchases SET price_cny = 123.45, purchase_date = '2026-01-01', channel = '保留渠道', note = '保留备注' WHERE openid = 'migration-user'");
  await query("INSERT INTO build_progress (purchase_id, quantity, completed_count, goal) SELECT id, 3, 1, '保留整备目标' FROM purchases WHERE openid = 'migration-user'");
  await query('INSERT INTO share_snapshots (id, openid, payload) VALUES (?, ?, ?)', [
    'b'.repeat(32), 'migration-user', JSON.stringify({ kind: 'wishlist', title: '保留分享', models: [] }),
  ]);
  await query('INSERT INTO model_images (model_id, image_url, sort_order) VALUES (?, ?, ?)', [oldModels[0].id, '/images/existing-detail.jpg', 7]);
  const protectedTables = ['users', 'wishlists', 'purchases', 'build_progress', 'share_snapshots', 'model_images'];
  async function protectedRows() {
    const result = {};
    for (const table of protectedTables) {
      const [rows] = await query(`SELECT * FROM ${table} ORDER BY ${table === 'build_progress' ? 'purchase_id' : 'id'}`);
      result[table] = rows;
    }
    return result;
  }
  async function catalogRows() {
    const [rows] = await query(`SELECT ${columns.join(', ')} FROM models ORDER BY id`);
    return rows.map((row) => ({ ...row }));
  }
  const sortRows = (models) => models.map(modelRow).sort((left, right) => left.id.localeCompare(right.id));
  const privateBefore = await protectedRows();
  const [metaBefore] = await query('SELECT code, name, short_name, scale, cover_image FROM series_meta ORDER BY code');
  assert.equal(privateBefore.purchases[0].openid, 'migration-user');
  assert.equal(privateBefore.wishlists[0].openid, 'migration-user');
  const applySql = await fs.readFile(path.join(updatePath, 'apply.sql'), 'utf8');
  const transactionStart = applySql.indexOf('START TRANSACTION;');
  assert.ok(transactionStart > 0, '发布 SQL 应先人工预检再开始事务');
  const [preflight] = await query(applySql.slice(0, transactionStart));
  const preflightRows = preflight.filter(Array.isArray);
  assert.equal(preflightRows.length, 1);
  assert.equal(preflightRows[0].length, 0, 'ID/产品URL预检不为空时必须停止，不能执行发布事务');
  t.diagnostic('原发布SQL的预检SELECT不会自动阻断；本测试已先独立执行预检并确认空结果，实际发布同样必须人工执行此步骤');

  let afterFirst;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [results] = await query(applySql);
    const rowsets = results.filter(Array.isArray);
    assert.equal(rowsets.length, 5, '预检、两张统计表、新增和价格验收结果均应返回');
    assert.equal(rowsets[0].length, 0, '发布过程中预检也应保持为空');
    assert.equal(rowsets.at(-2).length, 0, '脚本自带新增ID/URL/图片验收必须为空');
    assert.equal(rowsets.at(-1).length, 0, '脚本自带价格验收必须为空');
    const rows = await catalogRows();
    assert.deepEqual(rows, sortRows(currentModels), '全目录必须与当前本地JSON一致；既有名称、日期、图片等字段保持');
    if (attempt === 0) afterFirst = rows;
    else assert.deepEqual(rows, afterFirst, '第二次执行不得重复插入或改变价格');
    const [counts] = await query('SELECT series, COUNT(*) AS count FROM models GROUP BY series ORDER BY series');
    const [metadata] = await query('SELECT code, total_count FROM series_meta ORDER BY code');
    const expectedCounts = manifest.summary.map((entry) => ({ series: entry.series, count: entry.after })).sort((a, b) => a.series.localeCompare(b.series));
    assert.deepEqual(counts.map((row) => ({ ...row })), expectedCounts);
    assert.deepEqual(metadata.map((row) => ({ series: row.code, count: row.total_count })), expectedCounts);
    const [metaAfter] = await query('SELECT code, name, short_name, scale, cover_image FROM series_meta ORDER BY code');
    assert.deepEqual(metaAfter, metaBefore, '更新系列计数必须保留已有系列名称、比例和封面');
    assert.deepEqual(await protectedRows(), privateBefore, '发布SQL不得改变用户、购买、心愿、进度、分享和详情图片数据');
  }

  const rollbackSql = await fs.readFile(path.join(updatePath, 'rollback-prices.sql'), 'utf8');
  await query(rollbackSql);
  assert.deepEqual(await catalogRows(), sortRows([...oldModels, ...additions]), '回退只恢复220个既有价格，保留50个新增模型及其所有字段');
  assert.deepEqual(await protectedRows(), privateBefore, '价格回退也不得改变任何用户或图片关联');
  const [rollbackCounts] = await query('SELECT code, total_count FROM series_meta ORDER BY code');
  assert.deepEqual(rollbackCounts.map((row) => ({ series: row.code, count: row.total_count })), manifest.summary
    .map((entry) => ({ series: entry.series, count: entry.after })).sort((a, b) => a.series.localeCompare(b.series)));
  t.diagnostic(`真实旧目录 ${oldModels.length} → ${currentModels.length}；新增 ${additions.length}，官方价格 ${priceChanges.length}；apply两次与价格rollback均通过`);
  t.diagnostic(`零数据变化：${protectedTables.map((table) => `${table}=${privateBefore[table].length}行`).join('，')}`);
});
