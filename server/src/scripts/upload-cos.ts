/**
 * 批量上传 public/images/ 到微信云托管对象存储（COS）
 *
 * 使用前先设置环境变量：
 *   export COS_SECRET_ID=xxx
 *   export COS_SECRET_KEY=xxx
 *   export COS_BUCKET=xxx-xxxxxxx     # 如 gundam-1234567890
 *   export COS_REGION=ap-shanghai      # 如 ap-shanghai
 *
 * 运行：
 *   npx ts-node src/scripts/upload-cos.ts
 */

import COS from 'cos-nodejs-sdk-v5';
import * as fs from 'fs';
import * as path from 'path';

// ---------- 配置 ----------

const SECRET_ID = process.env.COS_SECRET_ID || '';
const SECRET_KEY = process.env.COS_SECRET_KEY || '';
const BUCKET = process.env.COS_BUCKET || '';
const REGION = process.env.COS_REGION || '';

const IMAGE_DIR = path.join(__dirname, '../../public/images');
const CONCURRENCY = 10; // 并发上传数

// ---------- 校验 ----------

if (!SECRET_ID || !SECRET_KEY || !BUCKET || !REGION) {
  console.error('请先设置环境变量: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION');
  process.exit(1);
}

// ---------- 初始化 ----------

const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY });

// ---------- 递归收集文件 ----------

function collectFiles(dir: string, base: string): { localPath: string; cosKey: string }[] {
  const result: { localPath: string; cosKey: string }[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, base));
    } else if (/\.(jpe?g|png|webp|gif)$/i.test(entry.name)) {
      // COS Key: images/xxx.jpg 或 images/rg-001/0.jpg
      const cosKey = 'images/' + path.relative(base, fullPath).replace(/\\/g, '/');
      result.push({ localPath: fullPath, cosKey });
    }
  }
  return result;
}

// ---------- 上传单个文件 ----------

function uploadFile(localPath: string, cosKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: cosKey,
        Body: fs.createReadStream(localPath),
        ContentLength: fs.statSync(localPath).size,
      },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

// ---------- 并发控制 ----------

async function uploadAll(files: { localPath: string; cosKey: string }[]) {
  let done = 0;
  let failed = 0;
  const total = files.length;
  const failedFiles: string[] = [];

  async function worker(file: { localPath: string; cosKey: string }) {
    try {
      await uploadFile(file.localPath, file.cosKey);
      done++;
    } catch (err: any) {
      failed++;
      failedFiles.push(file.cosKey);
      console.error(`  FAIL: ${file.cosKey} - ${err.message || err}`);
    }
    // 进度输出
    if ((done + failed) % 50 === 0 || done + failed === total) {
      console.log(`  进度: ${done + failed}/${total}  成功: ${done}  失败: ${failed}`);
    }
  }

  // 并发池
  const pool: Promise<void>[] = [];
  for (const file of files) {
    const p = worker(file).then(() => {
      pool.splice(pool.indexOf(p), 1);
    });
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);

  return { done, failed, failedFiles };
}

// ---------- 主流程 ----------

async function main() {
  console.log(`扫描图片目录: ${IMAGE_DIR}`);
  const files = collectFiles(IMAGE_DIR, IMAGE_DIR);
  console.log(`共发现 ${files.length} 张图片，开始上传（并发 ${CONCURRENCY}）...\n`);

  const start = Date.now();
  const { done, failed, failedFiles } = await uploadAll(files);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n上传完成! 耗时 ${elapsed}s`);
  console.log(`  成功: ${done}`);
  console.log(`  失败: ${failed}`);

  if (failedFiles.length > 0) {
    console.log('\n失败文件列表:');
    failedFiles.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
