import mysql from 'mysql2/promise';

/**
 * 一次性迁移：给 users 表添加 nickname、avatar_url、updated_at 字段
 *
 * 用法：
 *   cd server && MYSQL_ADDRESS=<地址:端口> MYSQL_USERNAME=root MYSQL_PASSWORD=<密码> npx ts-node src/scripts/migrate-users.ts
 */
async function main() {
  const addressRaw = process.env.MYSQL_ADDRESS || '';
  const [host, portStr] = addressRaw.split(':');
  const port = parseInt(portStr, 10) || 3306;

  if (!host) {
    console.error('错误：缺少 MYSQL_ADDRESS 环境变量');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'gundam',
  });

  console.log('已连接数据库，开始迁移...');

  const columns = [
    { name: 'nickname', def: 'VARCHAR(64) DEFAULT NULL' },
    { name: 'avatar_url', def: 'VARCHAR(500) DEFAULT NULL' },
    { name: 'updated_at', def: 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  ];

  for (const col of columns) {
    try {
      await conn.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✓ 已添加字段: ${col.name}`);
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log(`- 字段已存在，跳过: ${col.name}`);
      } else {
        console.error(`✗ 添加字段失败: ${col.name}`, e.message);
        throw e;
      }
    }
  }

  const [rows] = await conn.query('DESCRIBE users');
  console.log('\n当前 users 表结构：');
  console.table(rows);

  await conn.end();
  console.log('\n迁移完成');
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
