const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-typescript.cjs');

const quietConsole = { error() {}, log() {} };
const plain = (value) => JSON.parse(JSON.stringify(value));
const payloadUtils = loadModule('server/src/utils/share-payload.ts').exports;
const shareId = 'a'.repeat(32);
const modelIds = ['hg-001', 'rg-002', 'mg-003'];
const featureEnvNames = ['FEATURE_DISCOVERY', 'FEATURE_SHARING', 'FEATURE_SQUAD', 'FEATURE_QUIZ',
  'FEATURE_BUILDS', 'FEATURE_LINEAGE', 'FEATURE_COMPARE', 'FEATURE_PILOT_RATING'];
const quizInput = () => ({
  kind: 'quiz', title: '认机挑战', modelIds,
  questions: modelIds.map((answerId, index) => ({ prompt: `第 ${index + 1} 题`, optionIds: modelIds, answerId })),
});
const modelRow = (id) => ({
  id, series: id.split('-')[0], number: 1, name: id, name_ja: 'ガンダム', name_en: 'Gundam',
  price: 1000, price_tax_free: 900, release_date: '2026-01', is_limited: 0,
  image_url: `/images/${id}.jpg`, product_url: 'https://bandai.example/product', tags: '["高达"]',
  updated_at: 'private metadata', openid: 'other-user', price_cny: '999.00', purchase_date: '2026-01-01',
});

function routeSession(file, query = async () => [[]], moderation = async () => ({ pass: true }), featureEnv = {}) {
  const routers = [];
  const calls = [];
  const checks = [];
  const express = { Router() {
    const routes = [];
    const router = { routes };
    for (const method of ['get', 'post', 'put']) router[method] = (route, handler) => routes.push({ method, route, handler });
    routers.push(router);
    return router;
  } };
  const features = loadModule('server/src/utils/features.ts', {
    globals: { process: { env: { ...Object.fromEntries(featureEnvNames.map((name) => [name, 'true'])), ...featureEnv } } },
  }).exports;
  const { exports } = loadModule(file, {
    mocks: {
      express,
      '../db/pool': { default: { query: async (sql, params) => { calls.push({ sql, params }); return query(sql, params); } } },
      '../utils/share-payload': payloadUtils,
      '../utils/features': features,
      '../utils/msg-sec-check': { msgSecCheck: async (text, openid) => { checks.push({ text, openid }); return moderation(text, openid); } },
    },
    globals: { console: quietConsole },
  });
  async function invoke(method, route, request = {}, router = exports.default) {
    const match = router.routes.find((entry) => entry.method === method && entry.route === route);
    assert.ok(match, `missing ${method} ${route}`);
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = plain(body); return this; } };
    await match.handler({ params: {}, body: {}, ...request }, response);
    return response;
  }
  return { exports, calls, checks, invoke, routers };
}

function shareSession(query, moderation, featureEnv) {
  return routeSession('server/src/routes/shares.ts', query, moderation, featureEnv);
}

function buildSession(query, featureEnv) {
  return routeSession('server/src/routes/builds.ts', query, undefined, featureEnv);
}

const progress = () => ({ modelId: 'hg-001', quantity: 3, completedCount: 1, buildingCount: 1, goal: '周末完成', goalDoneDate: null });

test('分享创建只使用目录公开字段，保持自选顺序和服务端身份', async () => {
  let stored;
  const current = shareSession(async (sql, params) => {
    if (sql.includes('FROM models')) return [[modelRow('rg-002'), modelRow('hg-001')]];
    stored = params;
    return [{ affectedRows: 1 }];
  });
  const result = await current.invoke('post', '/', {
    openid: 'actual-user', body: {
      kind: 'squad', title: '  出击  ', modelIds: ['hg-001', 'rg-002'], captainId: 'rg-002',
      openid: 'spoof-user', models: [{ id: 'hg-001', name: 'spoof-name' }], priceCny: 9999,
    },
  });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.id, /^[a-f0-9]{32}$/);
  assert.equal(stored[1], 'actual-user');
  const snapshot = JSON.parse(stored[2]);
  assert.deepEqual(snapshot.models.map((model) => model.id), ['hg-001', 'rg-002']);
  assert.equal(snapshot.title, '出击');
  assert.equal(snapshot.captainId, 'rg-002');
  assert.equal(snapshot.models[0].name, 'hg-001');
  assert.equal(snapshot.models[0].isLimited, false);
  assert.deepEqual(snapshot.models[0].tags, ['高达']);
  for (const privateKey of ['openid', 'priceCny', 'price_cny', 'purchase_date', 'updated_at']) {
    assert.equal(Object.hasOwn(snapshot, privateKey), false);
    assert.equal(Object.hasOwn(snapshot.models[0], privateKey), false);
  }
  assert.equal(stored[3], null);
  assert.deepEqual(current.checks, [{ text: '出击', openid: 'actual-user' }]);
});

