const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createMysqlFixture } = require('../helpers/mysql-fixture.cjs');

const enabled = process.env.MYSQL_INTEGRATION === '1';
const modelIds = ['hg-001', 'hg-002', 'hg-003'];
const owner = 'integration-owner';
const other = 'integration-other';
const featureEnvNames = ['FEATURE_DISCOVERY', 'FEATURE_SHARING', 'FEATURE_SQUAD', 'FEATURE_QUIZ',
  'FEATURE_BUILDS', 'FEATURE_LINEAGE', 'FEATURE_COMPARE', 'FEATURE_PILOT_RATING'];

test('真实 MySQL 与 HTTP 机库集成验收', {
  skip: enabled ? false : '请显式设置 MYSQL_INTEGRATION=1，并使用 MYSQL_TEST_* 指向本机测试实例',
  timeout: 60000,
}, async (t) => {
  const authEnvNames = ['DOTENV_CONFIG_PATH', 'NODE_ENV', 'ALLOW_LOCAL_MOCK_AUTH', 'WX_APPID', ...featureEnvNames];
  const environmentBefore = authEnvNames.map((name) => process.env[name]);
  const { connection, baseUrl, database, close } = await createMysqlFixture();
  assert.equal(process.env.NODE_ENV, 'production');
  assert.equal(process.env.ALLOW_LOCAL_MOCK_AUTH, 'false');
  for (const name of featureEnvNames) assert.equal(process.env[name], 'true', `${name} 旧验收须显式开启`);
  t.after(async () => {
    await close();
    assert.deepEqual(authEnvNames.map((name) => process.env[name]), environmentBefore, 'fixture必须恢复dotenv、认证及功能开关环境变量');
    t.diagnostic(`已验证随机测试库 ${database} 完整清理`);
  });
  await t.test('迁移在旧表结构上创建机库表，重复执行保留既有用户数据', async () => {
    const [tables] = await connection.query("SHOW TABLES WHERE Tables_in_" + database + " IN ('build_progress', 'share_snapshots')");
    assert.equal(tables.length, 2);
    for (const table of ['purchases', 'wishlists']) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${table} WHERE openid = 'migration-user'`);
      assert.equal(rows[0].count, 1);
    }
  });

  async function request(method, route, { as, body, status = 200, headers: suppliedHeaders } = {}) {
    const headers = { ...suppliedHeaders };
    if (as) Object.assign(headers, { 'X-WX-OPENID': as, 'X-WX-SOURCE': 'wx_devtools', 'X-WX-APPID': 'wx422623fec834054c' });
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }
  const progress = { quantity: 3, completedCount: 1, buildingCount: 1, goal: '完成主体', goalDoneDate: null };
  let snapshot;
  let quizSnapshotId;

  await t.test('健康检查、鉴权、公开错误与目录字段类型符合实际 HTTP 合同', async () => {
    assert.equal((await request('GET', '/')).status, 'ok');
    for (const route of ['/api/wishlist', '/api/purchases', '/api/builds']) {
      assert.match((await request('GET', route, { status: 401 })).error, /未授权/);
      await request('GET', route, { headers: { 'X-WX-OPENID': owner }, status: 401 });
      await request('GET', route, { headers: { 'X-WX-OPENID': owner, 'X-WX-APPID': 'wx422623fec834054c' }, status: 401 });
      await request('GET', route, { headers: { 'X-WX-OPENID': owner, 'X-WX-SOURCE': 'wx_devtools', 'X-WX-APPID': 'wrong-appid' }, status: 401 });
      await request('GET', route, { headers: { 'X-WX-OPENID': owner, 'X-Forwarded-For': '127.0.0.1' }, status: 401 });
    }
    await request('POST', '/api/shares', { body: {}, status: 401 });
    for (const name of ['X-WX-OPENID', 'X-WX-SOURCE', 'X-WX-APPID']) {
      const headers = { 'X-WX-OPENID': owner, 'X-WX-SOURCE': 'wx_devtools', 'X-WX-APPID': 'wx422623fec834054c' };
      headers[name] = [headers[name], headers[name]];
      const status = await new Promise((resolve, reject) => {
        const request = http.get(`${baseUrl}/api/wishlist`, { headers, timeout: 5000 }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error('重复来源头验收超时')));
      });
      assert.equal(status, 401, `实际HTTP重复的${name}必须拒绝`);
    }
    await request('GET', '/api/shares/invalid', { status: 404 });
    await request('GET', `/api/shares/${'f'.repeat(32)}`, { status: 404 });
    await request('GET', '/api/not-a-route', { as: owner, status: 404 });
    await request('GET', '/api/models/invalid', { status: 400 });
    const { data } = await request('GET', '/api/models/hg');
    assert.deepEqual(data.map((model) => model.id), modelIds);
    for (const [index, model] of data.entries()) {
      assert.equal(typeof model.number, 'number');
      assert.equal(typeof model.price, 'number');
      assert.equal(typeof model.priceTaxFree, 'number');
      assert.equal(typeof model.isLimited, 'boolean');
      assert.equal(model.isLimited, index === 1);
      assert.deepEqual(model.tags, ['高达', 'UC']);
    }
    const meta = await request('GET', '/api/series-meta');
    assert.equal(meta.data[0].totalCount, 3);
  });

  await t.test('心愿单增删、去重和批量事务只影响当前用户', async () => {
    await request('POST', '/api/wishlist', { as: owner, body: { modelId: modelIds[0], openid: other } });
    await request('POST', '/api/wishlist', { as: owner, body: { modelId: modelIds[0] } });
    assert.equal((await request('POST', '/api/wishlist/batch', { as: owner, body: { modelIds } })).added, 2);
    assert.deepEqual(new Set((await request('GET', '/api/wishlist', { as: owner })).modelIds), new Set(modelIds));
    assert.deepEqual((await request('GET', '/api/wishlist', { as: other })).modelIds, []);
    await request('POST', '/api/wishlist', { as: other, body: { modelId: modelIds[0] } });
    await request('DELETE', `/api/wishlist/${modelIds[0]}`, { as: owner });
    assert.deepEqual((await request('GET', '/api/wishlist', { as: other })).modelIds, [modelIds[0]]);
    assert.equal((await request('GET', '/api/wishlist', { as: owner })).modelIds.length, 2);
    await request('POST', '/api/wishlist', { as: owner, body: {}, status: 400 });
    await request('POST', '/api/wishlist/batch', { as: owner, body: { modelIds: [modelIds[0], 1] }, status: 400 });
  });

  await t.test('购买记录 CRUD、冲突与跨用户修改隔离使用真实 SQL', async () => {
    await request('POST', '/api/purchases', { as: owner, body: {
      modelId: modelIds[0], priceCny: 88.5, purchaseDate: '2026-01-31', channel: '私人渠道', note: '私人备注', openid: other,
    } });
    await request('POST', '/api/purchases', { as: owner, body: { modelId: modelIds[0] }, status: 409 });
    await request('POST', '/api/purchases', { as: other, body: { modelId: modelIds[1] } });
    const purchases = (await request('GET', '/api/purchases', { as: owner })).purchases;
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].priceCny, 88.5);
    assert.equal(purchases[0].channel, '私人渠道');
    assert.deepEqual((await request('GET', '/api/purchases', { as: other })).purchases.map((purchase) => purchase.modelId), [modelIds[1]]);
    await request('PUT', `/api/purchases/${modelIds[0]}`, { as: other, body: { priceCny: 1 }, status: 404 });
    await request('DELETE', `/api/purchases/${modelIds[0]}`, { as: other, status: 404 });
    await request('PUT', `/api/purchases/${modelIds[0]}`, { as: owner, body: { priceCny: 99, note: '更新备注' } });
    assert.equal((await request('GET', '/api/purchases', { as: owner })).purchases[0].priceCny, 99);
    await request('PUT', `/api/purchases/${modelIds[0]}`, { as: owner, body: {}, status: 400 });
  });

  await t.test('默认一盒进度、合法计数和日期、重复保存与所有权约束', async () => {
    const defaults = { modelId: modelIds[0], quantity: 1, completedCount: 0, buildingCount: 0, goal: '', goalDoneDate: null };
    assert.deepEqual((await request('GET', '/api/builds', { as: owner })).builds, [defaults]);
    await request('PUT', `/api/builds/${modelIds[0]}`, { as: other, body: progress, status: 404 });
    await request('PUT', `/api/builds/${modelIds[1]}`, { as: owner, body: progress, status: 404 });
    for (let index = 0; index < 2; index += 1) {
      await request('PUT', `/api/builds/${modelIds[0]}`, { as: owner, body: { ...progress, openid: other } });
    }
    assert.deepEqual((await request('GET', '/api/builds', { as: owner })).builds, [{ modelId: modelIds[0], ...progress }]);
    const invalid = [
      { quantity: 0 }, { quantity: 1000 }, { quantity: 1.5 }, { quantity: '3' },
      { completedCount: -1 }, { completedCount: 3 }, { buildingCount: 3 },
      { goal: '字'.repeat(101) }, { goalDoneDate: '2025-02-29' }, { goalDoneDate: '2026-02-30' },
      { goalDoneDate: '0000-01-01' }, { goalDoneDate: '2999-01-01' }, { goalDoneDate: '' },
    ];
    for (const patch of invalid) await request('PUT', `/api/builds/${modelIds[0]}`, { as: owner, body: { ...progress, ...patch }, status: 400 });
    assert.deepEqual((await request('GET', '/api/builds', { as: owner })).builds, [{ modelId: modelIds[0], ...progress }]);
    await request('PUT', `/api/builds/${modelIds[0]}`, { as: owner, body: { ...progress, goalDoneDate: '2024-02-29' } });
    assert.equal((await request('GET', '/api/builds', { as: owner })).builds[0].goalDoneDate, '2024-02-29');
    assert.deepEqual((await request('GET', '/api/builds', { as: other })).builds, [{ ...defaults, modelId: modelIds[1] }]);
  });

  await t.test('六类公开分享不可变，只复制目录且不泄露私人金额和账号', async () => {
    const inputs = [
      { kind: 'purchased', modelIds: [modelIds[0]] },
      { kind: 'wishlist', modelIds: [modelIds[1]] },
      { kind: 'squad', modelIds, captainId: modelIds[1] },
      { kind: 'compare', modelIds: modelIds.slice(0, 2) },
      { kind: 'report', modelIds, report: { quantity: 3, completedCount: 1, buildingCount: 1 } },
    ];
    for (const input of inputs) {
      const { id } = await request('POST', '/api/shares', { as: owner, body: {
        ...input, title: '公开清单', priceCny: 999, openid: other, note: '私人备注', models: [{ name: '伪造模型' }],
      } });
      const value = await request('GET', `/api/shares/${id}`);
      assert.equal(value.kind, input.kind);
      assert.deepEqual(value.models.map((model) => model.id), input.modelIds);
      for (const model of value.models) {
        assert.equal(typeof model.price, 'number');
        assert.equal(typeof model.isLimited, 'boolean');
      }
      assert.doesNotMatch(JSON.stringify(value), /priceCny|price_cny|openid|purchaseDate|私人备注|私人渠道|伪造模型/);
      if (input.kind === 'purchased') snapshot = value;
    }
    await connection.query('UPDATE models SET name = ? WHERE id = ?', ['已修改目录名称', modelIds[0]]);
    await request('PUT', `/api/purchases/${modelIds[0]}`, { as: owner, body: { priceCny: 777 } });
    assert.deepEqual(await request('GET', `/api/shares/${snapshot.id}`), snapshot);
    await request('PUT', `/api/shares/${snapshot.id}`, { as: owner, body: { title: '覆盖' }, status: 404 });
    await request('POST', '/api/shares', { as: owner, body: { kind: 'compare', title: '无效', modelIds: [modelIds[0]] }, status: 400 });
    await request('POST', '/api/shares', { as: owner, body: { kind: 'wishlist', title: '缺失模型', modelIds: ['hg-999'] }, status: 400 });
  });

  await t.test('quiz GET 隐藏答案，公开 POST 使用快照核分并拒绝无效选项', async () => {
    const questions = modelIds.map((answerId, index) => ({ prompt: `第 ${index + 1} 题`, optionIds: modelIds, answerId }));
    const { id } = await request('POST', '/api/shares', { as: owner, body: { kind: 'quiz', title: '认机挑战', modelIds, questions } });
    quizSnapshotId = id;
    const value = await request('GET', `/api/shares/${id}`);
    assert.equal(value.questions.length, 3);
    assert.doesNotMatch(JSON.stringify(value), /answerId|correctAnswers|quiz_answers|openid/);
    assert.deepEqual(await request('POST', `/api/shares/${id}/answers`, { body: { answers: [modelIds[0], modelIds[0], modelIds[2]], score: 3 } }), {
      score: 2, total: 3, correctAnswers: modelIds,
    });
    for (const answers of [[], modelIds.slice(0, 2), [modelIds[0], modelIds[1], 3], ['hg-999', ...modelIds.slice(1)]]) {
      await request('POST', `/api/shares/${id}/answers`, { body: { answers }, status: 400 });
    }
    await request('POST', `/api/shares/${snapshot.id}/answers`, { body: { answers: modelIds }, status: 400 });
    await request('POST', `/api/shares/${'f'.repeat(32)}/answers`, { body: { answers: modelIds }, status: 404 });
    await request('POST', '/api/shares/invalid/answers', { body: { answers: modelIds }, status: 404 });
  });

  await t.test('删除购买通过外键级联清理进度，其他用户和既有分享保留', async () => {
    const [before] = await connection.query('SELECT COUNT(*) AS count FROM build_progress');
    assert.equal(before[0].count, 1);
    await request('DELETE', `/api/purchases/${modelIds[0]}`, { as: owner });
    assert.deepEqual((await request('GET', '/api/purchases', { as: owner })).purchases, []);
    assert.deepEqual((await request('GET', '/api/builds', { as: owner })).builds, []);
    const [after] = await connection.query('SELECT COUNT(*) AS count FROM build_progress');
    assert.equal(after[0].count, 0);
    assert.equal((await request('GET', '/api/purchases', { as: other })).purchases.length, 1);
    assert.deepEqual(await request('GET', `/api/shares/${snapshot.id}`), snapshot);
    await request('PUT', `/api/builds/${modelIds[0]}`, { as: owner, body: progress, status: 404 });
    await request('DELETE', `/api/purchases/${modelIds[0]}`, { as: owner, status: 404 });
    await request('DELETE', `/api/purchases/${modelIds[1]}`, { as: other });
  });

  await t.test('八项功能全关时公开配置不缓存，基础目录、收藏、购买和用户仍可用', async () => {
    const previous = featureEnvNames.map((name) => process.env[name]);
    for (const name of featureEnvNames) process.env[name] = 'false';
    try {
      const response = await fetch(`${baseUrl}/api/features`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, '公开配置无需微信身份');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { version: 1, features: {
        discovery: false, sharing: false, squad: false, quiz: false,
        builds: false, lineage: false, compare: false, pilotRating: false,
      } });
      assert.equal((await request('GET', '/api/models/hg')).data.length, 3);
      assert.equal((await request('GET', '/api/series-meta')).data.length, 1);
      const as = 'all-features-disabled';
      await request('POST', '/api/wishlist', { as, body: { modelId: modelIds[0] } });
      assert.deepEqual((await request('GET', '/api/wishlist', { as })).modelIds, [modelIds[0]]);
      await request('DELETE', `/api/wishlist/${modelIds[0]}`, { as });
      await request('POST', '/api/purchases', { as, body: { modelId: modelIds[0], priceCny: 88 } });
      await request('PUT', `/api/purchases/${modelIds[0]}`, { as, body: { priceCny: 99 } });
      assert.equal((await request('GET', '/api/purchases', { as })).purchases[0].priceCny, 99);
      await request('DELETE', `/api/purchases/${modelIds[0]}`, { as });
      await request('POST', '/api/user/profile', { as, body: { nickname: '基础用户' } });
      assert.equal((await request('GET', '/api/user/profile', { as })).nickname, '基础用户');
      for (const [method, route, body] of [
        ['GET', '/api/builds'], ['PUT', `/api/builds/${modelIds[0]}`, progress],
        ['POST', '/api/shares', { kind: 'wishlist', title: '清单', modelIds }],
        ['GET', `/api/shares/${snapshot.id}`],
        ['POST', `/api/shares/${quizSnapshotId}/answers`, { answers: modelIds }],
      ]) {
        assert.deepEqual(await request(method, route, { as, body, status: 403 }), {
          code: 'FEATURE_DISABLED', error: '该功能暂未开放',
        });
      }
    } finally {
      featureEnvNames.forEach((name, index) => { process.env[name] = previous[index]; });
    }
  });

  await t.test('开启堆积但尚未迁移时 HTTP 明确返回不可用，基础购买仍正常', async () => {
    await connection.query('DROP TABLE build_progress');
    for (const [method, route, body] of [['GET', '/api/builds'], ['PUT', `/api/builds/${modelIds[0]}`, progress]]) {
      assert.deepEqual(await request(method, route, { as: owner, body, status: 503 }), {
        code: 'FEATURE_UNAVAILABLE', error: '该功能暂不可用，请稍后重试',
      });
    }
    assert.deepEqual((await request('GET', '/api/purchases', { as: owner })).purchases, []);
  });
});
