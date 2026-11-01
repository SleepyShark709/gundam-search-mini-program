const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const mysql = require('../../server/node_modules/mysql2/promise');

const serverRoot = path.resolve(__dirname, '../../server');
const run = promisify(execFile);

/** 仅供显式开启的本机验收；调用方必须在 finally/t.after 中执行 close()。 */
async function createMysqlFixture({ allowLocalMockAuth = false } = {}) {
  assert.equal(process.env.MYSQL_INTEGRATION, '1', '必须显式设置 MYSQL_INTEGRATION=1');
  const host = process.env.MYSQL_TEST_HOST || '127.0.0.1';
  assert.ok(['127.0.0.1', 'localhost'].includes(host), '集成测试仅允许连接本机 MySQL');
  const port = Number(process.env.MYSQL_TEST_PORT || 3306);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'MYSQL_TEST_PORT 必须为有效端口');
  const database = `gundam_test_${randomBytes(8).toString('hex')}`;
  assert.match(database, /^gundam_test_[a-f0-9]{16}$/);
  const user = process.env.MYSQL_TEST_USERNAME || 'root';
  const password = process.env.MYSQL_TEST_PASSWORD || '';
  const connection = await mysql.createConnection({ host, port, user, password, multipleStatements: true, connectTimeout: 10000 });
  const query = (sql, values) => connection.query({ sql, timeout: 10000 }, values);
  let created = false;
  let closed = false;
  let server;
  let pool;
  let previousEnv;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      try {
        if (pool) await pool.end();
      } finally {
        try {
          if (created) {
            await query(`DROP DATABASE \`${database}\``);
            const [remaining] = await query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
            assert.equal(remaining.length, 0, '随机测试数据库必须清理');
          }
        } finally {
          try {
            await connection.end();
          } finally {
            if (previousEnv) {
              for (const [name, value] of Object.entries(previousEnv)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
              }
            }
          }
        }
      }
    }
  }

  try {
    await query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await query(`USE \`${database}\``);
    const sql = await fs.readFile(path.join(serverRoot, 'src/db/init.sql'), 'utf8');
    // init.sql 的固定库名只用于部署；测试只能操作刚创建的随机库。
    const isolatedSql = sql.replace(/^CREATE DATABASE[^;]*;\s*/m, '').replace(/^USE[^;]*;\s*/m, '');
    assert.doesNotMatch(isolatedSql, /\b(?:CREATE\s+DATABASE|USE\s+`?gundam`?)\b/i);
    await query(isolatedSql);
    await query('DROP TABLE share_snapshots, build_progress');
    await query("INSERT INTO purchases (openid, model_id) VALUES ('migration-user', 'hg-001')");
    await query("INSERT INTO wishlists (openid, model_id) VALUES ('migration-user', 'hg-001')");

    // 禁止 dotenv 读取 server/.env 或仓库 .env；数据库参数均来自独立测试变量。
    const overrides = {
      DOTENV_CONFIG_PATH: '/dev/null',
      MYSQL_ADDRESS: `${host}:${port}`,
      MYSQL_USERNAME: user,
      MYSQL_PASSWORD: password,
      MYSQL_DATABASE: database,
      SKIP_MSG_SEC_CHECK: 'true',
      NODE_ENV: allowLocalMockAuth ? 'development' : 'production',
      ALLOW_LOCAL_MOCK_AUTH: allowLocalMockAuth ? 'true' : 'false',
      WX_APPID: 'wx422623fec834054c',
      PORT: '0',
      FEATURE_DISCOVERY: 'true',
      FEATURE_SHARING: 'true',
      FEATURE_SQUAD: 'true',
      FEATURE_QUIZ: 'true',
      FEATURE_BUILDS: 'true',
      FEATURE_LINEAGE: 'true',
      FEATURE_COMPARE: 'true',
      FEATURE_PILOT_RATING: 'true',
    };
    const env = { ...process.env, ...overrides };
    for (let index = 0; index < 2; index += 1) {
      const { stdout } = await run(process.execPath, ['dist/scripts/migrate-hangar.js'], {
        cwd: serverRoot, env, timeout: 20000,
      });
      assert.match(stdout, /机库迁移完成/);
    }
    for (const [index, id] of ['hg-001', 'hg-002', 'hg-003'].entries()) {
      await query(
        `INSERT INTO models (id, series, number, name, name_ja, name_en, price, price_tax_free,
         release_date, is_limited, limited_type, image_url, product_url, tags)
         VALUES (?, 'hg', ?, ?, 'ガンダム', 'Gundam', 1100, 1000, '2026-01', ?, ?, ?, ?, ?)`,
        [id, index + 1, `测试高达 ${index + 1}`, index === 1 ? 1 : 0, index === 1 ? 'pbandai' : null,
          `/images/${id}.jpg`, `https://example.com/${id}`, JSON.stringify(['高达', 'UC'])]
      );
    }
    await query("INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count) VALUES ('hg', 'HG 系列', 'HG', '1/144', '/images/hg-001.jpg', 3)");
    previousEnv = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]));
    Object.assign(process.env, overrides);
    pool = require('../../server/dist/db/pool.js').default;
    const app = require('../../server/dist/app.js').default;
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { connection, baseUrl: `http://127.0.0.1:${server.address().port}`, database, close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { createMysqlFixture };
