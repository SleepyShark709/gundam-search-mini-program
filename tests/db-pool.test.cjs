const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/load-typescript.cjs');

test('连接池空闲超过十分钟不主动发送 SQL，业务查询仍可正常执行', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const calls = [];
  const result = [[{ value: 42 }], []];
  const fakePool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return result;
    },
  };
  let options;
  const { exports } = loadModule('server/src/db/pool.ts', {
    mocks: {
      'dotenv/config': {},
      'mysql2/promise': { default: { createPool(config) { options = config; return fakePool; } } },
    },
    globals: { process: { env: {} }, setInterval, clearInterval },
  });

  assert.equal(options.idleTimeout, 60000);
  assert.equal(options.enableKeepAlive, true);
  assert.equal(options.keepAliveInitialDelay, 0);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(11 * 60 * 1000);
  assert.equal(calls.length, 0, '无人请求时不得用 SQL 唤醒数据库');

  assert.equal(await exports.default.query('SELECT ? AS value', [42]), result);
  assert.deepEqual(calls, [{ sql: 'SELECT ? AS value', values: [42] }]);
  t.mock.timers.tick(11 * 60 * 1000);
  assert.equal(calls.length, 1, '业务查询后重新空闲也不得产生保活 SQL');
});
