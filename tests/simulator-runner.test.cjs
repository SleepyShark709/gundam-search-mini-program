const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { findScrollContainer, waitForStableOffset } = require('../scripts/verify-simulator.cjs');

// 单测只验证 runner 的作用域和失败清理，不代表真实模拟器验收通过。
test('虚拟购买组件的实际弹层优先滚动自身内容，不查询背景页面', async () => {
  const sheet = { name: 'form--overlay form--sheet-content' };
  const calls = [];
  const form = { async $(selector) { calls.push(selector); return sheet; } };
  const page = { async $() { assert.fail('组件存在内部滚动区时不应查询背景页'); } };

  assert.equal(await findScrollContainer(form, page), sheet);
  assert.deepEqual(calls, ['scroll-view']);
});

test('组件没有内部滚动区时优先选择页面编辑浮层', async () => {
  const editor = { name: 'builds .editor scroll-view' };
  const calls = [];
  const component = { async $(selector) { calls.push(`component:${selector}`); return null; } };
  const page = {
    async $(selector) {
      calls.push(`page:${selector}`);
      assert.equal(selector, '.editor scroll-view');
      return editor;
    },
  };

  assert.equal(await findScrollContainer(component, page), editor);
  assert.deepEqual(calls, ['component:scroll-view', 'page:.editor scroll-view']);
});

test('页面作用域也优先编辑浮层，不误选第一个背景滚动区', async () => {
  const editor = { name: 'editor' };
  const page = {
    async $(selector) {
      assert.equal(selector, '.editor scroll-view');
      return editor;
    },
  };

  assert.equal(await findScrollContainer(page, page), editor);
});

test('没有组件滚动区或编辑浮层时才回退页面滚动区', async () => {
  const background = { name: 'page scroll-view' };
  const calls = [];
  const component = { async $(selector) { calls.push(`component:${selector}`); return null; } };
  const page = {
    async $(selector) {
      calls.push(`page:${selector}`);
      return selector === 'scroll-view' ? background : null;
    },
  };

  assert.equal(await findScrollContainer(component, page), background);
  assert.deepEqual(calls, ['component:scroll-view', 'page:.editor scroll-view', 'page:scroll-view']);
});

test('滚动后须进入视口并连续三次位置稳定，停稳后再复查位置', async () => {
  const tops = [900, 900, 900, 400, 300, 300, 300, 300];
  let reads = 0;
  const target = { async offset() { return { left: 16, top: tops[reads++] }; } };
  const offset = await waitForStableOffset('卡片滚动', target, (position) => position.top < 600);
  assert.equal(reads, tops.length, '视口外静止和视口内移动都不能提前结束等待');
  assert.deepEqual(offset, { left: 16, top: 300 });
});

test('连续稳定后再次移动的元素不能用于点击', async () => {
  const tops = [300, 300, 300, 340];
  let reads = 0;
  const target = { async offset() { return { left: 16, top: tops[reads++] }; } };
  await assert.rejects(waitForStableOffset('卡片滚动', target, () => true), /仍须稳定且在视口内/);
  assert.equal(reads, tops.length);
});

test('同样762px逻辑窗口下按模型页844px渲染根判断，同时保留首页原生tabbar遮挡', async () => {
  const runnerPath = path.resolve(__dirname, '../scripts/verify-simulator.cjs');
  const context = {
    require, module: { exports: {} }, __dirname: path.dirname(runnerPath),
    process, console, Buffer, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(runnerPath, 'utf8') + `
    report.automation.systemInfo = { windowWidth: 390, windowHeight: 762, screenHeight: 844, statusBarHeight: 47 };
    module.exports.visibleForTest = (scope, program) => { miniProgram = program; return visible(scope, '.submit-button'); };
  `, context, { filename: runnerPath });
  let systemInfoReads = 0;
  let top = 745;
  const scrolls = [];
  const button = {
    async size() { return { width: 358, height: 52 }; },
    async offset() { return { left: 16, top }; },
  };
  const scroll = {
    async property() { return 0; },
    async scrollTo(x, y) { scrolls.push([x, y]); top = 300; },
  };
  const frame = {
    async size() { return { width: 390, height: 844 }; },
    async offset() { return { left: 0, top: 0 }; },
  };
  const page = {
    path: 'pages/model/model',
    async $$() { return [button]; },
    async $(selector) { return selector === '.page' ? frame : selector === 'scroll-view' ? scroll : null; },
  };
  const program = {
    async systemInfo() { systemInfoReads += 1; return { windowWidth: 390, windowHeight: 762, screenHeight: 844, statusBarHeight: 47 }; },
    async currentPage() { return page; },
  };
  assert.equal(await context.module.exports.visibleForTest(page, program), button);
  assert.deepEqual(scrolls, [], '模型页844px渲染区域中，745px的提交按钮已可见');
  page.path = 'pages/home/home';
  assert.equal(await context.module.exports.visibleForTest(page, program), button);
  assert.equal(systemInfoReads, 2);
  assert.deepEqual(scrolls, [[0, 625]], '首页原生tabbar仍须按762px逻辑窗口裁剪，不能无条件放宽');
});

