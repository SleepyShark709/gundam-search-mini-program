const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModule } = require('./helpers/load-typescript.cjs');

const scriptDirectory = path.resolve(__dirname, '../server/src/scripts');
const dataDirectory = path.resolve(__dirname, '../miniprogram/data');
const imageDirectory = path.resolve(__dirname, '../server/public/images');
const config = (extra = {}) => ({
  series: 'hg', maxPages: 0, delay: 0, dryRun: false, syncDb: false,
  force: false, updatePrices: false, downloadImages: false, ...extra,
});

function card({ url = '/item/new/', name = 'HG 新商品', price = 2200, tag = '', image = '/img/new.png' } = {}) {
  return `<a class="c-card p-card -landscape" href="${url}"><img alt="商品" src="${image}">
    <div class="p-card__tit">${name}</div><div class="p-card__tag ${tag}"></div>
    <div class="p-card__price">${price.toLocaleString('en-US')}円(税10%込)</div>
    <div class="p-card_date">2026年11月</div></a>`;
}

function entry(extra = {}) {
  return {
    id: 'hg-001', series: 'hg', number: 1, name: '原中文名', nameJa: 'HG 既存商品',
    price: 1100, priceTaxFree: 1000, releaseDate: '2020-01', isLimited: false,
    imageUrl: '/images/hg-001/cover.jpg', productUrl: 'https://bandai-hobby.net/item/old/',
    ...extra,
  };
}

function scraper({ existing = [], pages = [card()], freshPages = pages, expiredImages = [], imageError, pageFailure, pool } = {}) {
  const files = new Map([
    [path.join(dataDirectory, 'hg.json'), JSON.stringify(existing)],
    [path.join(dataDirectory, 'series-meta.json'), JSON.stringify([{ code: 'hg', totalCount: existing.length }])],
  ]);
  const writes = [];
  const calls = [];
  let sharpCalls = 0;
  const fakeFs = {
    existsSync: (file) => files.has(file),
    readFileSync: (file) => {
      if (!files.has(file)) throw new Error(`Unexpected file: ${file}`);
      return files.get(file);
    },
    writeFileSync: (file, contents) => { files.set(file, contents); writes.push(file); },
    mkdirSync() {},
  };
  const exports = loadModule('server/src/scripts/scrape-bandai.ts', {
    mocks: {
      fs: fakeFs,
      sharp: { default: () => {
        sharpCalls++;
        return { jpeg: () => ({ toBuffer: async () => {
          if (imageError) throw imageError;
          return Buffer.from('validated jpeg');
        } }) };
      } },
      '../db/pool': { default: pool },
    },
    globals: {
      __dirname: scriptDirectory, URL, Buffer, AbortSignal,
      process: { argv: [] },
      console: { log() {}, warn() {}, error() {} },
      setTimeout: (callback) => { callback(); return 0; },
      fetch: async (url, options) => {
        calls.push({ url, options });
        const isPage = url.startsWith('https://bandai-hobby.net/brand/');
        if (isPage && pageFailure) throw pageFailure;
        if (!isPage && expiredImages.includes(url)) throw new Error('Expired signature');
        const parsed = new URL(url);
        const page = Number(parsed.searchParams.get('p') || 1);
        return {
          ok: true, text: async () => (parsed.searchParams.has('_') ? freshPages : pages)[page - 1],
          arrayBuffer: async () => Buffer.from('image bytes'),
        };
      },
    },
  }).exports;
  return { ...exports, files, writes, calls, sharpCalls: () => sharpCalls };
}

test('完整扫描及 force 模式经过连续三页已知商品后仍扫描新商品', async () => {
  for (const options of [{ maxPages: 0 }, { maxPages: 5, force: true }]) {
    const old = entry();
    const known = card({ url: old.productUrl, name: old.nameJa });
    const subject = scraper({ existing: [old], pages: [known + '<a href="?p=4">4</a>', known, known, card()] });
    const result = await subject.scrapeSeries('hg', config(options));
    assert.equal(subject.calls.length, 4);
    assert.equal(result.newProducts.length, 1);
    assert.equal(result.newProducts[0].id, 'hg-002');
    assert.match(subject.calls[0].options.headers['User-Agent'], /Chrome\/120.*Safari/);
    assert.ok(subject.calls[0].options.signal);
  }
});

