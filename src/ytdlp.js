import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFfmpeg, isVideoFormat, isAudioFormat, safeFilename, formatBytes } from './lib.js';
import { isYouTubeUrl } from './platform.js';
import { log, c } from './ui.js';

let _ytdlpCached = null;

/** Resolve yt-dlp binary path: youtube-dl-exec → exe dir → PATH */
export async function resolveYtDlp() {
  if (_ytdlpCached) return _ytdlpCached;

  // 1. Try youtube-dl-exec's binary directory
  try {
    const require = createRequire(import.meta.url);
    const pkgDir = path.dirname(require.resolve('youtube-dl-exec/package.json'));
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binPath = path.join(pkgDir, 'bin', `yt-dlp${ext}`);
    if (fs.existsSync(binPath)) {
      _ytdlpCached = binPath;
      return _ytdlpCached;
    }
  } catch {}

  // 2. Try next to the running executable (compiled binary)
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, 'yt-dlp.exe'),
    path.join(exeDir, 'yt-dlp')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        _ytdlpCached = candidate;
        return _ytdlpCached;
      }
    } catch {}
  }

  // 3. Fallback to PATH
  _ytdlpCached = 'yt-dlp';
  return _ytdlpCached;
}

/** Spawn yt-dlp and return a promise that resolves with { stdout, stderr }. */
function runYtDlp(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(_ytdlpCached || 'yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => {
      stderr += d;
      onStderr?.(d.toString());
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'yt-dlp not found. Install via: npm install -g avpull (or place yt-dlp binary next to avpull)'
        ));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const msg = stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

/** Get media info via --dump-single-json. Returns parsed JSON object. */
export async function getMediaInfo(url, { cookies, cookiesBrowser } = {}) {
  await resolveYtDlp();
  const args = ['--dump-single-json', '--no-playlist'];

  if (isYouTubeUrl(url)) {
    args.push('--extractor-args', 'youtube:player_client=android');
  }

  if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
  if (cookies) args.push('--cookies', cookies);

  args.push(url);
  const { stdout } = await runYtDlp(args);
  return JSON.parse(stdout);
}

/**
 * Download media using yt-dlp.
 *
 * @param {object} opts
 * @param {string} opts.url - Media URL
 * @param {string} opts.destNoExt - Output path without extension (e.g. "./avpull/My Video")
 * @param {string} opts.targetExt - Target format extension (mp3, mp4, etc.)
 * @param {string} [opts.quality] - Quality setting
 * @param {string} [opts.cookies] - Path to cookies.txt
 * @param {string} [opts.cookiesBrowser] - Browser name for cookie extraction
 * @param {function} [opts.onProgress] - Progress callback ({ percent })
 */
export async function downloadWithYtDlp(opts) {
  const { url, destNoExt, targetExt, quality, cookies, cookiesBrowser, forceMp4Stream, onProgress } = opts;
  const ytdlp = await resolveYtDlp();
  const ffmpegPath = await resolveFfmpeg();

  fs.mkdirSync(path.dirname(destNoExt), { recursive: true });

  const args = ['--no-playlist', '--newline'];

  if (isYouTubeUrl(url)) {
    args.push('--extractor-args', 'youtube:player_client=android');
  }

  // Tell yt-dlp where ffmpeg is
  args.push('--ffmpeg-location', path.dirname(ffmpegPath));

  // Cookies
  if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
  if (cookies) args.push('--cookies', cookies);

  // Format & quality selection
  const isVideo = isVideoFormat(targetExt);
  const isAudio = isAudioFormat(targetExt);

  if (forceMp4Stream) {
    // Progressive MP4 stream format (format 22/18 / best mp4) - YouTube CDN never blocks this
    if (isAudio) {
      args.push('-f', '18/best[ext=mp4]/best');
      args.push('-x', '--audio-format', targetExt);
      const q = Number(quality);
      if (Number.isFinite(q) && q > 0) {
        args.push('--audio-quality', `${q}k`);
      }
    } else {
      const q = quality || 'best';
      if (q === 'best') {
        args.push('-f', 'best[ext=mp4]/22/18/best');
      } else {
        args.push('-f', `best[ext=mp4][height<=${q}]/22[height<=${q}]/18/best`);
      }
      args.push('--merge-output-format', targetExt);
    }
  } else if (isAudio) {
    args.push('-x', '--audio-format', targetExt);
    const q = Number(quality);
    if (Number.isFinite(q) && q > 0) {
      args.push('--audio-quality', `${q}k`);
    }
  } else if (isVideo) {
    const q = quality || '1080';
    if (q === 'best') {
      args.push('-f', 'bv*+ba/b');
    } else {
      // Try requested quality first, fallback to best available
      args.push('-f', `bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`);
    }
    args.push('--merge-output-format', targetExt);
  } else {
    // Unknown format, let yt-dlp decide
    args.push('-f', 'best');
  }

  // Output template: use destNoExt + let yt-dlp fill extension
  args.push('-o', `${destNoExt}.%(ext)s`);

  args.push(url);

  await new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrBuf = '';

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.stdout.on('data', (chunk) => {
      const line = chunk.toString();
      // Parse yt-dlp progress: "[download]  45.2% of  12.34MiB ..."
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match && onProgress) {
        onProgress({ percent: parseFloat(match[1]) });
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'yt-dlp not found. Install via: npm install -g avpull (or place yt-dlp binary next to avpull)'
        ));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract the most useful error line from stderr
        const errLine = stderrBuf.trim().split('\n')
          .filter((l) => l.startsWith('ERROR:'))
          .pop() || stderrBuf.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
        reject(new Error(errLine));
      }
    });
  });

  // Find the actual output file (yt-dlp may have adjusted the extension)
  const expectedPath = `${destNoExt}.${targetExt}`;
  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  // Fallback: look for any file matching destNoExt.*
  const dir = path.dirname(destNoExt);
  const base = path.basename(destNoExt);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
  if (files.length > 0) {
    return path.join(dir, files[files.length - 1]);
  }

  return expectedPath;
}
