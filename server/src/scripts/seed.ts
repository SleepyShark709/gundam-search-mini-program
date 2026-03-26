/**
 * 数据初始化脚本：将本地 JSON 数据批量导入 MySQL
 *
 * 使用方法：
 *   cd server && npx ts-node src/scripts/seed.ts
 *
 * 需要设置环境变量或使用默认值连接数据库。
 */

import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/pool';
import { ResultSetHeader } from 'mysql2';

const DATA_DIR = path.resolve(__dirname, '../../../miniprogram/data');
const SERIES_CODES = ['hg', 'rg', 'mg', 'pg'];

interface SeriesMetaItem {
  code: string;
  name: string;
  shortName: string;
  scale: string;
  coverImage: string;
  totalCount: number;
}

interface ModelItem {
  id: string;
  series: string;
  number: number;
  name: string;
  nameJa: string;
  nameEn?: string;
  price: number;
  priceTaxFree: number;
  releaseDate: string;
  isLimited: boolean;
  limitedType?: string;
  imageUrl: string;
  productUrl: string;
  tags?: string[];
}

async function seedSeriesMeta() {
  const filePath = path.join(DATA_DIR, 'series-meta.json');
  const data: SeriesMetaItem[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`[seed] 导入 ${data.length} 条系列元信息...`);

  for (const item of data) {
    await pool.query(
      `INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         short_name = VALUES(short_name),
         scale = VALUES(scale),
         cover_image = VALUES(cover_image),
         total_count = VALUES(total_count)`,
      [item.code, item.name, item.shortName, item.scale, item.coverImage, item.totalCount]
    );
  }

  console.log('[seed] 系列元信息导入完成');
}

async function seedModels() {
  for (const code of SERIES_CODES) {
    const filePath = path.join(DATA_DIR, `${code}.json`);
    const data: ModelItem[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    console.log(`[seed] 导入 ${code.toUpperCase()} 系列 ${data.length} 条模型数据...`);

    // 分批插入，每批 100 条
    const BATCH_SIZE = 100;
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const values = batch.map((m) => [
        m.id,
        m.series,
        m.number,
        m.name,
        m.nameJa,
        m.nameEn || null,
        m.price,
        m.priceTaxFree,
        m.releaseDate,
        m.isLimited ? 1 : 0,
        m.limitedType || null,
        m.imageUrl,
        m.productUrl,
        m.tags && m.tags.length > 0 ? JSON.stringify(m.tags) : null,
      ]);

      await pool.query<ResultSetHeader>(
        `INSERT INTO models (id, series, number, name, name_ja, name_en, price, price_tax_free, release_date, is_limited, limited_type, image_url, product_url, tags)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           name_ja = VALUES(name_ja),
           name_en = VALUES(name_en),
           price = VALUES(price),
           price_tax_free = VALUES(price_tax_free),
           release_date = VALUES(release_date),
           is_limited = VALUES(is_limited),
           limited_type = VALUES(limited_type),
           image_url = VALUES(image_url),
           product_url = VALUES(product_url),
           tags = VALUES(tags)`,
        [values]
      );
    }

    console.log(`[seed] ${code.toUpperCase()} 系列导入完成`);
  }
}

async function main() {
  try {
    console.log('[seed] 开始数据导入...');
    await seedSeriesMeta();
    await seedModels();
    console.log('[seed] 所有数据导入完成！');
  } catch (err) {
    console.error('[seed] 导入失败:', err);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
