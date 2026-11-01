/**
 * 万代官网数据爬取脚本（一键更新）
 *
 * 从 bandai-hobby.net 爬取最新产品数据，自动发现新产品并更新本地 JSON 文件。
 * 可选同步到数据库。
 *
 * 使用方法：
 *   cd server && npx ts-node src/scripts/scrape-bandai.ts
 *
 * 可选参数：
 *   --series hg            只爬取指定系列（hg/rg/mg/pg）
 *   --max-pages 5          每个系列最多爬取页数（默认 5，设 0 爬全部）
 *   --delay 1500           请求间隔毫秒数（默认 1500）
 *   --dry-run              只展示新发现的产品，不写入文件
 *   --sync-db              同时更新数据库（需要数据库连接）
 *   --full                 全量爬取所有页面（等价于 --max-pages 0）
 *   --force                强制更新已存在产品的信息（价格、日期等）
 *   --update-prices        仅更新已有产品的价格，保留原发售日期
 *   --download-images      下载新产品首图并使用本地稳定路径
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// ---- 配置 ----
const BASE_URL = 'https://bandai-hobby.net';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BRAND_URLS: Record<string, string> = {
  hg: '/brand/hg/',
  rg: '/brand/rg/',
  mg: '/brand/mg/',
  pg: '/brand/pg/',
};

const DATA_DIR = path.resolve(__dirname, '../../../miniprogram/data');
const IMAGE_DIR = path.resolve(__dirname, '../../public/images');

// 限定类型映射（列表页 CSS 类 → 数据字段）
const TAG_TO_LIMITED: Record<string, { isLimited: boolean; limitedType?: string }> = {
  '-online': { isLimited: true, limitedType: 'pbandai' },
  '-event': { isLimited: true, limitedType: 'event' },
  '-gbase': { isLimited: true, limitedType: 'gbase' },
  '-sidef': { isLimited: true, limitedType: 'sidef' },
};

// ---- 类型 ----
interface ScrapedProduct {
  nameJa: string;
  price: number;
  priceTaxFree: number;
  releaseDate: string;
  isLimited: boolean;
  limitedType?: string;
  imageUrl: string;
  productUrl: string;
}

interface ModelEntry {
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
  _limitedSource?: string;
  _limitedMethod?: string;
}

interface Config {
  series?: string;
  maxPages: number;
  delay: number;
  dryRun: boolean;
  syncDb: boolean;
  force: boolean;
  updatePrices: boolean;
  downloadImages: boolean;
}

// ---- 参数解析 ----
export function parseArgs(args = process.argv.slice(2)): Config {
  const config: Config = {
    maxPages: 5,
    delay: 1500,
    dryRun: false,
    syncDb: false,
    force: false,
    updatePrices: false,
    downloadImages: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--series':
        config.series = args[++i];
        break;
      case '--max-pages':
        config.maxPages = parseInt(args[++i], 10);
        break;
      case '--delay':
        config.delay = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--sync-db':
        config.syncDb = true;
        break;
      case '--full':
        config.maxPages = 0;
        break;
      case '--force':
        config.force = true;
        break;
      case '--update-prices':
        config.updatePrices = true;
        break;
      case '--download-images':
        config.downloadImages = true;
        break;
    }
  }

  return config;
}

// ---- 网络请求 ----
async function fetchResponse(url: string, accept: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Accept-Language': 'ja,en;q=0.5',
        },
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(500 * attempt);
    }
  }
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetchResponse(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  return response.text();
}

async function downloadCover(model: ModelEntry): Promise<string> {
  if (!model.imageUrl) throw new Error(`${model.id} 缺少首图地址`);
  const response = await fetchResponse(model.imageUrl, 'image/*');
  const buffer = Buffer.from(await response.arrayBuffer());
  // 解码验证并统一转为 JPEG，避免把防盗链 HTML 或损坏文件写成成功图片。
  const cover = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  const directory = path.join(IMAGE_DIR, model.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'cover.jpg'), cover);
  return `/images/${model.id}/cover.jpg`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- HTML 解析 ----

/**
 * 从列表页 HTML 中解析产品卡片
 *
 * 万代官网列表页卡片结构:
 * <a href="/item/01_XXXX/" class="c-card p-card -landscape">
 *   <div class="p-card__img"><img src="..." alt="..."></div>
 *   <div class="p-card__explain">
 *     <div class="p-card__tag -online">ホビーオンライン</div>  (可选)
 *     <div class="p-card__tit">产品名</div>
 *     <div class="p-card__under">
 *       <div class="p-card__price">2,420円(税10%込)</div>
 *       <div class="p-card_date">2026年08月</div>
 *     </div>
 *   </div>
 * </a>
 */