// 子进程使用真实 SDK 的 on('console')，只替换传输、文件输入与 fixture，禁止连接 IDE/MySQL。
const startupFailureProcess = `
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const [runnerPath, evidenceDir, mode] = process.argv.slice(1);
const calls = [];
const connection = new EventEmitter();
connection.send = async (method, params) => {
  calls.push(method === 'App.callWxMethod' ? params.method : method);
  if (method === 'App.enableLog') throw new Error('timeout waiting for automator response');
  if (method === 'App.captureScreenshot') throw new Error('simulator screenshot unavailable');
  if (method === 'App.callWxMethod' && params.method === 'getSystemInfoSync' && mode === 'system-info') throw new Error('simulator not ready');
  if (method === 'App.callWxMethod' && params.method === 'getSystemInfoSync') return { result: { windowWidth: 375, windowHeight: 812 } };
  return new Promise(() => {});
};
connection.dispose = async () => { calls.push('disconnect'); };
const automator = {
  async launch() {
    calls.push('launch');
    if (mode === 'launch') throw new Error('official launch rejected');
    return new MiniProgram(connection);
  },
};
const inputFs = {
  ...fs,
  async mkdtemp() { return evidenceDir; },
  async access() {},
  async mkdir() {},
  async readdir() { return []; },
  async stat(file) { return { isDirectory: () => path.basename(file) === 'miniprogram' }; },
  async readFile(file, encoding) {
    let content = '[]';
    if (file.endsWith('project.config.json')) content = JSON.stringify({ appid: 'unit-test', setting: {} });
    if (file.endsWith('api.ts')) content = "const FORCE_USE_CLOUD = true; export const LOCAL_BASE = 'http://original'; const LOCAL_MOCK_OPENID = 'original';";
    return encoding ? content : Buffer.from(content);
  },
  async writeFile(file, content) {
    if (path.basename(file) === 'result.json') await fs.writeFile(file, content);
  },
};
const fixture = {
  baseUrl: 'http://unit-test', database: 'unit-test',
  connection: { async query() {}, async execute() {} },
  async close() {
    calls.push('fixture.close');
    await fs.writeFile(path.join(evidenceDir, 'cleanup.json'), JSON.stringify(calls));
  },
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'node:fs/promises') return inputFs;
  if (request === 'node:child_process') return { execFileSync: () => 'unit-test-source' };
  if (request === 'miniprogram-automator') return automator;
  if (request.endsWith('/mysql-fixture.cjs')) return { createMysqlFixture: async () => fixture };
  return originalLoad.call(this, request, ...args);
};
require(runnerPath).main().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function runStartupFailure(t, mode) {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gundam-runner-unit-'));
  t.after(() => fs.rmSync(evidenceDir, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [
    '--unhandled-rejections=throw', '-e', startupFailureProcess,
    path.resolve(__dirname, '../scripts/verify-simulator.cjs'), evidenceDir, mode,
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 6000 });
  assert.ifError(child.error);
  assert.equal(child.status, 1, child.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'result.json'), 'utf8'));
  const calls = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'cleanup.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.backend.cleanedUp, true);
  assert.equal(report.steps.length, 8);
  assert.ok(report.steps.every((step) => step.status === 'not-run'));
  return { report, calls };
}

test('官方 launch 拒绝仍保存失败结果并清理 fixture', (t) => {
  const { report, calls } = runStartupFailure(t, 'launch');
  assert.match(report.setupError, /official launch rejected/);
  assert.deepEqual(calls, ['launch', 'fixture.close']);
});

test('SDK console 订阅的未处理拒绝转为失败并完成断开和 fixture 清理', (t) => {
  const { report, calls } = runStartupFailure(t, 'console');
  assert.match(report.setupError, /timeout waiting for automator response/);
  assert.equal(report.unhandledRejections.length, 1);
  assert.match(report.unhandledRejections[0].error, /timeout waiting for automator response/);
  assert.match(report.setupScreenshotError, /simulator screenshot unavailable/);
  assert.deepEqual(calls, ['launch', 'getSystemInfoSync', 'App.enableLog', 'getStorageInfoSync', 'App.captureScreenshot', 'disconnect', 'fixture.close']);
});

test('先等待模拟器系统信息，未就绪时不订阅 console 且截图失败仍清理', (t) => {
  const { report, calls } = runStartupFailure(t, 'system-info');
  assert.match(report.setupError, /simulator not ready/);
  assert.match(report.setupScreenshotError, /simulator screenshot unavailable/);
  assert.deepEqual(calls, ['launch', 'getSystemInfoSync', 'App.captureScreenshot', 'disconnect', 'fixture.close']);
});
