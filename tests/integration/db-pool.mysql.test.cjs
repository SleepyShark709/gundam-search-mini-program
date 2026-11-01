const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { createMysqlFixture } = require('../helpers/mysql-fixture.cjs');

test('真实 MySQL 空闲回收和连接断开后恢复均保留已提交业务数据', {
  skip: process.env.MYSQL_INTEGRATION === '1' ? false : '请显式设置 MYSQL_INTEGRATION=1，并使用 MYSQL_TEST_* 指向本机测试实例',
  timeout: 100000,
}, async (t) => {
  const { connection, database, close } = await createMysqlFixture();
  t.after(async () => {
    await close();
    t.diagnostic(`已验证连接池验收随机库 ${database} 完整清理`);
  });
  const pool = require('../../server/dist/db/pool.js').default;
  const owner = 'pool-idle-owner';
  const note = '空闲与重连后仍保留';
  const first = await pool.getConnection();
  let firstId;
  try {
    const [rows] = await first.query('SELECT CONNECTION_ID() AS connectionId');
    firstId = rows[0].connectionId;
    await first.beginTransaction();
    await first.query('INSERT INTO purchases (openid, model_id, note) VALUES (?, ?, ?)', [owner, 'hg-001', note]);
    await first.commit();
  } finally {
    first.release();
  }

  // 使用生产的 60 秒 idleTimeout，等待期间不向连接池发送任何请求。
  await delay(65000);
  const [idleConnections] = await connection.query('SELECT ID FROM information_schema.PROCESSLIST WHERE ID = ?', [firstId]);
  assert.equal(idleConnections.length, 0, '原连接应在空闲超过 60 秒后被回收');
  const query = () => pool.query('SELECT CONNECTION_ID() AS connectionId, note FROM purchases WHERE openid = ?', [owner]);
  const [afterIdle] = await query();
  assert.equal(afterIdle.length, 1);
  assert.equal(afterIdle[0].note, note);
  assert.notEqual(afterIdle[0].connectionId, firstId, '下一次业务查询应创建新连接');

  const killed = await pool.getConnection();
  const [rows] = await killed.query('SELECT CONNECTION_ID() AS connectionId');
  const killedId = rows[0].connectionId;
  const disconnected = new Promise((resolve) => {
    killed.once('error', resolve);
    killed.once('end', resolve);
  });
  killed.release();
  await connection.query('KILL CONNECTION ?', [killedId]);
  await disconnected;
  const [afterDisconnect] = await query();
  assert.equal(afterDisconnect.length, 1);
  assert.equal(afterDisconnect[0].note, note);
  assert.notEqual(afterDisconnect[0].connectionId, killedId, '失效空闲连接移除后应正常建立新连接');
});
