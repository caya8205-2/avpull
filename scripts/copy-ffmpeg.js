import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const projectDir = path.resolve(__dirname, '..');

async function main() {
  // Copy ffmpeg binary
  try {
    const { default: ffmpegStatic } = await import('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      const dest = path.join(distDir, path.basename(ffmpegStatic));
      fs.mkdirSync(distDir, { recursive: true });
      fs.cpSync(ffmpegStatic, dest);
      console.log(`✓ Copied ffmpeg: ${dest}`);
    } else {
      console.warn('⚠ ffmpeg-static did not resolve to a path, skipping');
    }
  } catch (err) {
    console.error('✗ Error copying ffmpeg:', err.message);
    process.exit(1);
  }

  // Copy install.ps1 from site/public folder
  const installSrc = path.join(projectDir, 'site', 'public', 'install.ps1');
  const installDest = path.join(distDir, 'install.ps1');
  
  if (fs.existsSync(installSrc)) {
    fs.cpSync(installSrc, installDest);
    console.log(`✓ Copied install.ps1: ${installDest}`);
  } else {
    console.warn('⚠ install.ps1 not found at:', installSrc);
  }

  // Copy yt-dlp binary
  const ext = process.platform === 'win32' ? '.exe' : '';
  const ytdlpDest = path.join(distDir, `yt-dlp${ext}`);
  let ytdlpCopied = false;

  // Try 1: Copy from youtube-dl-exec package
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgDir = path.dirname(require.resolve('youtube-dl-exec/package.json'));
    const ytdlpSrc = path.join(pkgDir, 'bin', `yt-dlp${ext}`);
    if (fs.existsSync(ytdlpSrc)) {
      fs.cpSync(ytdlpSrc, ytdlpDest);
      console.log(`✓ Copied yt-dlp: ${ytdlpDest}`);
      ytdlpCopied = true;
    }
  } catch {}

  // Try 2: Download from GitHub releases
  if (!ytdlpCopied) {
    console.log('⏳ yt-dlp binary not found locally, downloading from GitHub...');
    const binName = process.platform === 'win32' ? 'yt-dlp.exe'
      : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(ytdlpDest, buf);
      if (process.platform !== 'win32') fs.chmodSync(ytdlpDest, 0o755);
      console.log(`✓ Downloaded yt-dlp: ${ytdlpDest}`);
    } catch (err) {
      console.error('✗ Failed to download yt-dlp:', err.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);