test('quiz 答案独立保存；公开 GET 不读取答案或私人账号', async () => {
  let stored;
  const creating = shareSession(async (sql, params) => {
    if (sql.includes('FROM models')) return [[...modelIds].reverse().map(modelRow)];
    stored = params;
    return [{ affectedRows: 1 }];
  });
  assert.equal((await creating.invoke('post', '/', { openid: 'owner', body: quizInput() })).statusCode, 200);
  const snapshot = JSON.parse(stored[2]);
  assert.deepEqual(JSON.parse(stored[3]), modelIds);
  assert.equal(JSON.stringify(snapshot).includes('answerId'), false);
  assert.ok(creating.checks[0].text.includes('第 3 题'));
  const reading = shareSession(async () => [[{ payload: stored[2], quiz_answers: stored[3], openid: 'owner' }]]);
  const result = await reading.invoke('get', '/:id', { params: { id: shareId } }, reading.exports.publicSharesRouter);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.id, shareId);
  assert.equal(JSON.stringify(result.body).includes('answerId'), false);
  assert.equal(Object.hasOwn(result.body, 'quiz_answers'), false);
  assert.equal(Object.hasOwn(result.body, 'openid'), false);
  assert.match(reading.calls[0].sql, /^SELECT payload FROM share_snapshots WHERE id = \?$/);
  assert.deepEqual(plain(reading.calls[0].params), [shareId]);
  assert.deepEqual(result.body.models, snapshot.models);
});

test('quiz 公开核分只按快照答案计算并拒绝选项外的答案', async () => {
  const input = quizInput();
  const snapshot = { kind: 'quiz', questions: input.questions.map(({ prompt, optionIds }) => ({ prompt, optionIds })) };
  const current = shareSession(async () => [[{ payload: snapshot, quiz_answers: JSON.stringify(modelIds) }]]);
  const request = { params: { id: shareId }, body: { answers: ['hg-001', 'hg-001', 'mg-003'], score: 3, correctAnswers: [] } };
  const result = await current.invoke('post', '/:id/answers', request, current.exports.publicSharesRouter);
  assert.deepEqual(result.body, { score: 2, total: 3, correctAnswers: modelIds });
  request.body.answers[0] = 'unknown-model';
  assert.equal((await current.invoke('post', '/:id/answers', request, current.exports.publicSharesRouter)).statusCode, 400);
  request.body.answers = ['hg-001'];
  assert.equal((await current.invoke('post', '/:id/answers', request, current.exports.publicSharesRouter)).statusCode, 400);
  assert.equal(current.calls.length, 2);
});

