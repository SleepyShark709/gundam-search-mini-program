/**
 * 数据更新脚本（一键完成：数据导入 + 图片下载）
 *
 * 后续更新数据只需：
 *   1. 更新 miniprogram/data/ 下的 JSON 文件
 *   2. 运行此脚本
 *   3. 重新部署容器（图片已打包在 public/images/ 中）
 *   小程序无需发版。
 *
 * 使用方法：
 *   cd server
 *   MYSQL_ADDRESS=xx:3306 MYSQL_USERNAME=root MYSQL_PASSWORD=xx \
 *     npx ts-node src/scripts/update-data.ts
 *
 * 可选参数：
 *   --skip-images         跳过图片下载（只更新数据）
 *   --skip-data           跳过数据导入（只下载图片）
 *   --data-dir <path>     JSON 数据目录（默认 ../miniprogram/data）
 *   --image-dir <path>    图片输出目录（默认 ./public/images）
 *   --concurrency 5       图片下载并发数（默认 5）
 *   --series hg            只更新指定系列
 */

import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/pool';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

// 图片下载源（jsdelivr CDN，稳定快速）
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/SleepyShark709/gundam-menu@68f259b/public/images/bandai/';

// ---- 参数解析 ----
interface Config {
  skipImages: boolean;
  skipData: boolean;
  dataDir: string;
  imageDir: string;
  concurrency: number;
  series?: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    skipImages: false,
    skipData: false,
    dataDir: path.resolve(__dirname, '../../../miniprogram/data'),
    imageDir: path.join(__dirname, '../../public/images'),
    concurrency: 5,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--skip-images': config.skipImages = true; break;
      case '--skip-data': config.skipData = true; break;
      case '--data-dir': config.dataDir = path.resolve(args[++i]); break;
      case '--image-dir': config.imageDir = path.resolve(args[++i]); break;
      case '--concurrency': config.concurrency = parseInt(args[++i], 10); break;
      case '--series': config.series = args[++i]; break;
    }
  }
  return config;
}

// ======== 数据导入 ========

async function importSeriesMeta(dataDir: string): Promise<number> {
  const filePath = path.join(dataDir, 'series-meta.json');
  if (!fs.existsSync(filePath)) { console.warn(`  跳过：${filePath} 不存在`); return 0; }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  for (const item of data) {
    await pool.query(
      `INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), short_name = VALUES(short_name),
         scale = VALUES(scale), cover_image = VALUES(cover_image),
         total_count = VALUES(total_count)`,
      [item.code, item.name, item.shortName, item.scale, item.coverImage, item.totalCount]
    );
  }
  return data.length;
}

async function importModels(dataDir: string, onlySeries?: string): Promise<number> {
  const allSeries = ['hg', 'rg', 'mg', 'pg'];
  const seriesToImport = onlySeries ? [onlySeries] : allSeries;
  let totalCount = 0;

  for (const code of seriesToImport) {
    const filePath = path.join(dataDir, `${code}.json`);
    if (!fs.existsSync(filePath)) { console.warn(`  跳过：${filePath} 不存在`); continue; }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`  ${code.toUpperCase()}: ${data.length} 条`);

    const BATCH = 100;
    for (let i = 0; i < data.length; i += BATCH) {
      const batch = data.slice(i, i + BATCH);
      const values = batch.map((m: any) => [
        m.id, m.series, m.number, m.name, m.nameJa,
        m.nameEn || null, m.price, m.priceTaxFree, m.releaseDate,
        m.isLimited ? 1 : 0, m.limitedType || null,
        m.imageUrl, m.productUrl,
        m.tags && m.tags.length > 0 ? JSON.stringify(m.tags) : null,
      ]);
      await pool.query<ResultSetHeader>(
        `INSERT INTO models (id, series, number, name, name_ja, name_en, price, price_tax_free,
         release_date, is_limited, limited_type, image_url, product_url, tags) VALUES ?
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), name_ja = VALUES(name_ja), name_en = VALUES(name_en),
           price = VALUES(price), price_tax_free = VALUES(price_tax_free),
           release_date = VALUES(release_date), is_limited = VALUES(is_limited),
           limited_type = VALUES(limited_type), image_url = VALUES(image_url),
           product_url = VALUES(product_url), tags = VALUES(tags)`,
        [values]
      );
    }
    totalCount += data.length;
  }

  // 更新 total_count
  for (const code of seriesToImport) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM models WHERE series = ?', [code]
    );
    await pool.query('UPDATE series_meta SET total_count = ? WHERE code = ?', [rows[0].cnt, code]);
  }
  return totalCount;
}

// ======== 图片下载 ========

/** 从 imageUrl 中提取文件名 */
function extractFilename(url: string): string {
  return url.split('/').pop()!;
}

/** 下载单个文件 */
async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch { return false; }
}

