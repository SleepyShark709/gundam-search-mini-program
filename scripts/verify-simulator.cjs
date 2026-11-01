/* global wx, getApp */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const automator = require('miniprogram-automator');
const { createMysqlFixture } = require('../tests/helpers/mysql-fixture.cjs');

const root = path.resolve(__dirname, '..');
const tabPagePaths = new Set(require('../miniprogram/app.json').tabBar.list.map((tab) => tab.pagePath));
const testOpenid = 'gundam-simulator-test-user';
const privateMarker = 'SIMULATOR_PRIVATE_DO_NOT_SHARE';
const featureEnvironment = {
  discovery: 'FEATURE_DISCOVERY', sharing: 'FEATURE_SHARING', squad: 'FEATURE_SQUAD', quiz: 'FEATURE_QUIZ',
  builds: 'FEATURE_BUILDS', lineage: 'FEATURE_LINEAGE', compare: 'FEATURE_COMPARE', pilotRating: 'FEATURE_PILOT_RATING',
};
const enabledFeatures = Object.fromEntries(Object.keys(featureEnvironment).map((key) => [key, true]));
const cliPath = process.env.WECHAT_CLI_PATH || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const runDeadline = Date.now() + 15 * 60 * 1000;
const report = {
  status: 'running', startedAt: new Date().toISOString(),
  backend: { type: 'real-local-express-mysql', businessMocks: false },
  automation: { package: 'miniprogram-automator', version: require('miniprogram-automator/package.json').version, cliPath },
  boundaries: [
    '未向真实微信联系人发送消息；检查分享回调路径与实际公开快照。',
    '未验证真机相册授权、保存相册与微信图片转发权限。',
    '公开链接在同一模拟器打开；无认证 HTTP 另行验证访客读取和服务端判分，未切换真实微信账号。',
    '测试副本仅将业务 API 指向隔离本机数据库；图片仍采用产品的真实图片来源。',
    '隔离后端按 fixture 关闭微信内容安全检查，线上内容安全接口需发布环境另验。',
    '个人页加载、错误与缓存态使用 Page.setData 做纯渲染布局探针，不代表真实网络故障或用户资料写入验收。',
  ],
  steps: [], actions: [], exceptions: [], console: [], screenshots: [],
};
let evidenceDir;
let projectPath;
let fixture;
let miniProgram;
let screenshotIndex = 0;
let activeStep = '';
let originalDraft;
let draftRead = false;
let draftExisted = false;
let interrupted = false;
let asynchronousFailure;

function remaining(timeout = 20000) {
  const duration = Math.min(timeout, runDeadline - Date.now());
  assert.ok(duration > 0 && !interrupted, '模拟器验收已超时或被中断');
  return duration;
}