test('分享校验限制各玩法数量、重复选项、队长、文字和汇总值', async () => {
  const invalid = [
    null, {}, { kind: 'other', title: '标题', modelIds },
    { kind: 'squad', title: ' ', modelIds }, { kind: 'squad', title: '字'.repeat(31), modelIds },
    { kind: 'squad', title: '标题', modelIds: [] }, { kind: 'squad', title: '标题', modelIds: Array.from({ length: 7 }, (_, i) => `hg-${i}`) },
    { kind: 'compare', title: '标题', modelIds: ['hg-001'] },
    { kind: 'wishlist', title: '标题', modelIds: Array.from({ length: 51 }, (_, i) => `hg-${i}`) },
    { kind: 'squad', title: '标题', modelIds: ['hg-001', 'hg-001'] },
    { kind: 'squad', title: '标题', modelIds: ['hg-001'], captainId: 'mg-003' },
    { kind: 'squad', title: '标题', modelIds: ['../private'] },
    { ...quizInput(), questions: quizInput().questions.slice(0, 2) },
    { ...quizInput(), questions: [{ prompt: '超长'.repeat(31), optionIds: modelIds, answerId: 'hg-001' }, ...quizInput().questions.slice(1)] },
    { ...quizInput(), questions: [{ prompt: '题目', optionIds: ['hg-001', 'hg-001', 'rg-002'], answerId: 'hg-001' }, ...quizInput().questions.slice(1)] },
    { ...quizInput(), questions: [{ prompt: '题目', optionIds: modelIds, answerId: 'unknown' }, ...quizInput().questions.slice(1)] },
    { ...quizInput(), questions: [{ prompt: '题目', optionIds: ['hg-001', 'rg-002', 'hg-004'], answerId: 'hg-001' }, ...quizInput().questions.slice(1)] },
    ...[-1, 0, 1.5, 49951, Infinity].map((quantity) => ({ kind: 'report', title: '报告', modelIds, report: { quantity, completedCount: 0, buildingCount: 0 } })),
    { kind: 'report', title: '报告', modelIds, report: { quantity: 2, completedCount: 2, buildingCount: 1 } },
  ];
  const current = shareSession();
  for (const body of invalid) assert.equal((await current.invoke('post', '/', { body })).statusCode, 400, JSON.stringify(body));
  assert.equal(current.calls.length, 0);
  assert.equal(current.checks.length, 0);
  for (const kind of ['squad', 'wishlist', 'purchased', 'compare']) {
    const modelIds = kind === 'compare' ? ['hg-001', 'rg-002'] : ['hg-001'];
    assert.equal(payloadUtils.parseShareInput({ kind, title: '标题', modelIds }).kind, kind);
  }
  assert.ok(payloadUtils.parseShareInput({ kind: 'report', title: '报告', modelIds, report: { quantity: 49950, completedCount: 30000, buildingCount: 19950 } }));
});

test('审核拒绝、目录缺失以及 SQL 异常均不返回已创建的分享', async () => {
  const body = { kind: 'wishlist', title: '清单', modelIds: ['hg-001'] };
  const rejected = shareSession(undefined, async () => ({ pass: false, reason: '内容不可公开' }));
  assert.equal((await rejected.invoke('post', '/', { openid: 'user', body })).body.error, '内容不可公开');
  assert.equal(rejected.calls.length, 0);
  const missing = shareSession();
  assert.equal((await missing.invoke('post', '/', { openid: 'user', body })).statusCode, 400);
  const broken = shareSession(async () => { throw new Error('private SQL detail'); });
  assert.deepEqual((await broken.invoke('post', '/', { openid: 'user', body })).body, { error: '创建分享失败' });
});

test('公开分享对无效 ID、缺失快照、非 quiz 和数据库错误返回明确错误', async () => {
  const missing = shareSession();
  for (const [method, route] of [['get', '/:id'], ['post', '/:id/answers']]) {
    assert.equal((await missing.invoke(method, route, { params: { id: '1' } }, missing.exports.publicSharesRouter)).statusCode, 404);
    assert.equal((await missing.invoke(method, route, { params: { id: shareId }, body: { answers: modelIds } }, missing.exports.publicSharesRouter)).statusCode, 404);
    const broken = shareSession(async () => { throw new Error('private SQL detail'); });
    const result = await broken.invoke(method, route, { params: { id: shareId }, body: { answers: modelIds } }, broken.exports.publicSharesRouter);
    assert.equal(result.statusCode, 500);
    assert.equal(JSON.stringify(result.body).includes('private SQL'), false);
  }
  const notQuiz = shareSession(async () => [[{ payload: { kind: 'squad' } }]]);
  assert.equal((await notQuiz.invoke('post', '/:id/answers', { params: { id: shareId }, body: { answers: modelIds } }, notQuiz.exports.publicSharesRouter)).statusCode, 400);
});

