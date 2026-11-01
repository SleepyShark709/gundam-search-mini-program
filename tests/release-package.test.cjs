const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../scripts/package-release.py');

function fixture(t, withImage = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gundam-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'server/Dockerfile': 'FROM node:22-alpine\n',
    'server/package.json': '{}', 'server/package-lock.json': '{}',
    'server/tsconfig.json': '{}', 'server/.dockerignore': 'node_modules\ndist\n.env',
    'server/src/app.ts': 'export default {};',
    'server/src/scripts/migrate-hangar.ts': 'export {};',
    'server/.env': 'MYSQL_PASSWORD=private-fixture',
    'server/node_modules/ignored.js': 'not for upload',
    'server/dist/app.js': 'old compiled version',
    'server/old.zip': 'stale archive',
    'server/public/images/.DS_Store': 'macOS metadata',
    ...(withImage ? { 'server/public/images/hg-001/main.png': 'fixture-image-bytes' } : {}),
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function pack(root, code = '') {
  return spawnSync('python3', ['-c', `
import runpy,sys,json,zipfile,hashlib
from pathlib import Path
pack=runpy.run_path(sys.argv[1])['package_release']
result=pack(Path(sys.argv[2]),Path(sys.argv[2])/'output')
${code || "print(json.dumps(result))"}
`, script, root], { encoding: 'utf8' });
}

test('发布包白名单包含完整图片和迁移、排除环境与旧构建，哈希可复核', (t) => {
  const root = fixture(t);
  const result = pack(root, `
with zipfile.ZipFile(result['archive']) as package:
    result['names']=package.namelist()
    result['valid']=all(hashlib.sha256(package.read(item['path'])).hexdigest()==item['sha256'] for item in json.loads(Path(result['manifest']).read_text())['files'])
print(json.dumps(result))`);
  assert.equal(result.status, 0, result.stderr);
  const artifact = JSON.parse(result.stdout);
  assert.equal(artifact.images, 1);
  assert.equal(artifact.valid, true);
  assert.deepEqual(artifact.names.slice(0, 5), ['Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', '.dockerignore']);
  assert.ok(artifact.names.includes('src/scripts/migrate-hangar.ts'));
  assert.ok(artifact.names.includes('public/images/hg-001/main.png'));
  assert.ok(!artifact.names.some((name) => /\.env|node_modules|^dist\/|old\.zip|DS_Store/.test(name)));
  const manifest = JSON.parse(fs.readFileSync(artifact.manifest, 'utf8'));
  assert.equal(manifest.archiveSha256, artifact.sha256);
  assert.equal(manifest.commit, null);
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'output/LATEST.json'), 'utf8'));
  assert.equal(latest.archive, path.basename(artifact.archive));
  assert.equal(latest.sha256, artifact.sha256);
});

test('缺少 TypeScript 配置时拒绝生成不能构建的包', (t) => {
  const root = fixture(t);
  fs.rmSync(path.join(root, 'server/tsconfig.json'));
  const result = pack(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TypeScript 配置/);
});

test('不生成缺少完整图片的发布包', (t) => {
  const result = pack(fixture(t, false));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /图片目录为空/);
});

test('源目录内的私密文件和符号链接不能混入白名单', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'server/src/.env.local'), 'private');
  assert.match(pack(root).stderr, /不应打包的路径/);
  fs.rmSync(path.join(root, 'server/src/.env.local'));
  fs.symlinkSync('../.env', path.join(root, 'server/src/secret-link'));
  assert.match(pack(root).stderr, /不应打包的路径/);
});