async function bounded(label, operation, timeout = 20000, cleanup = false) {
  let timer;
  try {
    return await Promise.race([
      operation,
      ...(!cleanup && asynchronousFailure ? [asynchronousFailure] : []),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超时`)), cleanup ? timeout : remaining(timeout)); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function poll(label, read, predicate, timeout = 20000) {
  const deadline = Date.now() + remaining(timeout);
  let last;
  while (Date.now() < deadline) {
    last = await bounded(label, read(), Math.min(10000, deadline - Date.now()));
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label}未在期限内就绪；末次状态：${JSON.stringify(last).slice(0, 1200)}`);
}

async function dataReady(page, predicate, label = '页面数据', timeout) {
  return poll(label, () => page.data(), (data) => {
    const error = data.error || data.loadError || data.shareError || data.posterError || data.submitError;
    if (error && !data.loading && !data.preparing && !data.posterLoading) throw new Error(`${label}：${error}`);
    return predicate(data);
  }, timeout);
}

async function capture(label, cleanup = false) {
  if (!miniProgram) return null;
  const file = `${String(++screenshotIndex).padStart(3, '0')}-${label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 75)}.png`;
  await bounded('原生模拟器截图', miniProgram.screenshot({ path: path.join(evidenceDir, file) }), 15000, cleanup);
  const png = await fs.readFile(path.join(evidenceDir, file));
  assert.equal(png.subarray(1, 4).toString(), 'PNG', '截图必须为真实 PNG');
  report.screenshots.push({ file, step: activeStep, source: 'MiniProgram.screenshot', sha256: createHash('sha256').update(png).digest('hex') });
  return file;
}

async function element(scope, selector, index = 0) {
  return poll(`元素 ${selector}[${index}]`, () => scope.$$(selector), (elements) => !!elements[index])
    .then((elements) => elements[index]);
}

async function findScrollContainer(scope, page) {
  if (scope !== page) {
    const scoped = await scope.$('scroll-view');
    if (scoped) return scoped;
  }
  return await page.$('.editor scroll-view') || await page.$('scroll-view');
}

async function waitForStableOffset(label, target, inViewport) {
  let previous;
  let stableReads = 0;
  const samePosition = (left, right) => Math.abs(Number(left.left) - Number(right.left)) < 1
    && Math.abs(Number(left.top) - Number(right.top)) < 1;
  const offset = await poll(label, () => target.offset(), (position) => {
    stableReads = inViewport(position) ? (previous && samePosition(previous, position) ? stableReads + 1 : 1) : 0;
    previous = position;
    return stableReads >= 3;
  }, 5000);
  await bounded('等待滚动事件结束', new Promise((resolve) => setTimeout(resolve, 500)));
  const settled = await bounded('确认滚动后元素位置', target.offset());
  assert.ok(inViewport(settled) && samePosition(offset, settled), `${label}结束后元素仍须稳定且在视口内`);
  return settled;
}

async function visible(scope, selector, index = 0) {
  const target = await element(scope, selector, index);
  const size = await bounded('元素尺寸', target.size());
  assert.ok(Number(size.width) > 0 && Number(size.height) > 0, `${selector} 必须具备可见尺寸`);
  const page = await bounded('当前页面', miniProgram.currentPage());
  const frame = await bounded('当前页面渲染根', page.$('.page'));
  assert.ok(frame, '当前应用页面必须具备固定高度的 .page 渲染根');
  const frameSize = await bounded('页面渲染根尺寸', frame.size());
  const frameOffset = await bounded('页面渲染根位置', frame.offset());
  assert.ok(Number(frameSize.width) > 0 && Number(frameSize.height) > 0, '页面渲染根必须具备可见尺寸');
  const systemInfo = await bounded('当前页面模拟器系统信息', miniProgram.systemInfo());
  const viewport = {
    left: Number(frameOffset.left), right: Number(frameOffset.left) + Number(frameSize.width),
    top: Math.max(Number(frameOffset.top), systemInfo.statusBarHeight || 0),
    bottom: Number(frameOffset.top) + (tabPagePaths.has(page.path) ? Math.min(Number(frameSize.height), Number(systemInfo.windowHeight)) : Number(frameSize.height)) - 30,
  };
  const inViewport = (position) => Number(position.left) < viewport.right && Number(position.left) + Number(size.width) > viewport.left
    && Number(position.top) >= viewport.top && Number(position.top) < viewport.bottom;
  let offset = await bounded('元素位置', target.offset());
  if (!inViewport(offset)) {
    const scroll = await bounded('查找作用域内滚动容器', findScrollContainer(scope, page));
    assert.ok(scroll, `${selector} 不在视口内，且页面无滚动容器`);
    const scrollTop = Number(await bounded('读取滚动位置', scroll.property('scrollTop'))) || 0;
    await bounded('滚动真实页面', scroll.scrollTo(0, Math.max(0, scrollTop + Number(offset.top) - 120)));
    offset = await waitForStableOffset(`${selector} 滚入视口`, target, inViewport);
  }
  report.actions.push({ step: activeStep, type: 'visible-size', selector, index, size, offset, viewport });
  return target;
}

async function interact(scope, selector, type = 'tap', value, index = 0) {
  const action = { step: activeStep, type, selector, index, ...(type === 'input' ? { value } : {}), startedAt: new Date().toISOString() };
  report.actions.push(action);
  try {
    const target = await visible(scope, selector, index);
    await bounded(`${type} ${selector}`, type === 'input' ? target.input(value) : target.tap());
    action.status = 'pass';
    action.screenshot = await capture(`${activeStep}-${type}`);
  } catch (error) { action.status = 'fail'; action.error = error.message; throw error; }
}

async function checkpoint(label, page, selector) {
  await visible(page, selector);
  report.actions.push({ step: activeStep, type: 'checkpoint', label, screenshot: await capture(label) });
}

async function open(url) {
  const page = await bounded(`打开 ${url}`, miniProgram.reLaunch(url));
  assert.ok(page, `未打开 ${url}`);
  return page;
}

async function current(pathname) {
  return poll(`导航 ${pathname}`, () => miniProgram.currentPage(), (page) => page && page.path === pathname);
}

async function callback(page, name) {
  report.actions.push({ step: activeStep, type: 'page.callMethod', method: name, reason: '读取框架分享回调返回值；不模拟发送微信消息' });
  return bounded(name, page.callMethod(name));
}

function assertPublic(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['openid', 'priceCny', 'price_cny', 'purchaseDate', 'purchase_date', 'channel', 'note', 'goal', 'goalDoneDate', 'quiz_answers', 'answerId'].includes(key), `公开响应泄漏字段 ${key}`);
    assert.ok(typeof child !== 'string' || !child.includes(privateMarker), '公开响应泄漏测试私密值');
    assertPublic(child);
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  assert.equal(response.status, 200, `${url} HTTP ${response.status}`);
  return response.json();
}

async function publicShare(id, kind) {
  assert.match(id, /^[a-f0-9]{32}$/);
  const response = await request(`${fixture.baseUrl}/api/shares/${id}`);
  assert.equal(response.kind, kind);
  assertPublic(response);
  await fs.writeFile(path.join(evidenceDir, `public-${kind}-${id}.json`), JSON.stringify(response, null, 2));
  report.actions.push({ step: activeStep, type: 'unauthenticated-http', method: 'GET', path: `/api/shares/${id}`, kind, status: 'pass' });
  return response;
}

async function openShare(id, kind) {
  await publicShare(id, kind);
  const page = await open(`/pages/share/share?id=${id}`);
  const data = await dataReady(page, (value) => !value.loading && value.snapshot, '公开分享');
  assert.equal(data.snapshot.kind, kind);
  assertPublic(data.snapshot);
  await checkpoint(`public-${kind}`, page, '.hero-title');
  return page;
}

async function seedCatalog(connection) {
  await bounded('清空测试目录', connection.query('DELETE FROM models'));
  await bounded('清空测试系列', connection.query('DELETE FROM series_meta'));
  const counts = {};
  for (const code of ['hg', 'rg', 'mg', 'pg']) {
    const models = JSON.parse(await fs.readFile(path.join(projectPath, 'miniprogram/data', `${code}.json`), 'utf8'));
    counts[code] = models.length;
    for (let offset = 0; offset < models.length; offset += 100) {
      const values = models.slice(offset, offset + 100).map((model) => [
        model.id, model.series, model.number, model.name, model.nameJa, model.nameEn || null,
        model.price, model.priceTaxFree, model.releaseDate || null, model.isLimited ? 1 : 0,
        model.limitedType || null, model.imageUrl, model.productUrl, model.tags?.length ? JSON.stringify(model.tags) : null,
      ]);
      await bounded('参数化导入真实目录', connection.query('INSERT INTO models (id, series, number, name, name_ja, name_en, price, price_tax_free, release_date, is_limited, limited_type, image_url, product_url, tags) VALUES ?', [values]));
    }
  }
  const metadata = JSON.parse(await fs.readFile(path.join(projectPath, 'miniprogram/data/series-meta.json'), 'utf8'));
  for (const item of metadata) {
    await bounded('参数化导入系列', connection.execute('INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count) VALUES (?, ?, ?, ?, ?, ?)', [item.code, item.name, item.shortName, item.scale, item.coverImage, counts[item.code]]));
  }
  report.backend.catalogCounts = counts;
}

async function copySources() {
  const manifest = [];
  async function copy(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      await fs.mkdir(path.join(projectPath, relative), { recursive: true });
      for (const name of (await fs.readdir(absolute)).sort()) await copy(path.join(relative, name));
      return;
    }
    if (relative.endsWith('.map') || path.basename(relative) === '.DS_Store') return;
    if (relative.endsWith('.js') && !relative.startsWith(`miniprogram${path.sep}data${path.sep}`)) {
      try { await fs.access(absolute.replace(/\.js$/, '.ts')); return; } catch {}
    }
    if (relative.endsWith('.wxss')) {
      try { await fs.access(absolute.replace(/\.wxss$/, '.less')); return; } catch {}
    }
    const content = await fs.readFile(absolute);
    await fs.writeFile(path.join(projectPath, relative), content);
    manifest.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') });
  }
  await fs.mkdir(projectPath);
  for (const entry of ['miniprogram', 'project.config.json', 'tsconfig.json']) await copy(entry);
  report.source = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
    sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    manifest,
  };
  const configPath = path.join(projectPath, 'project.config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.projectname = `gundam-simulator-verification-${Date.now()}`;
  config.setting = { ...config.setting, urlCheck: false };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function configureLocalCopy() {
  const apiPath = path.join(projectPath, 'miniprogram/utils/api.ts');
  let api = await fs.readFile(apiPath, 'utf8');
  for (const pattern of [/const FORCE_USE_CLOUD = true;/, /export const LOCAL_BASE = '[^']+';/, /const LOCAL_MOCK_OPENID = '[^']+';/]) assert.match(api, pattern, 'API 环境声明改变，需人工复核 runner');
  api = api.replace('const FORCE_USE_CLOUD = true;', 'const FORCE_USE_CLOUD = false;')
    .replace(/export const LOCAL_BASE = '[^']+';/, `export const LOCAL_BASE = '${fixture.baseUrl}';`)
    .replace(/const LOCAL_MOCK_OPENID = '[^']+';/, `const LOCAL_MOCK_OPENID = '${testOpenid}';`);
  await fs.writeFile(apiPath, `// TEMPORARY SIMULATOR VERIFICATION COPY — ${report.startedAt}\n${api}`);
  report.testCopy = { projectPath, appid: JSON.parse(await fs.readFile(path.join(projectPath, 'project.config.json'), 'utf8')).appid, apiBase: fixture.baseUrl, openid: testOpenid, changes: ['api.ts 本机隔离 API 与固定测试身份', 'project.config.json 临时工程名称与 urlCheck=false'] };
  const manifest = [];
  for (const entry of report.source.manifest) manifest.push({ path: entry.path, sha256: createHash('sha256').update(await fs.readFile(path.join(projectPath, entry.path))).digest('hex') });
  report.testCopy.sha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  report.testCopy.manifest = manifest;
}

async function backendHash() {
  const manifest = [];
  const directory = path.join(root, 'server/dist');
  async function visit(relative) {
    for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else manifest.push({ path: file, sha256: createHash('sha256').update(await fs.readFile(path.join(directory, file))).digest('hex') });
    }
  }
  await visit('');
  return { directory, sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifest };
}

