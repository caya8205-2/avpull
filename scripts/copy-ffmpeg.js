import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const projectDir = path.resolve(__dirname, '..');

async function main() {
  // Copy ffmpeg binary
  const { default: ffmpegStatic } = await import('ffmpeg-static');
  if (ffmpegStatic && typeof ffmpegStatic === 'string') {
    const dest = path.join(distDir, path.basename(ffmpegStatic));
    fs.mkdirSync(distDir, { recursive: true });
    fs.cpSync(ffmpegStatic, dest);
    console.log(`Copied ${ffmpegStatic} -> ${dest}`);
  } else {
    console.warn('ffmpeg-static did not resolve to a path, skipping');
  }

  // Copy install.ps1 for easy deployment
  const installSrc = path.join(projectDir, 'install.ps1');
  const installDest = path.join(distDir, 'install.ps1');
  fs.cpSync(installSrc, installDest);
  console.log(`Copied ${installSrc} -> ${installDest}`);
}

main().catch(console.error);