test('解析官方限定链接、实体和相对图片，并拒绝非官方商品域名', () => {
  const subject = scraper();
  const products = subject.parseListingPage(
    card({ url: 'https://p-bandai.jp/item/item-100/?a=1&amp;b=2', tag: '-online',
      name: 'HG&nbsp;A&amp;B &quot;C&quot;&apos;&#65;&#x42;', image: '/img/a.png?x=1&amp;y=2' }) +
    card({ url: 'https://other.example/item/item-100/' }) +
    card({ url: 'https://p-bandai.jp/other/item-100/' }) +
    card({ url: '/item/regular/' }),
  );
  assert.equal(products.length, 2);
  assert.equal(products[0].nameJa, 'HG A&B "C"\'AB');
  assert.equal(products[0].isLimited, true);
  assert.equal(products[0].limitedType, 'pbandai');
  assert.equal(products[0].productUrl, 'https://p-bandai.jp/item/item-100/');
  assert.equal(products[0].imageUrl, 'https://bandai-hobby.net/img/a.png?x=1&y=2');
  assert.equal(products[1].productUrl, 'https://bandai-hobby.net/item/regular/');
  const relative = subject.parseListingPage(card({ image: '../img/cover.png' }), 'https://bandai-hobby.net/brand/hg/');
  assert.equal(relative[0].imageUrl, 'https://bandai-hobby.net/brand/img/cover.png');
});

test('跨页重复及完整规范化旧名换 URL 不新增，保留 ID、中文名和日期', async () => {
  const old = entry({ id: 'hg-l-001', nameJa: 'ＨＧ　Ａ＆Ｂ', isLimited: true, limitedType: 'pbandai' });
  const replacement = card({ url: 'https://p-bandai.jp/item/item-200/', name: 'HG A&amp;B', tag: '-online' });
  const newCard = card();
  const subject = scraper({ existing: [old], pages: [replacement + newCard + '<a href="?p=2">2</a>', replacement + newCard] });
  const result = await subject.scrapeSeries('hg', config());
  assert.equal(result.newProducts.length, 1);
  assert.equal(result.existingData[0].id, old.id);
  assert.equal(result.existingData[0].name, old.name);
  assert.equal(result.existingData[0].releaseDate, old.releaseDate);
  assert.equal(result.existingData[0].productUrl, old.productUrl);
});

test('唯一完整标题换链时忽略官网限定标签变化，保留原限定属性', async () => {
  const old = entry({ id: 'rg-l-133', series: 'rg',
    nameJa: 'RG 1/144 RX-78-2 ガンダム Ver.2.0 [初音ミクVer.]',
    isLimited: true, limitedType: 'other' });
  const subject = scraper({ existing: [old], pages: [card({
    name: old.nameJa, url: 'https://p-bandai.jp/item/item-200/', tag: '-online',
  })] });
  const result = await subject.scrapeSeries('hg', config({ updatePrices: true }));
  assert.equal(result.newProducts.length, 0);
  assert.equal(result.existingData[0].id, old.id);
  assert.equal(result.existingData[0].name, old.name);
  assert.equal(result.existingData[0].releaseDate, old.releaseDate);
  assert.equal(result.existingData[0].isLimited, true);
  assert.equal(result.existingData[0].limitedType, 'other');
});

test('标题不唯一时禁用标题回退，URL仍优先，近似名称不合并', async () => {
  const old = entry({ nameJa: 'HG A' });
  const duplicate = entry({ id: 'hg-l-001', nameJa: 'ＨＧ　Ａ', isLimited: true,
    productUrl: 'https://bandai-hobby.net/item/another/' });
  const subject = scraper({ existing: [old, duplicate], pages: [
    card({ url: old.productUrl, name: 'HG A' }) +
    card({ name: 'HG A', url: 'https://p-bandai.jp/item/item-200/', tag: '-online' }) +
    card({ name: 'HG AB', url: '/item/different/' }),
  ] });
  const result = await subject.scrapeSeries('hg', config({ updatePrices: true }));
  assert.equal(result.newProducts.length, 2);
  assert.equal(result.existingData[0].price, 2200);
  assert.equal(result.existingData[1].price, 1100);
});