async function step(name, operation) {
  activeStep = name;
  const result = { name, startedAt: new Date().toISOString(), status: 'running' };
  report.steps.push(result);
  console.log(`[simulator] ${name}`);
  try { await operation(); result.status = 'pass'; }
  catch (error) {
    result.status = 'fail'; result.error = error.stack || error.message;
    try { result.screenshot = await capture(`${name}-failure`); } catch (captureError) { result.screenshotError = captureError.message; }
    console.error(`[simulator] ${name}: ${error.message}`);
  }
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(evidenceDir, 'result.json'), JSON.stringify(report, null, 2));
}

async function homeAndSeries() {
  let page = await open('/pages/home/home');
  await dataReady(page, (data) => !data.loading && data.series.length === 4 && data.recent.length > 0);
  await checkpoint('home-catalog', page, '.search-input');
  await interact(page, '.recent-card');
  page = await current('pages/model/model');
  await dataReady(page, (data) => !data.loading && !!data.model);
  await checkpoint('recent-model', page, '.name');
  page = await open('/pages/home/home');
  await interact(page, '.search-input', 'input', 'RX-78-2');
  await interact(page, '.search-button');
  page = await current('pages/discover/discover');
  await dataReady(page, (data) => !data.refreshing && data.total > 0 && !data.refreshError);
  await checkpoint('global-search-results', page, '.catalog-card');
  page = await open('/pages/home/home');
  await interact(page, '[data-entry="new"]');
  page = await current('pages/discover/discover');
  await dataReady(page, (data) => data.mode === 'new' && !data.refreshing && data.total > 0);
  await checkpoint('recent-directory', page, '.catalog-card');
  page = await open('/pages/home/home');
  // series-card 为虚拟宿主，点击实际渲染的卡片根节点。
  await interact(page, '[class~="card--card"]');
  page = await current('pages/series/series');
  await dataReady(page, (data) => !data.loading && data.resultCount > 0);
  await checkpoint('series-navigation', page, '.result-count');
}

