const assert = require('node:assert/strict');
const test = require('node:test');
const { findScrollContainer } = require('../scripts/verify-simulator.cjs');

// 仅验证验收脚本的滚动作用域规则，不代表真实模拟器验收通过。
test('购买组件弹层优先滚动自己的内容，不查询背景页面', async () => {
  const sheet = { name: 'purchase-form .sheet-content' };
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