test('新产品的相同完整标题只新增一次，即使链接和限定标签不同', async () => {
  const subject = scraper({ pages: [card({ name: 'HG A' }) + card({
    name: 'ＨＧ　Ａ', url: 'https://p-bandai.jp/item/item-200/', tag: '-online',
  })] });
  assert.equal((await subject.scrapeSeries('hg', config())).newProducts.length, 1);
});

test('首屏重复 URL 即使标题变化也只新增一次，采用首条内容', async () => {
  const subject = scraper({ pages: [card({ name: 'HG 新品' }) + card({ name: 'HG 新品 別名' })] });
  const result = await subject.scrapeSeries('hg', config());
  assert.equal(result.newProducts.length, 1);
  assert.equal(result.newProducts[0].nameJa, 'HG 新品');
});

test('已有产品只使用官网首个匹配价格，首条价格未变也不能被后页旧价格覆盖', async () => {
  for (const firstPrice of [1100, 3300]) {
    const old = entry();
    const subject = scraper({ existing: [old], pages: [
      card({ url: '/item/new-edition/', name: old.nameJa, price: firstPrice }) + '<a href="?p=2">2</a>',
      card({ url: old.productUrl, name: old.nameJa, price: 2200 }),
    ] });
    const result = await subject.scrapeSeries('hg', config({ updatePrices: true }));
    assert.equal(result.newProducts.length, 0);
    assert.equal(result.existingData[0].price, firstPrice);
    assert.equal(result.existingData[0].releaseDate, old.releaseDate);
    assert.equal(result.updatedCount, firstPrice === old.price ? 0 : 1);
  }
});

test('价格更新保留日期，force 继续更新日期，且修复单独错误的未税价', async () => {
  for (const force of [false, true]) {
    const old = entry({ price: 2200, priceTaxFree: 1 });
    const subject = scraper({ existing: [old], pages: [card({ url: old.productUrl, name: old.nameJa })] });
    const result = await subject.scrapeSeries('hg', config({ updatePrices: true, force }));
    assert.equal(result.updatedCount, 1);
    assert.equal(result.existingData[0].price, 2200);
    assert.equal(result.existingData[0].priceTaxFree, 2000);
    assert.equal(result.existingData[0].releaseDate, force ? '2026-11' : '2020-01');
  }
});

test('元信息 JSON 与小程序 require 的 JS 同步生成', () => {
  const subject = scraper();
  subject.updateSeriesMeta('hg', 123);
  const json = subject.files.get(path.join(dataDirectory, 'series-meta.json'));
  assert.equal(JSON.parse(json)[0].totalCount, 123);
  assert.equal(subject.files.get(path.join(dataDirectory, 'series-meta.js')), `module.exports = ${json.trimEnd()};\n`);
});

test('新首图经过验证写入 cover.jpg，JSON 使用稳定图片路径', async () => {
  const subject = scraper();
  await subject.main(config({ downloadImages: true }));
  assert.equal(subject.sharpCalls(), 1);
  assert.ok(subject.writes.includes(path.join(imageDirectory, 'hg-001', 'cover.jpg')));
  const saved = JSON.parse(subject.files.get(path.join(dataDirectory, 'hg.json')));
  assert.equal(saved[0].imageUrl, '/images/hg-001/cover.jpg');
});

