import 'dotenv/config';
import mysql from 'mysql2/promise';

/** 用法：cd server && npx ts-node src/scripts/migrate-hangar.ts（使用现有 MYSQL_* 配置） */
async function main() {
  const [host, portStr] = (process.env.MYSQL_ADDRESS || '').split(':');
  if (!host) throw new Error('缺少 MYSQL_ADDRESS 环境变量');
  const connection = await mysql.createConnection({
    host,
    port: parseInt(portStr, 10) || 3306,
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'gundam',
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS build_progress (
      purchase_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      completed_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      building_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      goal VARCHAR(100) NOT NULL DEFAULT '',
      goal_done_date DATE DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_build_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await connection.query(`CREATE TABLE IF NOT EXISTS share_snapshots (
      id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      openid VARCHAR(64) NOT NULL,
      payload JSON NOT NULL,
      quiz_answers JSON DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_openid (openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('机库迁移完成：已确认 build_progress、share_snapshots 表，现有数据保持不变');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('机库迁移失败:', error);
  process.exitCode = 1;
});