test('堆积读取仅查询本人购买，返回默认进度且不暴露购买金额', async () => {
  const current = buildSession(async () => [[{
    model_id: 'hg-001', quantity: 1, completed_count: 0, building_count: 0, goal: '', goal_done_date: null,
    price_cny: '999.00', openid: 'owner',
  }]]);
  const result = await current.invoke('get', '/', { openid: 'actual-user' });
  assert.deepEqual(result.body, { builds: [{ modelId: 'hg-001', quantity: 1, completedCount: 0, buildingCount: 0, goal: '', goalDoneDate: null }] });
  assert.deepEqual(plain(current.calls[0].params), ['actual-user']);
  assert.match(current.calls[0].sql, /LEFT JOIN build_progress b ON b.purchase_id = p.id/);
  assert.match(current.calls[0].sql, /WHERE p.openid = \?/);
  assert.match(current.calls[0].sql, /COALESCE\(b.quantity, 1\)/);
});

test('保存堆积进度通过本人购买 ID 原子写入，不接受伪造账号和模型', async () => {
  const current = buildSession(async () => [{ affectedRows: 1 }]);
  const result = await current.invoke('put', '/:modelId', {
    openid: 'actual-user', params: { modelId: 'hg-001' }, body: { ...progress(), modelId: 'spoof-model', openid: 'spoof-user' },
  });
  assert.deepEqual(result.body, progress());
  assert.match(current.calls[0].sql, /SELECT id, \?, \?, \?, \?, \? FROM purchases WHERE openid = \? AND model_id = \?/);
  assert.deepEqual(plain(current.calls[0].params), [3, 1, 1, '周末完成', null, 'actual-user', 'hg-001']);
});

test('已删除或他人购买不能创建进度；无变化的已存在记录仍保存成功', async () => {
  for (const exists of [false, true]) {
    const current = buildSession(async (sql) => sql.startsWith('INSERT') ? [{ affectedRows: 0 }] : [exists ? [{ id: 9 }] : []]);
    const result = await current.invoke('put', '/:modelId', { openid: 'owner', params: { modelId: 'hg-001' }, body: progress() });
    assert.equal(result.statusCode, exists ? 200 : 404);
    assert.deepEqual(plain(current.calls[1].params), ['owner', 'hg-001']);
    assert.match(current.calls[1].sql, /WHERE openid = \? AND model_id = \?/);
  }
});

test('堆积数量、目标和日期校验拒绝无效输入且不写数据库', async () => {
  const current = buildSession();
  const invalid = [
    { quantity: 0 }, { quantity: 1000 }, { quantity: 1.5 }, { quantity: '3' },
    { completedCount: -1 }, { completedCount: 0.5 }, { buildingCount: 4 }, { completedCount: 2, buildingCount: 2 },
    { goal: '字'.repeat(101) }, { goal: null }, { goalDoneDate: '2025-02-29' }, { goalDoneDate: '2026-02-30' },
    { goalDoneDate: '2999-01-01' }, { goalDoneDate: '0000-01-01' }, { goalDoneDate: '' }, { goalDoneDate: '2026-1-1' },
  ];
  for (const patch of invalid) {
    const result = await current.invoke('put', '/:modelId', { params: { modelId: 'hg-001' }, body: { ...progress(), ...patch } });
    assert.equal(result.statusCode, 400, JSON.stringify(patch));
  }
  assert.equal((await current.invoke('put', '/:modelId', { params: { modelId: 'hg-001' }, body: null })).statusCode, 400);
  assert.equal(current.calls.length, 0);
  const valid = buildSession(async () => [{ affectedRows: 1 }]);
  assert.equal((await valid.invoke('put', '/:modelId', { params: { modelId: 'hg-001' }, body: { ...progress(), goalDoneDate: '2024-02-29' } })).statusCode, 200);
});

test('堆积读取和保存 SQL 异常只返回通用失败信息', async () => {
  const current = buildSession(async () => { throw new Error('private SQL detail'); });
  for (const [method, route] of [['get', '/'], ['put', '/:modelId']]) {
    const result = await current.invoke(method, route, { params: { modelId: 'hg-001' }, body: progress(), openid: 'owner' });
    assert.equal(result.statusCode, 500);
    assert.equal(JSON.stringify(result.body).includes('private SQL'), false);
  }
});