async function modelCollection() {
  const page = await open('/pages/model/model?id=rg-001');
  await dataReady(page, (data) => !data.loading && !data.syncing && !data.syncError && data.model?.id === 'rg-001');
  await interact(page, '.actions button');
  await dataReady(page, (data) => data.favorite);
  await interact(page, '.actions button', 'tap', undefined, 1);
  await dataReady(page, (data) => data.formOpen);
  // virtualHost 没有组件标签；使用原生验收确认的实际渲染类，保留弹层内的元素作用域。
  const forms = await poll('唯一购买弹层', () => page.$$('[class~="form--overlay"]'), (matches) => matches.length === 1);
  const form = forms[0];
  assert.match(await bounded('确认购买弹层标题', form.text()), /记录已购买/);
  await interact(form, '[class~="form--form-input"]', 'input', '123.45');
  await interact(form, '[class~="form--form-input"]', 'input', privateMarker, 1);
  await interact(form, '[class~="form--form-textarea"]', 'input', `${privateMarker}_NOTE`);
  await interact(form, '[class~="form--submit-button"]');
  await dataReady(page, (data) => data.purchased && !data.formOpen);
  const [purchases] = await bounded('校验真实购买记录', fixture.connection.execute('SELECT price_cny, channel, note FROM purchases WHERE openid = ? AND model_id = ?', [testOpenid, 'rg-001']));
  assert.equal(purchases.length, 1);
  assert.equal(Number(purchases[0].price_cny), 123.45);
  assert.equal(purchases[0].channel, privateMarker);
  assert.equal(purchases[0].note, `${privateMarker}_NOTE`);
  const [wishlist] = await bounded('校验真实心愿单', fixture.connection.execute('SELECT model_id FROM wishlists WHERE openid = ?', [testOpenid]));
  assert.ok(wishlist.some((row) => row.model_id === 'rg-001'));
  await checkpoint('model-favorite-purchase-persisted', page, '.actions');
}

async function collectionShares() {
  for (const kind of ['wishlist', 'purchased']) {
    const page = await open(`/pages/${kind}/${kind}`);
    await dataReady(page, (data) => !data.loading && !data.loadError && data.shareModelIds.includes('rg-001'));
    const component = await element(page, 'collection-share');
    await interact(component, 'button');
    const shared = await current('pages/share/share');
    const data = await dataReady(shared, (value) => !value.loading && value.snapshot);
    assert.equal(data.snapshot.kind, kind);
    await publicShare(data.snapshot.id, kind);
    assertPublic(data.snapshot);
    await checkpoint(`${kind}-public-collection`, shared, '.model-card');
  }
}

async function squad() {
  let page = await open('/pages/squad/squad');
  const picker = await element(page, 'model-picker');
  await poll('编队目录加载', () => picker.data(), (data) => !data.loading && data.candidates.length >= 7);
  const ids = [];
  for (let index = 0; index < 6; index += 1) {
    const candidates = await picker.data('candidates');
    ids.push(candidates[index].id);
    await interact(picker, '.model-cell', 'tap', undefined, index);
    await dataReady(page, (data) => data.modelIds.length === index + 1);
    await checkpoint(`squad-${index + 1}-models`, page, '.counter');
  }
  await interact(picker, '.model-cell', 'tap', undefined, 6);
  assert.equal((await page.data('modelIds')).length, 6, '第七台不得加入编队');
  await interact(page, '.title-input', 'input', '模拟器六机验收');
  await interact(page, '.captain-action', 'tap', undefined, 1);
  await dataReady(page, (data) => data.captainId === ids[1]);
  await interact(page, '.squad-panel .text-button');
  page = await open('/pages/squad/squad');
  const restored = await dataReady(page, (data) => !data.loading && data.modelIds.length === 6);
  assert.deepEqual(restored.modelIds, ids);
  assert.equal(restored.title, '模拟器六机验收');
  assert.equal(restored.captainId, ids[1]);
  await checkpoint('squad-draft-restored', page, '.captain');
  await interact(page, '.primary-button');
  const prepared = await dataReady(page, (data) => !data.preparing && !!data.preparedId);
  const message = await callback(page, 'onShareAppMessage');
  assert.equal(message.path, `/pages/share/share?id=${prepared.preparedId}`);
  const snapshot = await publicShare(prepared.preparedId, 'squad');
  assert.deepEqual(snapshot.models.map((model) => model.id), ids);
  assert.equal(snapshot.captainId, ids[1]);
  await interact(page, '.secondary-button');
  const poster = await dataReady(page, (data) => !data.posterLoading && !!data.posterPath, 'Canvas 海报导出', 40000);
  await checkpoint('squad-canvas-poster', page, '.poster-preview');
  const encoded = await bounded('读取真实 Canvas 导出文件', miniProgram.evaluate((filePath) => new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: (result) => resolve(result.data), fail: reject });
  }), poster.posterPath));
  const png = Buffer.from(encoded, 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 900);
  assert.equal(png.readUInt32BE(20), 1360);
  await fs.writeFile(path.join(evidenceDir, 'squad-canvas-export.png'), png);
  report.actions.push({ step: activeStep, type: 'canvas-export', file: 'squad-canvas-export.png', width: 900, height: 1360 });
  await openShare(prepared.preparedId, 'squad');
}

