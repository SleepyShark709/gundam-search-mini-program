#!/usr/bin/env python3
"""打包当前后端源码和完整图片，生成可核验的云托管上传包。"""
import argparse
import hashlib
import json
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def sha256(path):
    with path.open('rb') as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
        return digest.hexdigest()


def package_release(project, output):
    server = project / 'server'
    entries = [server / name for name in ('Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', '.dockerignore')]
    entries += sorted(path for folder in ('src', 'public/images') for path in (server / folder).rglob('*') if path.is_file() and not any(part in ('.DS_Store', 'Thumbs.db', '__MACOSX') for part in path.relative_to(server).parts))
    required = [server / 'src/app.ts', server / 'src/scripts/migrate-hangar.ts']
    if any(not path.is_file() for path in entries[:5] + required):
        raise ValueError('缺少 Dockerfile、锁文件、TypeScript 配置、忽略规则、启动源文件或机库迁移脚本')
    if not any(path.is_relative_to(server / 'public/images') for path in entries):
        raise ValueError('图片目录为空，不能生成缺少完整图片的发布包')
    files = []
    for path in entries:
        name = path.relative_to(server).as_posix()
        if path.is_symlink() or any(part.startswith('.env') or part in ('node_modules', 'dist', '__pycache__') for part in path.relative_to(server).parts):
            raise ValueError(f'发布白名单内出现不应打包的路径：{name}')
        files.append({'path': name, 'bytes': path.stat().st_size, 'sha256': sha256(path)})
    source_hash = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output.mkdir(parents=True, exist_ok=True)
    name = f'gundam-server-{stamp}-{source_hash[:12]}'
    archive = output / f'{name}.zip'
    if archive.exists():
        raise FileExistsError(f'发布包已存在，保留已有文件：{archive}')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as package:
        for entry in files:
            package.write(server / entry['path'], entry['path'])
    with zipfile.ZipFile(archive) as package:
        if package.testzip() is not None or package.namelist() != [entry['path'] for entry in files]:
            raise ValueError('压缩包完整性检查失败')
        for entry in files:
            if hashlib.sha256(package.read(entry['path'])).hexdigest() != entry['sha256']:
                raise ValueError(f'打包期间源文件发生变化，请重新打包：{entry["path"]}')
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=project, capture_output=True, text=True)
    dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'server'], cwd=project, capture_output=True, text=True)
    manifest = {
        'createdAt': stamp, 'commit': revision.stdout.strip() if revision.returncode == 0 else None,
        'serverHasUncommittedChanges': bool(dirty.stdout.strip()) if dirty.returncode == 0 else None,
        'sourceTreeSha256': source_hash, 'archive': archive.name, 'archiveSha256': sha256(archive),
        'imageCount': sum(entry['path'].startswith('public/images/') for entry in files), 'files': files,
    }
    manifest_path = output / f'{name}.manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (output / f'{name}.sha256').write_text(f'{manifest["archiveSha256"]}  {archive.name}\n')
    (output / 'LATEST.json').write_text(json.dumps({
        'archive': archive.name, 'manifest': manifest_path.name, 'sha256': manifest['archiveSha256'],
        'commit': manifest['commit'], 'sourceTreeSha256': source_hash,
    }, ensure_ascii=False, indent=2) + '\n')
    return {'archive': str(archive), 'manifest': str(manifest_path), 'sha256': manifest['archiveSha256'],
            'files': len(files), 'images': manifest['imageCount'], 'bytes': archive.stat().st_size}


if __name__ == '__main__':
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=project.parent / f'{project.name}-release')
    args = parser.parse_args()
    print(json.dumps(package_release(project, args.output.resolve()), ensure_ascii=False, indent=2))
