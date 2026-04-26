import mysql from 'mysql2/promise';

/**
 * 一次性迁移：创建论坛相关表 forum_posts、forum_replies。
 *
 * 用法：
 *   cd server && MYSQL_ADDRESS=<地址:端口> MYSQL_USERNAME=root MYSQL_PASSWORD=<密码> npx ts-node src/scripts/migrate-forum.ts
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

  const tables: { name: string; sql: string }[] = [
    {
      name: 'forum_posts',
      sql: `CREATE TABLE IF NOT EXISTS forum_posts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        openid VARCHAR(64) NOT NULL,
        title VARCHAR(120) NOT NULL,
        content TEXT NOT NULL,
        reply_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_reply_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_openid (openid),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    },
    {
      name: 'forum_replies',
      sql: `CREATE TABLE IF NOT EXISTS forum_replies (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        post_id BIGINT UNSIGNED NOT NULL,
        openid VARCHAR(64) NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_post_id (post_id, created_at),
        INDEX idx_openid (openid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    },
  ];

  for (const t of tables) {
    try {
      await conn.query(t.sql);
      console.log(`✓ 已创建/确认表: ${t.name}`);
    } catch (e: any) {
      console.error(`✗ 创建表失败: ${t.name}`, e.message);
      throw e;
    }
  }

  for (const t of tables) {
    const [rows] = await conn.query(`DESCRIBE ${t.name}`);
    console.log(`\n${t.name} 表结构：`);
    console.table(rows);
  }

  await conn.end();
  console.log('\n迁移完成');
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