async function quiz() {
  let page = await open('/pages/quiz/quiz');
  await interact(page, '.title-input', 'input', '模拟器三题默契验收');
  const correct = [];
  for (let index = 0; index < 3; index += 1) {
    await interact(page, `.secondary-button[data-index="${index}"]`);
    await dataReady(page, (data) => data.pickerOpen && data.activeQuestion === index);
    const picker = await element(page, 'model-picker');
    await poll('答题候选目录', () => picker.data(), (data) => !data.loading && data.candidates.length >= 3);
    for (let option = 0; option < 3; option += 1) {
      await interact(picker, '.model-cell', 'tap', undefined, option);
      await dataReady(page, (data) => data.questions[index].optionIds.length === option + 1);
    }
    await interact(page, '.picker-toolbar button', 'tap', undefined, 1);
    await dataReady(page, (data) => !data.pickerOpen);
    const question = (await page.data('questions'))[index];
    correct.push(question.optionIds[index]);
    await interact(page, `.option[data-index="${index}"][data-id="${correct[index]}"]`);
    await dataReady(page, (data) => data.questions[index].answerId === correct[index]);
    await checkpoint(`quiz-question-${index + 1}-configured`, page, '.answer-status.ready');
  }
  await interact(page, '.primary-button');
  const prepared = await dataReady(page, (data) => !data.preparing && !!data.preparedId);
  assert.equal((await callback(page, 'onShareAppMessage')).path, `/pages/share/share?id=${prepared.preparedId}`);
  const snapshot = await publicShare(prepared.preparedId, 'quiz');
  assert.equal(snapshot.questions.length, 3);
  assert.ok(snapshot.questions.every((question) => question.optionIds.length === 3 && !('answerId' in question)));
  page = await openShare(prepared.preparedId, 'quiz');
  for (let index = 0; index < 3; index += 1) await interact(page, `.quiz-option[data-index="${index}"][data-id="${correct[index]}"]`);
  await interact(page, '.primary-button');
  const answered = await dataReady(page, (data) => !data.submitting && !!data.result);
  assert.deepEqual(answered.result, { score: 3, total: 3 });
  const wrong = correct.slice();
  wrong[0] = snapshot.questions[0].optionIds.find((id) => id !== correct[0]);
  const serverResult = await request(`${fixture.baseUrl}/api/shares/${prepared.preparedId}/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: wrong }) });
  assert.equal(serverResult.score, 2, '无认证访客答案由真实服务端判分');
  assert.deepEqual(serverResult.correctAnswers, correct);
  await fs.writeFile(path.join(evidenceDir, 'quiz-server-score.json'), JSON.stringify(serverResult, null, 2));
  await checkpoint('quiz-visitor-server-scored', page, '.result-panel');
}

async function builds() {
  const page = await open('/pages/builds/builds');
  await dataReady(page, (data) => !data.loading && data.items.some((item) => item.modelId === 'rg-001'));
  await interact(page, '.edit[data-id="rg-001"]');
  await dataReady(page, (data) => data.editOpen);
  for (const [field, value] of Object.entries({ quantityInput: '3', completedInput: '1', buildingInput: '1', goalInput: `${privateMarker}_GOAL` })) await interact(page, `input[data-field="${field}"]`, 'input', value);
  await interact(page, '.editor .primary');
  let data = await dataReady(page, (value) => !value.saving && !value.editOpen && value.summary.quantity === 3);
  assert.equal(data.summary.completedCount, 1);
  assert.equal(data.summary.buildingCount, 1);
  assert.equal(data.summary.backlogCount, 1);
  await interact(page, '.goal button[data-id="rg-001"]');
  await dataReady(page, (value) => !value.saving && value.items.find((item) => item.modelId === 'rg-001')?.doneToday);
  for (const filter of ['backlog', 'building', 'completed', 'all']) {
    await interact(page, `.tab[data-id="${filter}"]`);
    await dataReady(page, (value) => value.filter === filter && value.items.length === 1);
    await checkpoint(`builds-filter-${filter}`, page, '.kit');
  }
  const [rows] = await bounded('校验真实拼装进度', fixture.connection.execute('SELECT b.quantity, b.completed_count, b.building_count, b.goal, b.goal_done_date FROM build_progress b JOIN purchases p ON p.id = b.purchase_id WHERE p.openid = ? AND p.model_id = ?', [testOpenid, 'rg-001']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].completed_count, 1);
  assert.equal(rows[0].building_count, 1);
  assert.equal(rows[0].goal, `${privateMarker}_GOAL`);
  assert.ok(rows[0].goal_done_date);
  await interact(page, '.briefing .actions button', 'tap', undefined, 1);
  const shared = await current('pages/share/share');
  data = await dataReady(shared, (value) => !value.loading && value.snapshot?.kind === 'report');
  const snapshot = await publicShare(data.snapshot.id, 'report');
  assert.deepEqual(snapshot.report, { quantity: 3, completedCount: 1, buildingCount: 1 });
  await checkpoint('build-report-public', shared, '.report-panel');
}

async function lineage() {
  const page = await open('/pages/discover/discover?mode=lineage');
  const data = await dataReady(page, (value) => !value.refreshing && !value.purchasesLoading && value.purchasesKnown && !value.purchasesError);
  assert.equal(data.lineageId, 'rx78');
  assert.ok(data.lineage.entries.some((entry) => entry.modelId === 'rg-001' && entry.owned));
  assert.ok(data.lineage.percent > 0 && data.lineage.percent <= 100);
  await checkpoint('lineage-owned-progress', page, '.progress-number');
  await interact(page, '.lineage-tab[data-id="nu"]');
  await dataReady(page, (value) => value.lineageId === 'nu' && value.lineage.entries.length > 0);
  await checkpoint('lineage-switch', page, '.lineage-summary');
}

async function compare() {
  const page = await open('/pages/discover/discover?mode=compare');
  await dataReady(page, (data) => !data.refreshing && data.models.length >= 3 && !data.refreshError);
  await interact(page, '.select-button');
  await dataReady(page, (data) => data.selectedIds.length === 1);
  await interact(page, '.select-button', 'tap', undefined, 1);
  await dataReady(page, (data) => data.selectedIds.length === 2 && data.comparisonRows.length === 5);
  await interact(page, '.select-button', 'tap', undefined, 2);
  assert.equal((await page.data('selectedIds')).length, 2, '第三台不得加入两台对比');
  await checkpoint('compare-two-models', page, '.comparison-row');
  await interact(page, '.primary-button');
  const prepared = await dataReady(page, (data) => !data.generatingShare && !!data.shareId);
  assert.equal((await callback(page, 'onShareAppMessage')).path, `/pages/share/share?id=${prepared.shareId}`);
  const shared = await openShare(prepared.shareId, 'compare');
  assert.equal((await shared.data('snapshot.models')).length, 2);
  await checkpoint('compare-public-snapshot', shared, '.compare-fields');
}

function setFixtureFeatures(keys) {
  assert.ok(fixture && /^gundam_test_[a-f0-9]+$/.test(fixture.database) && /^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.baseUrl), '开关探针仅允许隔离本机 fixture');
  const features = Object.fromEntries(Object.entries(featureEnvironment).map(([key, variable]) => {
    const enabled = keys.includes(key);
    process.env[variable] = String(enabled);
    return [key, enabled];
  }));
  report.actions.push({ step: activeStep, type: 'fixture-feature-flags', features });
  return features;
}

async function refreshForegroundFeatures(page, expected) {
  report.actions.push({ step: activeStep, type: 'app-lifecycle', api: 'MiniProgram.evaluate', method: 'App.onShow', reason: '触发真实前台功能配置刷新' });
  await bounded('触发真实 App.onShow', miniProgram.evaluate(() => { getApp().onShow(); }));
  await poll('前台开关刷新', () => page.data('features'), (actual) => Object.keys(expected).every((key) => actual?.[key] === expected[key]));
  assert.deepEqual(await request(`${fixture.baseUrl}/api/features`), { version: 1, features: expected });
}

function assertSameMenuLayout(before, after) {
  assert.equal(after.length, before.length, '加载态不能改变菜单组数量');
  for (let index = 0; index < before.length; index++) {
    for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(Number(before[index][key]) - Number(after[index][key])) <= 1, `资料状态不能挤动菜单：${index}.${key}`);
  }
}

async function profileLayoutProbe() {
  const page = await open('/pages/profile/profile');
  const original = await poll('个人页资料请求结束', () => page.data(), (data) => !data.userLoading && Object.keys(enabledFeatures).every((key) => data.features?.[key] === true));
  const measureMenus = async () => {
    const menus = await bounded('个人页菜单组', page.$$('.menu-section'));
    assert.ok(menus.length > 0);
    const rectangles = [];
    for (const menu of menus.slice(0, 1)) rectangles.push({ ...await bounded('基础菜单位置', menu.offset()), ...await bounded('基础菜单尺寸', menu.size()) });
    return rectangles;
  };
  try {
    for (const cached of [false, true]) {
      await bounded('布局探针正常态', page.setData({ hasUserInfo: cached, userLoading: false, userLoadError: false }));
      await poll('布局探针无提示层', () => page.$$('.profile-loading-overlay, .user-panel .refresh-banner'), (nodes) => nodes.length === 0);
      const baseline = await measureMenus();
      for (const state of ['loading', 'error']) {
        const data = { hasUserInfo: cached, userLoading: state === 'loading', userLoadError: state === 'error' };
        await bounded('布局探针 Page.setData', page.setData(data));
        const overlay = await element(page, cached ? '.user-panel .refresh-banner' : '.profile-loading-overlay');
        assert.equal(await bounded('提示层定位方式', overlay.style('position')), 'absolute');
        const panel = await element(page, '.user-panel');
        assert.equal(await bounded('资料容器定位方式', panel.style('position')), 'relative');
        const menus = await measureMenus();
        assertSameMenuLayout(baseline, menus);
        const panelSize = await bounded('资料容器尺寸', panel.size());
        const overlaySize = await bounded('提示层尺寸', overlay.size());
        const panelOffset = await bounded('资料容器位置', panel.offset());
        const overlayOffset = await bounded('提示层位置', overlay.offset());
        if (!cached) {
          for (const key of ['width', 'height']) assert.ok(Math.abs(Number(panelSize[key]) - Number(overlaySize[key])) <= 1, '初载提示层必须覆盖资料容器');
          for (const key of ['left', 'top']) assert.ok(Math.abs(Number(panelOffset[key]) - Number(overlayOffset[key])) <= 1, '初载提示层必须位于资料容器内');
        }
        report.actions.push({ step: activeStep, type: 'render-state-probe', api: 'Page.setData', cached, state, baseline, menus, panelSize, overlaySize, panelOffset, overlayOffset });
        if ((!cached && state === 'loading') || (cached && state === 'error')) await capture(`profile-${cached ? 'cached-error' : 'initial-loading'}-render-probe`);
      }
    }
  } finally { await bounded('恢复个人页渲染状态', page.setData(original), 10000, true); }
}

async function layoutAndFeatureControls() {
  let page = await open('/pages/discover/discover?mode=search');
  await dataReady(page, (data) => data.featureEnabled && !data.refreshing && data.models.length === 40 && data.total > 80);
  await interact(page, '.load-more');
  const loaded = await dataReady(page, (data) => data.models.length === 80);
  const button = await visible(page, '.load-more');
  const text = await bounded('载入更多真实文字', button.text());
  const size = await bounded('载入更多真实尺寸', button.size());
  const lineHeight = Number.parseFloat(await bounded('载入更多行高', button.style('line-height')));
  assert.match(text, new RegExp(`载入更多.*已显示 80 / ${loaded.total}`));
  assert.ok(!text.includes('\n'), '载入更多文字不能换行');
  assert.equal(await bounded('载入更多换行规则', button.style('white-space')), 'nowrap');
  assert.ok(Number(size.height) <= lineHeight + 2, '载入更多必须保持单行高度');
  report.actions.push({ step: activeStep, type: 'single-line-layout', selector: '.load-more', text, size, lineHeight });
  await capture('discovery-load-more-80-single-line');
  await profileLayoutProbe();

  const shared = report.actions.find((action) => action.type === 'unauthenticated-http' && action.kind === 'squad');
  assert.ok(shared, '需先创建可验证关闭行为的公开编队快照');
  const previous = Object.fromEntries(Object.values(featureEnvironment).map((variable) => [variable, process.env[variable]]));
  try {
    page = await open(`/pages/share/share?id=${shared.path.split('/').at(-1)}`);
    await dataReady(page, (data) => data.featureEnabled && !data.loading && !!data.snapshot);
    const disabled = setFixtureFeatures([]);
    await refreshForegroundFeatures(page, disabled);
    const assertUnavailable = async (target) => {
      await poll('页面功能关闭', () => target.data('featureEnabled'), (enabled) => enabled === false);
      const component = await element(target, 'feature-unavailable');
      const title = await element(component, '.title');
      assert.match(await bounded('关闭态提示', title.text()), /功能暂未开放/);
    };
    await assertUnavailable(page);
    await capture('features-live-share-disabled');
    page = await open('/pages/home/home');
    await poll('首页关闭入口', () => page.data('features'), (features) => Object.values(features).every((enabled) => enabled === false));
    assert.equal((await bounded('首页玩法入口', page.$$('.search-section, .play-grid, .recent-list'))).length, 0);
    page = await open('/pages/profile/profile');
    assert.equal((await bounded('个人页玩法入口', page.$$('[data-page]'))).length, 0);
    page = await open('/pages/purchased/purchased');
    await dataReady(page, (data) => !data.loading && !data.loadError && data.ratingMode === 'collection');
    assert.equal((await bounded('已购新增玩法入口', page.$$('collection-share, .build-entry'))).length, 0);
    assert.equal((await bounded('原收藏雷达', page.$$('.radar-section'))).length, 1);
    await interact(page, '.score-toggle');
    await dataReady(page, (data) => data.ratingMode === 'collection' && data.scoreDetailOpen);
    assert.equal((await bounded('原收藏展开面板', page.$$('.score-detail'))).length, 1);
    for (const url of [`/pages/share/share?id=${shared.path.split('/').at(-1)}`, '/pages/builds/builds']) await assertUnavailable(await open(url));
    for (const route of [shared.path, '/api/builds']) {
      const response = await fetch(`${fixture.baseUrl}${route}`, { headers: { 'X-WX-OPENID': testOpenid }, signal: AbortSignal.timeout(8000) });
      assert.equal(response.status, 403, '服务端全关必须拒绝旧链接和进度读取');
      assert.equal((await response.json()).code, 'FEATURE_DISABLED');
      report.actions.push({ step: activeStep, type: 'feature-disabled-http', path: route, status: 403 });
    }
    page = await bounded('当前关闭的进度页', miniProgram.currentPage());
    const buildsOnly = setFixtureFeatures(['builds']);
    await refreshForegroundFeatures(page, buildsOnly);
    const restored = await dataReady(page, (data) => data.featureEnabled && !data.loading && data.items.some((item) => item.modelId === 'rg-001'));
    const record = restored.items.find((item) => item.modelId === 'rg-001');
    assert.deepEqual([record.quantity, record.completedCount, record.buildingCount, record.goal], [3, 1, 1, `${privateMarker}_GOAL`]);
    await checkpoint('builds-only-reenabled-progress-preserved', page, '.briefing');
    page = await open('/pages/purchased/purchased');
    await dataReady(page, (data) => !data.loading && !data.loadError && data.ratingMode === 'collection');
    assert.equal((await bounded('只开进度仍保留原收藏雷达', page.$$('.radar-section'))).length, 1);
    assert.equal((await bounded('只开进度仍保留原展开入口', page.$$('.score-toggle'))).length, 1);
    page = await open('/pages/home/home');
    assert.equal((await bounded('仅开启进度入口', page.$$('[data-entry="builds"]'))).length, 1);
    assert.equal((await bounded('其余玩法仍关闭', page.$$('.search-section, .recent-list, [data-entry="squad"], [data-entry="quiz"], [data-entry="lineage"], [data-entry="compare"]'))).length, 0);
  } finally {
    for (const [variable, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
  }
}

async function runVerification() {
  const suites = [
    ['01-home-search-recent-series', homeAndSeries], ['02-model-favorite-purchase', modelCollection],
    ['03-wishlist-purchased-public-shares', collectionShares], ['04-squad-draft-share-canvas', squad],
    ['05-quiz-create-visitor-server-score', quiz], ['06-builds-progress-goal-report', builds],
    ['07-lineage-progress', lineage], ['08-compare-two-models-share', compare],
    ['09-layout-loading-server-feature-controls', layoutAndFeatureControls],
  ];
  evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gundam-simulator-evidence-'));
  projectPath = path.join(evidenceDir, 'test-project');
  console.log(`[simulator] 证据目录：${evidenceDir}`);
  try {
    await fs.access(cliPath);
    await copySources();
    fixture = await createMysqlFixture({ allowLocalMockAuth: true });
    report.backend = { ...report.backend, baseUrl: fixture.baseUrl, database: fixture.database, openid: testOpenid, compiledSource: await backendHash() };
    await seedCatalog(fixture.connection);
    await configureLocalCopy();
    miniProgram = await bounded('官方开发者工具 launch', automator.launch({ cliPath, projectPath, trustProject: true, timeout: 90000 }), 95000);
    miniProgram.on('exception', (exception) => report.exceptions.push({ step: activeStep, time: new Date().toISOString(), exception }));
    report.automation.systemInfo = await bounded('模拟器系统信息', miniProgram.systemInfo());
    miniProgram.on('console', (entry) => report.console.push({ step: activeStep, entry }));
    draftExisted = (await bounded('读取草稿存储状态', miniProgram.callWxMethod('getStorageInfoSync'))).keys.includes('gundam-squad-draft-v1');
    originalDraft = await bounded('备份本地编队草稿', miniProgram.callWxMethod('getStorageSync', 'gundam-squad-draft-v1'));
    draftRead = true;
    await bounded('移除测试副本的旧草稿', miniProgram.callWxMethod('removeStorageSync', 'gundam-squad-draft-v1'));
    assert.deepEqual(await request(`${fixture.baseUrl}/api/features`), { version: 1, features: enabledFeatures });
    const home = await open('/pages/home/home');
    await poll('原八组玩法全部启用', () => home.data('features'), (features) => Object.keys(enabledFeatures).every((key) => features?.[key] === true));
    for (const [name, operation] of suites) {
      remaining();
      await step(name, operation);
    }
    report.status = report.steps.every((result) => result.status === 'pass') && report.exceptions.length === 0 ? 'simulator-validated-with-device-boundaries' : 'failed';
  } catch (error) {
    report.status = 'failed'; report.setupError = error.stack || error.message;
    console.error(`[simulator] ${error.message}`);
    if (miniProgram) {
      try { report.setupScreenshot = await capture('setup-failure', true); }
      catch (captureError) { report.setupScreenshotError = captureError.message; }
    }
  } finally {
    for (const [name] of suites) if (!report.steps.some((result) => result.name === name)) report.steps.push({ name, status: 'not-run', reason: '环境准备失败或运行中断' });
    if (miniProgram) {
      try {
        if (draftRead) {
          if (draftExisted) await bounded('恢复原编队草稿', miniProgram.callWxMethod('setStorageSync', 'gundam-squad-draft-v1', originalDraft), 10000, true);
          else await bounded('清理验收草稿', miniProgram.callWxMethod('removeStorageSync', 'gundam-squad-draft-v1'), 10000, true);
        }
      } catch (error) { report.storageCleanupError = error.message; report.status = 'failed'; }
      // close() 会关闭用户 IDE；这里只断开官方自动化连接。
      try { await bounded('断开官方自动化连接', miniProgram.disconnect(), 10000, true); } catch (error) { report.disconnectError = error.message; }
    }
    if (fixture) {
      try { await bounded('清理隔离后端与数据库', fixture.close(), 30000, true); report.backend.cleanedUp = true; }
      catch (error) { report.backend.cleanupError = error.message; report.status = 'failed'; }
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidenceDir, 'result.json'), JSON.stringify(report, null, 2));
    console.log(`[simulator] ${report.status}；${report.steps.filter((result) => result.status === 'pass').length}/${suites.length} 组通过；证据：${path.join(evidenceDir, 'result.json')}`);
    if (report.status !== 'simulator-validated-with-device-boundaries') process.exitCode = 1;
    if (report.backend.cleanupError || report.disconnectError) process.exit(1);
  }
}

async function main() {
  let rejectAsynchronousFailure;
  asynchronousFailure = new Promise((_, reject) => { rejectAsynchronousFailure = reject; });
  // SDK on('console') 内部的 App.enableLog Promise 没有返回给调用方。
  // 将这类未处理拒绝转入验收失败通道，让 finally 仍可保存证据和清理 fixture。
  asynchronousFailure.catch(() => {});
  const onUnhandledRejection = (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    (report.unhandledRejections ||= []).push({ step: activeStep, error: error.stack || error.message });
    interrupted = true;
    report.status = 'failed';
    rejectAsynchronousFailure(error);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  try { await runVerification(); }
  finally {
    process.removeListener('unhandledRejection', onUnhandledRejection);
    asynchronousFailure = undefined;
  }
}

module.exports = { findScrollContainer, waitForStableOffset, assertSameMenuLayout, main };

if (require.main === module) {
  process.once('SIGINT', () => { interrupted = true; });
  process.once('SIGTERM', () => { interrupted = true; });
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
