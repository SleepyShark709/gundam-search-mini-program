import mysql from 'mysql2/promise';

/**
 * 查询数据库中所有有数据的 openid（按数据量排序）
 *
 * 用法：
 *   cd server && MYSQL_ADDRESS=<地址:端口> MYSQL_USERNAME=root MYSQL_PASSWORD=<密码> npx ts-node src/scripts/find-openids.ts
 */
async function main() {
  const addressRaw = process.env.MYSQL_ADDRESS || '';
  const [host, portStr] = addressRaw.split(':');
  const port = parseInt(portStr, 10) || 3306;

  const conn = await mysql.createConnection({
    host,
    port,
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'gundam',
  });

  const [rows] = await conn.query(`
    SELECT
      u.openid,
      usr.nickname,
      (SELECT COUNT(*) FROM wishlists WHERE openid = u.openid) AS wishlist_count,
      (SELECT COUNT(*) FROM purchases WHERE openid = u.openid) AS purchase_count
    FROM (
      SELECT openid FROM users
      UNION
      SELECT openid FROM wishlists
      UNION
      SELECT openid FROM purchases
    ) AS u
    LEFT JOIN users usr ON usr.openid = u.openid
    GROUP BY u.openid, usr.nickname
    ORDER BY (wishlist_count + purchase_count) DESC
  `);

  console.log('\n所有有数据的 openid（含昵称）：');
  console.table(rows);

  await conn.end();
}

main().catch((e) => {
  console.error('查询失败:', e);
  process.exit(1);
});