test('关闭堆积时读取和保存均在参数校验与 SQL 前拒绝', async () => {
  const current = buildSession(undefined, { FEATURE_BUILDS: 'false' });
  for (const [method, route] of [['get', '/'], ['put', '/:modelId']]) {
    const result = await current.invoke(method, route);
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.body, { code: 'FEATURE_DISABLED', error: '该功能暂未开放' });
  }
  assert.equal(current.calls.length, 0);
});

test('开启堆积但未迁移表结构时明确返回不可用', async () => {
  for (const code of ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']) {
    const current = buildSession(async () => { throw Object.assign(new Error('private schema detail'), { code }); });
    for (const [method, route] of [['get', '/'], ['put', '/:modelId']]) {
      const result = await current.invoke(method, route, { params: { modelId: 'hg-001' }, body: progress() });
      assert.equal(result.statusCode, 503);
      assert.deepEqual(result.body, { code: 'FEATURE_UNAVAILABLE', error: '该功能暂不可用，请稍后重试' });
    }
  }
});

test('关闭分享后创建、既有快照和答题均不查询数据库或审核内容', async () => {
  const current = shareSession(undefined, undefined, { FEATURE_SHARING: 'false' });
  for (const [method, route, router] of [
    ['post', '/', current.exports.default],
    ['get', '/:id', current.exports.publicSharesRouter],
    ['post', '/:id/answers', current.exports.publicSharesRouter],
  ]) {
    const result = await current.invoke(method, route, { params: { id: shareId }, body: quizInput() }, router);
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.body, { code: 'FEATURE_DISABLED', error: '该功能暂未开放' });
  }
  assert.equal(current.calls.length, 0);
  assert.equal(current.checks.length, 0);
});

test('分享总开关开启时，各玩法创建仍在审核和 SQL 前检查对应开关', async () => {
  for (const [kind, flag] of [['squad', 'FEATURE_SQUAD'], ['quiz', 'FEATURE_QUIZ'], ['compare', 'FEATURE_COMPARE'], ['report', 'FEATURE_BUILDS']]) {
    const current = shareSession(undefined, undefined, { [flag]: 'false' });
    const body = kind === 'quiz' ? quizInput() : {
      kind, title: '分享', modelIds: kind === 'compare' ? modelIds.slice(0, 2) : modelIds,
      ...(kind === 'report' ? { report: { quantity: 3, completedCount: 1, buildingCount: 1 } } : {}),
    };
    const result = await current.invoke('post', '/', { body });
    assert.equal(result.statusCode, 403, kind);
    assert.equal(result.body.code, 'FEATURE_DISABLED');
    assert.equal(current.calls.length, 0, kind);
    assert.equal(current.checks.length, 0, kind);
  }
});

test('读取旧快照按 kind 拦截，wishlist 和 purchased 仅依赖分享开关', async () => {
  const closed = Object.fromEntries(featureEnvNames.filter((name) => name !== 'FEATURE_SHARING').map((name) => [name, 'false']));
  for (const kind of ['squad', 'quiz', 'compare', 'report', 'wishlist', 'purchased']) {
    const current = shareSession(async () => [[{ payload: { kind, title: '旧快照', models: [] } }]], undefined, closed);
    const result = await current.invoke('get', '/:id', { params: { id: shareId } }, current.exports.publicSharesRouter);
    assert.equal(result.statusCode, ['wishlist', 'purchased'].includes(kind) ? 200 : 403, kind);
    assert.equal(current.calls.length, 1);
    assert.doesNotMatch(current.calls[0].sql, /quiz_answers/);
    if (result.statusCode === 403) assert.deepEqual(result.body, { code: 'FEATURE_DISABLED', error: '该功能暂未开放' });
  }
  for (const kind of ['wishlist', 'purchased']) {
    const current = shareSession(async (sql) => sql.includes('FROM models') ? [[modelRow('hg-001')]] : [{ affectedRows: 1 }], undefined, closed);
    assert.equal((await current.invoke('post', '/', { body: { kind, title: '清单', modelIds: ['hg-001'] } })).statusCode, 200);
  }
});

test('关闭 quiz 时即使 sharing 开启也不读取快照答案', async () => {
  const current = shareSession(undefined, undefined, { FEATURE_QUIZ: 'false' });
  const result = await current.invoke('post', '/:id/answers', { params: { id: shareId }, body: { answers: modelIds } }, current.exports.publicSharesRouter);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, 'FEATURE_DISABLED');
  assert.equal(current.calls.length, 0);
});

