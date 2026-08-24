import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');
const ext = process.platform === 'win32' ? '.exe' : '';
const binDest = path.join(binDir, `innertube${ext}`);

async function install() {
  if (process.env.INNERTUBE_SKIP_DOWNLOAD) {
    return;
  }

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const archiveName = process.platform === 'win32'
    ? 'innertube-windows-x86_64.zip'
    : process.platform === 'darwin'
      ? `innertube-macos-${arch}.tar.gz`
      : 'innertube-linux-x86_64.tar.gz';

  const directAssetName = process.platform === 'win32'
    ? 'innertube.exe'
    : process.platform === 'darwin'
      ? 'innertube-macos'
      : 'innertube-linux';

  const downloadTargets = [
    {
      url: `https://github.com/caya8205-2/innertube-rs/releases/latest/download/${archiveName}`,
      isArchive: true,
    },
    {
      url: `https://github.com/caya8205-2/avpull/releases/latest/download/${directAssetName}`,
      isArchive: false,
    },
  ];

  fs.mkdirSync(binDir, { recursive: true });

  console.log('⏳ Downloading latest innertube-rs binary...');

  for (const target of downloadTargets) {
    try {
      const res = await fetch(target.url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());

      if (target.isArchive) {
        const tmpArchive = path.join(os.tmpdir(), `innertube-latest-${Date.now()}-${archiveName}`);
        fs.writeFileSync(tmpArchive, buf);
        try {
          execSync(`tar -xf "${tmpArchive}" -C "${binDir}"`, { stdio: 'ignore' });
        } finally {
          try { fs.unlinkSync(tmpArchive); } catch {}
        }
      } else {
        fs.writeFileSync(binDest, buf);
      }

      if (fs.existsSync(binDest)) {
        if (process.platform !== 'win32') {
          fs.chmodSync(binDest, 0o755);
        }
        console.log(`✓ innertube binary installed to: ${binDest}`);
        return;
      }
    } catch {}
  }

  console.warn('⚠ Could not download innertube binary during postinstall (will retry on first run)');
}

install().catch((err) => {
  console.warn('⚠ Postinstall error:', err.message);
});