test('过期签名先按源页刷新再下载，每页只刷新一次且不请求旧图片', async () => {
  const items = [
    { url: '/item/a/', name: 'HG A' },
    { url: '/item/b/', name: 'HG B' },
    { url: '/item/c/', name: 'HG C' },
  ];
  const stale = items.map((item) => card({ ...item, image: `https://images.example/${item.name.slice(-1)}.png?signature=expired` }));
  const fresh = items.map((item) => card({ ...item, image: `https://images.example/${item.name.slice(-1)}.png?signature=fresh` }));
  const subject = scraper({
    pages: [stale[0] + stale[1] + '<a href="?p=2">2</a>', stale[2]],
    freshPages: [fresh[0] + fresh[1], fresh[2]],
    expiredImages: items.map((item) => `https://images.example/${item.name.slice(-1)}.png?signature=expired`),
  });
  await subject.main(config({ downloadImages: true }));
  const order = subject.calls.map(({ url }) => {
    const parsed = new URL(url);
    return parsed.hostname === 'images.example'
      ? `${parsed.pathname}?${parsed.searchParams}`
      : `page${parsed.searchParams.get('p') || 1}${parsed.searchParams.has('_') ? '-fresh' : ''}`;
  });
  assert.deepEqual(order, [
    'page1', 'page2', 'page1-fresh', '/A.png?signature=fresh', '/B.png?signature=fresh',
    'page2-fresh', '/C.png?signature=fresh',
  ]);
  const saved = JSON.parse(subject.files.get(path.join(dataDirectory, 'hg.json')));
  assert.deepEqual(saved.map(({ id, imageUrl }) => ({ id, imageUrl })), [
    { id: 'hg-001', imageUrl: '/images/hg-001/cover.jpg' },
    { id: 'hg-002', imageUrl: '/images/hg-002/cover.jpg' },
    { id: 'hg-003', imageUrl: '/images/hg-003/cover.jpg' },
  ]);
});

test('刷新后找不到商品或首图时失败，不回退到旧签名图片', async () => {
  for (const freshPage of ['<html>missing product</html>', card({ image: '' })]) {
    const subject = scraper({ freshPages: [freshPage] });
    await assert.rejects(subject.main(config({ downloadImages: true })), /刷新后的列表页中缺少首图/);
    assert.equal(subject.sharpCalls(), 0);
    assert.equal(subject.calls.length, 2);
    assert.deepEqual(subject.writes, []);
  }
});

test('首图验证失败拒绝写入目录 JSON；dry-run 不下载、不写入、不连接 DB', async () => {
  const broken = scraper({ imageError: new Error('Invalid image') });
  await assert.rejects(broken.main(config({ downloadImages: true })), /Invalid image/);
  assert.deepEqual(broken.writes, []);
  const dryRun = scraper({ imageError: new Error('Must not download') });
  await dryRun.main(config({ downloadImages: true, dryRun: true, syncDb: true }));
  assert.equal(dryRun.sharpCalls(), 0);
  assert.equal(dryRun.calls.length, 1);
  assert.equal(dryRun.calls.some(({ url }) => new URL(url).searchParams.has('_')), false);
  assert.deepEqual(dryRun.writes, []);
});

test('页面请求失败或解析为空时抛错，不能按无变化成功', async () => {
  const failed = scraper({ pageFailure: new Error('Request failed') });
  await assert.rejects(failed.main(config()), /Request failed/);
  assert.equal(failed.calls.length, 3);
  assert.deepEqual(failed.writes, []);
  const empty = scraper({ pages: [card() + '<a href="?p=2">2</a>', '<html>changed markup</html>'] });
  await assert.rejects(empty.main(config()), /第 2 页未解析到产品/);
  assert.deepEqual(empty.writes, []);
});

test('数据库同步失败继续抛错并关闭连接池', async () => {
  let ended = 0;
  const subject = scraper({ existing: [entry()], pool: {
    query: async () => { throw new Error('Database unavailable'); },
    end: async () => { ended++; },
  } });
  await assert.rejects(subject.syncToDatabase(['hg']), /Database unavailable/);
  assert.equal(ended, 1);
});

test('参数支持全量、仅价格及首图下载，导入模块不会运行 CLI', () => {
  const subject = scraper();
  const options = subject.parseArgs(['--full', '--update-prices', '--download-images']);
  assert.equal(options.maxPages, 0);
  assert.equal(options.updatePrices, true);
  assert.equal(options.downloadImages, true);
  assert.equal(subject.calls.length, 0);
});