async function downloadImages(config: Config): Promise<{ success: number; failed: number; skipped: number }> {
  fs.mkdirSync(config.imageDir, { recursive: true });

  // 收集所有需要下载的图片（模型 + 封面）
  interface Task { imageUrl: string }
  const tasks: Task[] = [];

  // 从 JSON 文件直接读取 imageUrl（不依赖数据库中的值）
  const allSeries = config.series ? [config.series] : ['hg', 'rg', 'mg', 'pg'];
  for (const code of allSeries) {
    const filePath = path.join(config.dataDir, `${code}.json`);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const m of data) {
      if (m.imageUrl) tasks.push({ imageUrl: m.imageUrl });
    }
  }

  // 封面图
  const metaPath = path.join(config.dataDir, 'series-meta.json');
  if (fs.existsSync(metaPath)) {
    const metas = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    for (const m of metas) {
      if (m.coverImage) tasks.push({ imageUrl: m.coverImage });
    }
  }

  console.log(`  共 ${tasks.length} 张图片`);

  let success = 0, failed = 0, skipped = 0;
  let taskIndex = 0;

  async function worker() {
    while (taskIndex < tasks.length) {
      const idx = taskIndex++;
      const task = tasks[idx];
      const filename = extractFilename(task.imageUrl);
      const dest = path.join(config.imageDir, filename);

      // 已存在则跳过
      if (fs.existsSync(dest)) { skipped++; continue; }

      // 构建下载 URL（统一从 jsdelivr CDN 下载）
      const downloadUrl = CDN_BASE + filename;
      const ok = await downloadFile(downloadUrl, dest);
      if (ok) success++; else failed++;

      const total = success + failed + skipped;
      if (total % 100 === 0) {
        process.stdout.write(`  进度: ${total}/${tasks.length} (新下载: ${success}, 跳过: ${skipped}, 失败: ${failed})\n`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(config.concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);

  return { success, failed, skipped };
}

/** 更新数据库中的 image_url 为本地路径 /images/xxx.jpg */
async function updateImageUrls(config: Config): Promise<number> {
  // 更新 models 表
  const [models] = await pool.query<RowDataPacket[]>('SELECT id, image_url FROM models');
  let updated = 0;
  for (const m of models) {
    const url = m.image_url as string;
    if (!url || url.startsWith('/images/')) continue;
    const filename = extractFilename(url);
    const localPath = `/images/${filename}`;
    const filePath = path.join(config.imageDir, filename);
    if (fs.existsSync(filePath)) {
      await pool.query('UPDATE models SET image_url = ? WHERE id = ?', [localPath, m.id]);
      updated++;
    }
  }

  // 更新 series_meta 表
  const [metas] = await pool.query<RowDataPacket[]>('SELECT code, cover_image FROM series_meta');
  for (const m of metas) {
    const url = m.cover_image as string;
    if (!url || url.startsWith('/images/')) continue;
    const filename = extractFilename(url);
    const localPath = `/images/${filename}`;
    const filePath = path.join(config.imageDir, filename);
    if (fs.existsSync(filePath)) {
      await pool.query('UPDATE series_meta SET cover_image = ? WHERE code = ?', [localPath, m.code]);
    }
  }

  return updated;
}

// ======== 主流程 ========

async function main() {
  const config = parseArgs();
  const startTime = Date.now();

  console.log('========================================');
  console.log('  高达模型目录 - 数据更新脚本');
  console.log('========================================\n');

  // Step 1: 数据导入
  if (!config.skipData) {
    if (!config.series) {
      console.log('[1/3] 导入系列元信息...');
      const metaCount = await importSeriesMeta(config.dataDir);
      console.log(`  完成: ${metaCount} 条\n`);
    }

    console.log('[2/3] 导入模型数据...');
    const modelCount = await importModels(config.dataDir, config.series);
    console.log(`  完成: ${modelCount} 条\n`);
  } else {
    console.log('[1/3] 跳过 (--skip-data)');
    console.log('[2/3] 跳过 (--skip-data)\n');
  }

  // Step 2: 图片下载 + URL 更新
  if (!config.skipImages) {
    console.log('[3/3] 下载产品图片（已有则跳过）...');
    const result = await downloadImages(config);
    console.log(`  完成: 新下载 ${result.success}, 已有跳过 ${result.skipped}, 失败 ${result.failed}`);

    // 更新数据库中的 URL 为本地路径
    console.log('  更新数据库图片路径...');
    const updated = await updateImageUrls(config);
    console.log(`  完成: ${updated} 条\n`);

    // 统计
    const files = fs.readdirSync(config.imageDir);
    const totalSize = files.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(config.imageDir, f)).size; } catch { return sum; }
    }, 0);
    console.log(`  图片目录: ${config.imageDir}`);
    console.log(`  共 ${files.length} 个文件, ${(totalSize / 1024 / 1024).toFixed(1)}MB\n`);
  } else {
    console.log('[3/3] 跳过 (--skip-images)\n');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('========================================');
  console.log(`  更新完成！耗时 ${elapsed}s`);
  console.log('========================================');

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[update-data] 致命错误:', err);
  process.exit(1);
});