test('公开分享路由先于认证，创建分享和堆积路由位于认证之后', () => {
  const uses = [];
  const app = { use: (...args) => uses.push(args), get() {}, listen() {} };
  const factory = () => app;
  factory.json = () => 'json';
  factory.static = () => 'static';
  const auth = () => {};
  loadModule('server/src/app.ts', {
    mocks: {
      express: { default: factory }, path: { default: path },
      './middleware/auth': { authMiddleware: auth }, './middleware/error-handler': { errorHandler() {} },
      './routes/models': { default: 'models' }, './routes/wishlist': { default: 'wishlist' },
      './routes/purchases': { default: 'purchases' }, './routes/user': { default: 'user' },
      './routes/forum': { default: 'forum' }, './routes/shares': { default: 'createShare', publicSharesRouter: 'publicShares' },
      './routes/builds': { default: 'builds' },
      './utils/features': { getFeatures: () => ({}) },
    },
    globals: { __dirname: '/server/src', process: { env: {} }, console: quietConsole },
  });
  const index = (value) => uses.findIndex((args) => args[1] === value);
  assert.ok(index('publicShares') < index(auth));
  assert.ok(index('createShare') > index(auth));
  assert.ok(index('builds') > index(auth));
});

test('迁移幂等创建快照与进度表，购买删除通过外键级联清理', () => {
  for (const filename of ['server/src/db/init.sql', 'server/src/scripts/migrate-hangar.ts']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8');
    assert.match(source, /CREATE TABLE IF NOT EXISTS build_progress/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS share_snapshots/);
    assert.match(source, /FOREIGN KEY \(purchase_id\) REFERENCES purchases\(id\) ON DELETE CASCADE/);
    assert.doesNotMatch(source, /(?:DROP|TRUNCATE|DELETE FROM|UPDATE purchases)\s/i);
  }
});

test('客户端复用 callAPI、编码分享 ID 并解析 CDN 图片地址', async () => {
  const calls = [];
  const cdn = loadModule('miniprogram/utils/cdn-config.ts').exports;
  const service = loadModule('miniprogram/utils/hangar-service.ts', {
    mocks: {
      './cdn-config': cdn,
      './feature-flags': { requireFeature() {}, canShareKind: () => true, featureRevision: () => 0 },
      './api': { callAPI: async (options) => {
        calls.push(plain(options));
        if (options.path.startsWith('/api/shares/') && options.method === 'GET') return { id: shareId, kind: 'squad', title: '出击', models: [{ id: 'hg-001', imageUrl: '/images/main.jpg', images: ['/images/detail.jpg'] }] };
        if (options.path === '/api/builds') return { builds: [progress()] };
        if (options.method === 'PUT') return options.data;
        if (options.path.endsWith('/answers')) return { score: 2, total: 3, correctAnswers: modelIds };
        return { id: shareId };
      } },
    },
  }).exports;
  assert.equal((await service.createShare(quizInput())).id, shareId);
  const shared = await service.getShare('a/b');
  assert.equal(shared.models[0].imageUrl, cdn.resolveImageUrl('/images/main.jpg'));
  assert.equal(shared.models[0].images[0], cdn.resolveImageUrl('/images/detail.jpg'));
  assert.equal(calls[1].path, '/api/shares/a%2Fb');
  assert.equal((await service.submitQuiz(shareId, modelIds)).score, 2);
  assert.deepEqual(plain(await service.loadBuildProgress()), [progress()]);
  assert.deepEqual(plain(await service.saveBuildProgress(progress())), progress());
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET', 'POST', 'GET', 'PUT']);
  assert.equal(calls[4].path, '/api/builds/hg-001');
  const broken = loadModule('miniprogram/utils/hangar-service.ts', {
    mocks: {
      './api': { callAPI: async () => { throw new Error('network failed'); } }, './cdn-config': cdn,
      './feature-flags': { requireFeature() {}, canShareKind: () => true, featureRevision: () => 0 },
    },
  }).exports;
  await assert.rejects(broken.loadBuildProgress(), /network failed/);
  await assert.rejects(broken.createShare(quizInput()), /network failed/);
});
