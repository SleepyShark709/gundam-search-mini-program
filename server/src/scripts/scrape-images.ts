/**
 * 万代官网产品多图爬取脚本
 *
 * 从 bandai-hobby.net 产品页面抓取多张产品图片：
 * 1. 解析产品页 swiper 区域中的 CloudFront 签名图片 URL
 * 2. 下载图片到 server/public/images/{model_id}/ 目录
 * 3. 将本地路径写入 model_images 表
 *
 * 使用方法：
 *   cd server && npx ts-node src/scripts/scrape-images.ts
 *
 * 可选参数：
 *   --series hg        只爬取指定系列
 *   --limit 10         限制爬取数量（用于测试）
 *   --delay 2000       请求间隔毫秒数（默认 2000）
 *   --skip-existing    跳过已有图片的模型
 *   --dry-run          只展示找到的图片，不下载不写库
 */

import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

// ---- 配置 ----
const DEFAULT_DELAY = 2000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IMAGE_DIR = path.resolve(__dirname, '../../public/images');

// ---- 参数解析 ----
interface Config {
  series?: string;
  limit?: number;
  delay: number;
  skipExisting: boolean;
  dryRun: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    delay: DEFAULT_DELAY,
    skipExisting: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--series':
        config.series = args[++i];
        break;
      case '--limit':
        config.limit = parseInt(args[++i], 10);
        break;
      case '--delay':
        config.delay = parseInt(args[++i], 10);
        break;
      case '--skip-existing':
        config.skipExisting = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
    }
  }

  return config;
}

// ---- HTML 解析：从产品页提取 CloudFront 签名图片 URL ----

/**
 * 从产品页 HTML 中提取产品图片 URL
 *
 * 万代官网产品页使用 swiper 轮播展示图片，结构如下：
 *   <div class="js-swiper__main">
 *     <div class="swiper-wrapper">
 *       <div class="swiper-slide">
 *         <a href="..." data-fancybox="images">
 *           <img src="https://d3bk8pkqsprcvh.cloudfront.net/hobby/jp/product/..." />
 *         </a>
 *       </div>
 *     </div>
 *   </div>
 *
 * 图片托管在 CloudFront CDN，URL 带有临时签名（Expires/Signature 参数）。
 * 签名通常几小时后过期，因此必须在爬取后立即下载。
 */
function extractImageUrls(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // 策略 1（主策略）：匹配 data-fancybox="images" 链接中的图片 URL
  // 这是主图区域，每张图都有 <a data-fancybox="images"><img src="..."></a>
  const fancyboxRegex = /data-fancybox="images"[^>]*>\s*<img\s+src="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = fancyboxRegex.exec(html)) !== null) {
    addImage(match[1]);
  }

  // 策略 2（备选）：如果策略 1 未命中，尝试匹配 js-swiper__main 区域内的 img
  if (images.length === 0) {
    const swiperMainRegex =
      /js-swiper__main[\s\S]*?<div class="swiper-wrapper">([\s\S]*?)<\/div>\s*<div class="swiper-button/;
    const swiperMatch = swiperMainRegex.exec(html);
    if (swiperMatch) {
      const swiperHtml = swiperMatch[1];
      const imgRegex = /<img\s+src="([^"]+)"/gi;
      while ((match = imgRegex.exec(swiperHtml)) !== null) {
        addImage(match[1]);
      }
    }
  }

  // 策略 3（兜底）：匹配所有 CloudFront 产品图片 URL
  if (images.length === 0) {
    const cfRegex = /src="(https:\/\/d3bk8pkqsprcvh\.cloudfront\.net\/hobby\/[^"]+)"/gi;
    while ((match = cfRegex.exec(html)) !== null) {
      addImage(match[1]);
    }
  }

  function addImage(url: string) {
    // 去除签名参数后用于去重（同一张图的签名参数相同，但以防万一）
    const baseUrl = url.split('?')[0];
    if (seen.has(baseUrl)) return;
    seen.add(baseUrl);
    images.push(url); // 保留完整签名 URL 用于下载
  }

  return images;
}

