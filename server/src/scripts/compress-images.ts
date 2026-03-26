/**
 * 批量压缩 public/images/ 下所有图片（原地覆盖）
 *
 * 运行：npx ts-node src/scripts/compress-images.ts
 *
 * 默认 JPEG quality=70，可通过环境变量调整：
 *   QUALITY=60 npx ts-node src/scripts/compress-images.ts
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const IMAGE_DIR = path.join(__dirname, '../../public/images');
const QUALITY = parseInt(process.env.QUALITY || '70', 10);
const CONCURRENCY = 10;

// ---------- 递归收集图片 ----------

function collectFiles(dir: string): string[] {
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath));
    } else if (/\.(jpe?g|JPG|JPEG)$/i.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

// ---------- 压缩单张 ----------

async function compressOne(filePath: string): Promise<{ saved: number }> {
  const originalSize = fs.statSync(filePath).size;
  const buffer = await sharp(filePath)
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();

  // 只在变小时才覆盖
  if (buffer.length < originalSize) {
    fs.writeFileSync(filePath, buffer);
    return { saved: originalSize - buffer.length };
  }
  return { saved: 0 };
}

// ---------- 主流程 ----------

async function main() {
  console.log(`扫描: ${IMAGE_DIR}`);
  console.log(`JPEG quality: ${QUALITY}\n`);

  const files = collectFiles(IMAGE_DIR);
  console.log(`共 ${files.length} 张 JPEG，开始压缩（并发 ${CONCURRENCY}）...\n`);

  let done = 0;
  let totalSaved = 0;
  let skipped = 0;

  const pool: Promise<void>[] = [];
  for (const file of files) {
    const p = compressOne(file)
      .then(({ saved }) => {
        done++;
        totalSaved += saved;
        if (saved === 0) skipped++;
        if (done % 100 === 0 || done === files.length) {
          console.log(`  ${done}/${files.length}  已节省 ${(totalSaved / 1024 / 1024).toFixed(1)} MB`);
        }
      })
      .catch((err) => {
        done++;
        console.error(`  FAIL: ${path.basename(file)} - ${err.message}`);
      })
      .then(() => {
        pool.splice(pool.indexOf(p), 1);
      });
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);

  console.log(`\n完成!`);
  console.log(`  压缩: ${done - skipped} 张`);
  console.log(`  跳过（已最优）: ${skipped} 张`);
  console.log(`  总共节省: ${(totalSaved / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('脚本失败:', err);
  process.exit(1);
});