function decodeHtml(value: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return entities[code.toLowerCase()];
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function attribute(html: string, name: string): string {
  const match = html.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]) : '';
}

function normalizeProductUrl(value: string): string {
  const url = new URL(decodeHtml(value), BASE_URL);
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '') + '/';
}

export function parseListingPage(html: string, pageUrl = BASE_URL): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const cardRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(html)) !== null) {
    const classes = attribute(match[1], 'class').split(/\s+/);
    if (!classes.includes('p-card') || !classes.includes('-landscape')) continue;
    const href = attribute(match[1], 'href');
    if (!href) continue;
    const url = new URL(href, pageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (!(url.hostname === 'bandai-hobby.net' && url.pathname.startsWith('/item/')) &&
        !(url.hostname === 'p-bandai.jp' && url.pathname.startsWith('/item/item-'))) continue;
    const cardHtml = match[2];
    const titleMatch = cardHtml.match(/<div\b[^>]*class=["']p-card__tit["'][^>]*>([\s\S]*?)<\/div>/);
    const nameJa = titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]*>/g, '')).trim() : '';
    const priceMatch = cardHtml.match(/<div\b[^>]*class=["']p-card__price["'][^>]*>([\d,]+)円/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;
    const dateMatch = cardHtml.match(/<div\b[^>]*class=["']p-card_date["'][^>]*>(\d{4})年(\d{1,2})月/);
    const releaseDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}` : '';
    const tagMatch = cardHtml.match(/<div\b[^>]*class=["']p-card__tag\s+(-\w+)["']/);
    const limitedInfo = TAG_TO_LIMITED[tagMatch ? tagMatch[1] : ''] || { isLimited: false };
    const imgMatch = cardHtml.match(/<img\b([^>]*)>/i);
    const imgSrc = imgMatch ? attribute(imgMatch[1], 'src') : '';
    if (nameJa) {
      products.push({
        nameJa,
        price,
        priceTaxFree: price ? Math.round(price / 1.1) : 0,
        releaseDate,
        isLimited: limitedInfo.isLimited,
        limitedType: limitedInfo.limitedType,
        imageUrl: imgSrc ? new URL(imgSrc, pageUrl).href : '',
        productUrl: normalizeProductUrl(url.href),
      });
    }
  }
  return products;
}

function productKey(product: Pick<ModelEntry, 'nameJa'>): string {
  return decodeHtml(product.nameJa).normalize('NFKC').replace(/\s/g, '');
}

/** 获取列表页最大页码 */
function getMaxPage(html: string): number {
  // 匹配分页最后一个数字页码
  const matches = [...html.matchAll(/\?p=(\d+)"/g)];
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => parseInt(m[1], 10)));
}

// ---- 数据管理 ----

function loadData(seriesCode: string): ModelEntry[] {
  const filePath = path.join(DATA_DIR, `${seriesCode}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveData(seriesCode: string, data: ModelEntry[]): void {
  const filePath = path.join(DATA_DIR, `${seriesCode}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function updateSeriesMeta(seriesCode: string, totalCount: number): void {
  const filePath = path.join(DATA_DIR, 'series-meta.json');
  const meta = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const entry = meta.find((m: any) => m.code === seriesCode);
  if (entry) entry.totalCount = totalCount;
  const json = JSON.stringify(meta, null, 2);
  fs.writeFileSync(filePath, json + '\n', 'utf-8');
  fs.writeFileSync(path.join(DATA_DIR, 'series-meta.js'), `module.exports = ${json};\n`, 'utf-8');
}

/** 为新产品生成下一个编号 */
function getNextNumber(data: ModelEntry[], isLimited: boolean): number {
  const nums = data.filter((m) => m.isLimited === isLimited).map((m) => m.number);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

function makeId(series: string, number: number, isLimited: boolean): string {
  const numStr = String(number).padStart(3, '0');
  return isLimited ? `${series}-l-${numStr}` : `${series}-${numStr}`;
}

// ---- 爬取单个系列 ----

interface SeriesResult {
  newProducts: ModelEntry[];
  updatedCount: number;
  existingData: ModelEntry[];
}

export async function scrapeSeries(seriesCode: string, config: Config): Promise<SeriesResult> {
  const brandPath = BRAND_URLS[seriesCode];
  if (!brandPath) {
    console.error(`  未知系列: ${seriesCode}`);
    return { newProducts: [], updatedCount: 0, existingData: [] };
  }

  const existingData = loadData(seriesCode);
  const existingByUrl = new Map(existingData.filter((m) => m.productUrl).map((m) => [normalizeProductUrl(m.productUrl), m]));
  const existingByTitle = new Map<string, ModelEntry | null>();
  for (const model of existingData) {
    const title = productKey(model);
    existingByTitle.set(title, existingByTitle.has(title) ? null : model);
  }
  const findExisting = (product: ScrapedProduct) => existingByUrl.get(product.productUrl) || existingByTitle.get(productKey(product));
  console.log(`  现有数据: ${existingData.length} 条`);

  // --- 爬取列表页 ---
  const firstUrl = `${BASE_URL}${brandPath}`;
  const firstHtml = await fetchPage(firstUrl);

  const maxPage = getMaxPage(firstHtml);
  const pagesToFetch = config.maxPages > 0 ? Math.min(config.maxPages, maxPage) : maxPage;
  console.log(`  官网共 ${maxPage} 页，本次扫描 ${pagesToFetch} 页`);

  const allScraped: ScrapedProduct[] = parseListingPage(firstHtml, firstUrl);
  if (allScraped.length === 0) throw new Error(`${seriesCode} 第 1 页未解析到产品`);
  const seenUrls = new Set(allScraped.map((p) => p.productUrl));
  const sourcePages = new Map(allScraped.map((p) => [p.productUrl, firstUrl]));
  console.log(`  第 1 页: ${allScraped.length} 条`);

  let consecutiveKnownPages = allScraped.every(findExisting) ? 1 : 0;
  const scanAllPages = config.maxPages === 0 || config.force || config.updatePrices;

  for (let page = 2; page <= pagesToFetch; page++) {
    await sleep(config.delay);

    const pageUrl = `${BASE_URL}${brandPath}?p=${page}`;
    const pageHtml = await fetchPage(pageUrl);
    const pageProducts = parseListingPage(pageHtml, pageUrl);
    if (pageProducts.length === 0) throw new Error(`${seriesCode} 第 ${page} 页未解析到产品`);
    const newCount = pageProducts.filter((p) => !findExisting(p)).length;
    console.log(`  第 ${page} 页: ${pageProducts.length} 条 (新发现 ${newCount} 条)`);
    for (const product of pageProducts) {
      if (seenUrls.has(product.productUrl)) continue;
      seenUrls.add(product.productUrl);
      sourcePages.set(product.productUrl, pageUrl);
      allScraped.push(product);
    }

    if (newCount === 0) {
      if (++consecutiveKnownPages >= 3 && !scanAllPages) {
        console.log(`  连续 ${consecutiveKnownPages} 页无新产品，停止扫描`);
        break;
      }
    } else {
      consecutiveKnownPages = 0;
    }
  }

  // URL 优先；换链仅回退到旧目录中唯一的完整标题，限定标签可能随官网变化。
  const newScraped: ScrapedProduct[] = [];
  const seenTitles = new Set<string>();
  const updatedIds = new Set<string>();
  const processedIds = new Set<string>();
  const processedUrls = new Set<string>();
  for (const product of allScraped) {
    if (processedUrls.has(product.productUrl)) continue;
    processedUrls.add(product.productUrl);
    const existing = findExisting(product);
    if (existing) {
      if (processedIds.has(existing.id)) continue;
      processedIds.add(existing.id);
      let changed = false;
      if ((config.force || config.updatePrices) && product.price &&
          (product.price !== existing.price || product.priceTaxFree !== existing.priceTaxFree)) {
        existing.price = product.price;
        existing.priceTaxFree = product.priceTaxFree;
        changed = true;
      }
      if (config.force && product.releaseDate && product.releaseDate !== existing.releaseDate) {
        existing.releaseDate = product.releaseDate;
        changed = true;
      }
      if (changed) updatedIds.add(existing.id);
    } else if (!seenTitles.has(productKey(product))) {
      newScraped.push(product);
      seenTitles.add(productKey(product));
    }
  }
  const updatedCount = updatedIds.size;
  console.log(`  扫描完成: 共 ${allScraped.length} 条, 新发现 ${newScraped.length} 条`);
  if (updatedCount > 0) console.log(`  更新 ${updatedCount} 条已有产品信息`);

  // --- 生成新条目 ---
  let nextRegular = getNextNumber(existingData, false);
  let nextLimited = getNextNumber(existingData, true);

  const newProducts: ModelEntry[] = newScraped.map((s) => {
    const num = s.isLimited ? nextLimited++ : nextRegular++;
    return {
      id: makeId(seriesCode, num, s.isLimited),
      series: seriesCode,
      number: num,
      name: s.nameJa,
      nameJa: s.nameJa,
      price: s.price,
      priceTaxFree: s.priceTaxFree,
      releaseDate: s.releaseDate,
      isLimited: s.isLimited,
      limitedType: s.limitedType,
      imageUrl: s.imageUrl,
      productUrl: s.productUrl,
      _limitedSource: '',
      _limitedMethod: 'scrape',
    };
  });

  if (config.downloadImages && !config.dryRun) {
    const freshImagesByPage = new Map<string, Map<string, string>>();
    for (const model of newProducts) {
      const sourcePage = sourcePages.get(model.productUrl)!;
      let freshImages = freshImagesByPage.get(sourcePage);
      if (!freshImages) {
        // 列表图片签名只有几分钟有效期，下载前绕过缓存刷新所在页。
        await sleep(config.delay);
        const freshPage = new URL(sourcePage);
        freshPage.searchParams.set('_', String(Date.now()));
        const freshHtml = await fetchPage(freshPage.href);
        freshImages = new Map(parseListingPage(freshHtml, freshPage.href).map((p) => [p.productUrl, p.imageUrl]));
        freshImagesByPage.set(sourcePage, freshImages);
      }
      const imageUrl = freshImages.get(model.productUrl);
      if (!imageUrl) throw new Error(`${model.id} 在刷新后的列表页中缺少首图: ${sourcePage}`);
      model.imageUrl = await downloadCover({ ...model, imageUrl });
    }
  }
  return { newProducts, updatedCount, existingData };
}

// ---- 数据库同步 ----
export async function syncToDatabase(seriesToSync: string[]) {
  console.log('[DB] 同步数据到数据库...');
  const pool = (await import('../db/pool')).default;

  try {
    for (const code of seriesToSync) {
      const data = loadData(code);
      const BATCH = 100;
      for (let i = 0; i < data.length; i += BATCH) {
        const batch = data.slice(i, i + BATCH);
        const values = batch.map((m) => [
          m.id, m.series, m.number, m.name, m.nameJa,
          m.nameEn || null, m.price, m.priceTaxFree, m.releaseDate,
          m.isLimited ? 1 : 0, m.limitedType || null,
          m.imageUrl, m.productUrl,
          m.tags && m.tags.length > 0 ? JSON.stringify(m.tags) : null,
        ]);

        await pool.query(
          `INSERT INTO models (id, series, number, name, name_ja, name_en, price, price_tax_free,
           release_date, is_limited, limited_type, image_url, product_url, tags)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             name = VALUES(name), name_ja = VALUES(name_ja), name_en = VALUES(name_en),
             price = VALUES(price), price_tax_free = VALUES(price_tax_free),
             release_date = VALUES(release_date), is_limited = VALUES(is_limited),
             limited_type = VALUES(limited_type), image_url = VALUES(image_url),
             product_url = VALUES(product_url), tags = VALUES(tags)`,
          [values],
        );
      }
      console.log(`  ${code.toUpperCase()}: ${data.length} 条已同步`);
    }

    // 更新 series_meta
    const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'series-meta.json'), 'utf-8'));
    for (const item of meta) {
      await pool.query(
        `INSERT INTO series_meta (code, name, short_name, scale, cover_image, total_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), short_name = VALUES(short_name),
           scale = VALUES(scale), cover_image = VALUES(cover_image),
           total_count = VALUES(total_count)`,
        [item.code, item.name, item.shortName, item.scale, item.coverImage, item.totalCount],
      );
    }

    console.log('[DB] 数据库同步完成');
  } catch (err) {
    console.error('[DB] 数据库同步失败:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

// ---- 主流程 ----
export async function main(config = parseArgs()) {
  const startTime = Date.now();

  console.log('========================================');
  console.log('  万代官网数据爬取脚本');
  console.log('========================================');
  console.log(`  配置: maxPages=${config.maxPages || '全部'}, delay=${config.delay}ms, dryRun=${config.dryRun}, force=${config.force}, updatePrices=${config.updatePrices}, downloadImages=${config.downloadImages}`);
  console.log('');

  const seriesToScrape = config.series ? [config.series] : ['hg', 'rg', 'mg', 'pg'];
  let totalNew = 0;
  let totalUpdated = 0;
  const changedSeries: string[] = [];

  for (const code of seriesToScrape) {
    if (!BRAND_URLS[code]) {
      console.error(`未知系列: ${code}`);
      continue;
    }

    console.log(`[${code.toUpperCase()}] 开始爬取...`);
    const { newProducts, updatedCount, existingData } = await scrapeSeries(code, config);
    totalUpdated += updatedCount;

    if (newProducts.length === 0 && updatedCount === 0) {
      console.log(`[${code.toUpperCase()}] 无变化\n`);
      continue;
    }

    // 展示新产品
    if (newProducts.length > 0) {
      console.log(`\n[${code.toUpperCase()}] 新发现 ${newProducts.length} 条:`);
      for (const m of newProducts) {
        const ltd = m.isLimited ? ` [${m.limitedType}]` : '';
        console.log(`  ${m.id} | ${m.nameJa} | ¥${m.price} | ${m.releaseDate}${ltd}`);
      }
    }

    if (!config.dryRun) {
      const merged = [...existingData, ...newProducts];
      // 排序: 普通在前按编号升序，限定在后按编号升序
      merged.sort((a, b) => {
        if (a.isLimited !== b.isLimited) return a.isLimited ? 1 : -1;
        return a.number - b.number;
      });

      saveData(code, merged);
      updateSeriesMeta(code, merged.length);
      console.log(`  已写入 ${code}.json (共 ${merged.length} 条)`);
      changedSeries.push(code);
    }

    totalNew += newProducts.length;
    console.log('');
  }

  // 数据库同步
  if (config.syncDb && !config.dryRun && changedSeries.length > 0) {
    await syncToDatabase(changedSeries);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('========================================');
  console.log(`  完成！新增 ${totalNew} 条，更新 ${totalUpdated} 条，耗时 ${elapsed}s`);
  if (config.dryRun) console.log('  (dry-run 模式，未写入文件)');
  console.log('========================================');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[scrape] 致命错误:', err);
    process.exit(1);
  });
}