// ---- 网络请求 ----

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.warn(`  [${response.status}] ${url}`);
      return null;
    }

    const text = await response.text();

    // 万代网站有时返回 HTTP 200 但实际是 404 页面
    if (text.includes('<title>404 NOT FOUND')) {
      console.warn(`  [soft-404] ${url}`);
      return null;
    }

    return text;
  } catch (err: any) {
    console.warn(`  [error] ${url}: ${err.message}`);
    return null;
  }
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.warn(`  下载失败 [${response.status}]: ${url.substring(0, 80)}...`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) {
      // 过小的文件可能是错误响应
      console.warn(`  文件过小 (${buffer.length}B), 跳过`);
      return false;
    }

    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err: any) {
    console.warn(`  下载异常: ${err.message}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 根据图片 URL 推断文件扩展名
 */
function getExtension(url: string): string {
  const pathname = url.split('?')[0];
  const ext = path.extname(pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
  return '.jpg'; // 默认
}

// ---- 图片处理：下载并保存到本地 ----

/**
 * 下载图片到 server/public/images/{modelId}/ 并返回本地路径数组
 */
async function downloadModelImages(
  modelId: string,
  imageUrls: string[],
): Promise<string[]> {
  const modelDir = path.join(IMAGE_DIR, modelId);

  // 确保目录存在
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  const localPaths: string[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const ext = getExtension(imageUrls[i]);
    const filename = `${i}${ext}`;
    const destPath = path.join(modelDir, filename);
    const localPath = `/images/${modelId}/${filename}`;

    const ok = await downloadImage(imageUrls[i], destPath);
    if (ok) {
      localPaths.push(localPath);
    }

    // 图片之间短暂间隔，避免被限流
    if (i < imageUrls.length - 1) {
      await sleep(200);
    }
  }

  return localPaths;
}

// ---- 主流程 ----

async function main() {
  const config = parseArgs();

  console.log('========================================');
  console.log('  万代官网产品多图爬取脚本');
  console.log('========================================');
  console.log(
    `  配置: delay=${config.delay}ms, series=${config.series || 'all'}, limit=${config.limit || 'all'}, skipExisting=${config.skipExisting}, dryRun=${config.dryRun}`,
  );
  console.log(`  图片保存目录: ${IMAGE_DIR}`);
  console.log('');

  // 确保图片根目录存在
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  // 查询需要爬取的模型
  let query = 'SELECT id, product_url FROM models';
  const params: any[] = [];

  if (config.series) {
    query += ' WHERE series = ?';
    params.push(config.series);
  }

  query += ' ORDER BY series ASC, number ASC';

  if (config.limit) {
    query += ' LIMIT ?';
    params.push(config.limit);
  }

  const [models] = await pool.query<RowDataPacket[]>(query, params);
  console.log(`[scrape] 共 ${models.length} 个模型待处理`);

  // 如果跳过已有图片的模型，先查已有记录
  let existingSet = new Set<string>();
  if (config.skipExisting) {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT DISTINCT model_id FROM model_images',
    );
    existingSet = new Set(existing.map((r) => r.model_id as string));
    console.log(`[scrape] 已有 ${existingSet.size} 个模型有图片数据，将跳过`);
  }

  let processed = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let totalImages = 0;

  for (const model of models) {
    const modelId = model.id as string;
    const productUrl = model.product_url as string;

    if (config.skipExisting && existingSet.has(modelId)) {
      skipped++;
      continue;
    }

    processed++;
    process.stdout.write(
      `[scrape] (${processed}/${models.length - skipped}) ${modelId} ... `,
    );

    if (!productUrl) {
      console.log('无产品链接，跳过');
      failed++;
      continue;
    }

    const html = await fetchPage(productUrl);
    if (!html) {
      failed++;
      console.log('获取页面失败');
      await sleep(config.delay);
      continue;
    }

    const imageUrls = extractImageUrls(html);

    if (imageUrls.length === 0) {
      console.log('未找到图片');
      failed++;
      await sleep(config.delay);
      continue;
    }

    if (config.dryRun) {
      console.log(`找到 ${imageUrls.length} 张图片`);
      imageUrls.forEach((u, i) => console.log(`    [${i}] ${u.substring(0, 100)}...`));
      success++;
      totalImages += imageUrls.length;
      await sleep(config.delay);
      continue;
    }

    // 下载图片到本地
    const localPaths = await downloadModelImages(modelId, imageUrls);

    if (localPaths.length === 0) {
      console.log('所有图片下载失败');
      failed++;
      await sleep(config.delay);
      continue;
    }

    // 写入数据库（先删除旧数据再插入）
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query('DELETE FROM model_images WHERE model_id = ?', [modelId]);

      const values = localPaths.map((localPath, idx) => [modelId, localPath, idx]);
      await connection.query<ResultSetHeader>(
        'INSERT INTO model_images (model_id, image_url, sort_order) VALUES ?',
        [values],
      );

      await connection.commit();
      console.log(`${localPaths.length} 张图片已下载并入库`);
      success++;
      totalImages += localPaths.length;
    } catch (err) {
      await connection.rollback();
      console.log(`写入失败: ${err}`);
      failed++;
    } finally {
      connection.release();
    }

    await sleep(config.delay);
  }

  console.log('');
  console.log('========================================');
  console.log(
    `  完成！成功: ${success}, 失败: ${failed}, 跳过: ${skipped}, 共 ${totalImages} 张图片`,
  );
  if (config.dryRun) console.log('  (dry-run 模式，未下载图片)');
  console.log('========================================');

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[scrape] 致命错误:', err);
  process.exit(1);
});
