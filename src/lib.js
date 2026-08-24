import { spawn, execSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, c } from './ui.js';

let _ffmpegCached = null;
export async function resolveFfmpeg() {
  if (_ffmpegCached) return _ffmpegCached;
  try {
    const { default: ffmpegStatic } = await import('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
      _ffmpegCached = ffmpegStatic;
      return _ffmpegCached;
    }
  } catch {}
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, 'ffmpeg.exe'),
    path.join(exeDir, 'ffmpeg'),
    'ffmpeg.exe',
    'ffmpeg'
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        _ffmpegCached = c;
        return _ffmpegCached;
      }
    } catch {}
  }
  _ffmpegCached = 'ffmpeg';
  return _ffmpegCached;
}

let _innertubeCached = null;

export async function resolveInnertube() {
  if (_innertubeCached) return _innertubeCached;

  const ext = process.platform === 'win32' ? '.exe' : '';
  const exeDir = path.dirname(process.execPath);
  const projectRoot = path.dirname(path.dirname(import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') : process.argv[1]));
  const userCacheDir = path.join(os.homedir(), '.avpull', 'bin');
  const userCacheBin = path.join(userCacheDir, `innertube${ext}`);

  // 1. Check local & package binaries (installed by postinstall or bundled in release)
  const candidates = [
    path.join(projectRoot, 'bin', `innertube${ext}`),
    path.join(exeDir, `innertube${ext}`),
    userCacheBin,
    path.join(projectRoot, '..', 'innertube-rs', 'target', 'release', `innertube${ext}`),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        _innertubeCached = c;
        return _innertubeCached;
      }
    } catch {}
  }

  // 2. Check system PATH
  try {
    const checkCmd = process.platform === 'win32' ? 'where.exe innertube' : 'which innertube';
    execSync(checkCmd, { stdio: 'ignore' });
    _innertubeCached = 'innertube';
    return _innertubeCached;
  } catch {}

  // 3. Fallback auto-download if postinstall was skipped
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

  log('INFO', c.cyan, 'innertube engine not found, downloading latest from GitHub...');
  fs.mkdirSync(userCacheDir, { recursive: true });

  for (const target of downloadTargets) {
    try {
      const res = await fetch(target.url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());

      if (target.isArchive) {
        const tmpArchive = path.join(os.tmpdir(), `innertube-latest-${Date.now()}-${archiveName}`);
        fs.writeFileSync(tmpArchive, buf);
        try {
          execSync(`tar -xf "${tmpArchive}" -C "${userCacheDir}"`, { stdio: 'ignore' });
        } finally {
          try { fs.unlinkSync(tmpArchive); } catch {}
        }
      } else {
        fs.writeFileSync(userCacheBin, buf);
      }

      if (fs.existsSync(userCacheBin)) {
        if (process.platform !== 'win32') {
          fs.chmodSync(userCacheBin, 0o755);
        }
        log('OK', c.green, `innertube engine installed: ${userCacheBin}`);
        _innertubeCached = userCacheBin;
        return _innertubeCached;
      }
    } catch {}
  }

  _innertubeCached = 'innertube';
  return _innertubeCached;
}

export const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'opus', 'flac', 'aac', 'ogg'];
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv'];
export const SUPPORTED_FORMATS = [...AUDIO_FORMATS, ...VIDEO_FORMATS];

export async function getClient() {
  return { binary: await resolveInnertube() };
}

export function isAudioFormat(fmt) {
  return AUDIO_FORMATS.includes(fmt.toLowerCase());
}

export function isVideoFormat(fmt) {
  return VIDEO_FORMATS.includes(fmt.toLowerCase());
}

export function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function uniquify(destNoExt, ext) {
  let candidate = `${destNoExt}.${ext}`;
  if (!fs.existsSync(candidate)) return candidate;
  let counter = 1;
  while (fs.existsSync(`${destNoExt} (${counter}).${ext}`)) {
    counter++;
  }
  return `${destNoExt} (${counter}).${ext}`;
}

export function extractVideoId(url) {
  const match = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function extractPlaylistId(url) {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ── Stream Fetch via innertube-rs ───────────────────────
export async function fetchStream(_client, videoId, { formatKind, quality, cookies }) {
  const bin = await resolveInnertube();
  return new Promise((resolve, reject) => {
    const fmtArg = formatKind === 'audio' ? 'mp3' : 'mp4';
    const args = ['stream', videoId, '-f', fmtArg];
    if (quality) args.push('-q', quality);
    if (cookies) args.push('--cookies', cookies);

    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('error', (err) => {
      reject(new Error(`Failed to execute innertube CLI (${bin}): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`innertube failed (exit code ${code}): ${stderr || stdout}`));
      }
      try {
        const data = JSON.parse(stdout);
        const info = {
          basic_info: {
            title: data.title,
            author: data.author,
            duration: data.durationSeconds,
          }
        };

        if (formatKind === 'audio') {
          if (!data.audio) throw new Error('No audio format returned by innertube');
          return resolve({
            info,
            videoId,
            kind: 'audio',
            audio: {
              format: {
                url: data.audio.url,
                mime_type: data.audio.mimeType,
                bitrate: data.audio.bitrate,
                content_length: data.audio.contentLength,
              }
            }
          });
        }

        if (!data.video) throw new Error('No video format returned by innertube');
        if (!data.audio) throw new Error('No audio format returned by innertube for video muxing');

        return resolve({
          info,
          videoId,
          kind: 'video',
          video: {
            format: {
              url: data.video.url,
              mime_type: data.video.mimeType,
              bitrate: data.video.bitrate,
              content_length: data.video.contentLength,
            }
          },
          audio: {
            format: {
              url: data.audio.url,
              mime_type: data.audio.mimeType,
              bitrate: data.audio.bitrate,
              content_length: data.audio.contentLength,
            }
          }
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse innertube JSON: ${parseErr.message}\nRaw: ${stdout}`));
      }
    });
  });
}

async function runFfmpeg(args, onStderr) {
  const ffmpeg = await resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    ff.stderr.on('data', (chunk) => onStderr?.(chunk.toString()));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
}

/** Guess audio ffmpeg codec args to go from a source mime_type to a target extension. */
function buildAudioArgs({ sourceMime, targetExt, quality, input }) {
  const args = ['-y', '-i', input || 'pipe:0', '-vn'];
  const q = Number(quality);
  const bitrate = Number.isFinite(q) && q > 0 ? `${q}k` : null;
  const sourceIsOpus = /opus/i.test(sourceMime || '');
  const sourceIsAac = /mp4a/i.test(sourceMime || '');

  switch (targetExt) {
    case 'mp3':
      args.push('-acodec', 'libmp3lame');
      if (bitrate) args.push('-b:a', bitrate);
      break;
    case 'wav':
      args.push('-acodec', 'pcm_s16le');
      break;
    case 'flac':
      args.push('-acodec', 'flac');
      break;
    case 'ogg':
      args.push('-acodec', 'libvorbis');
      if (bitrate) args.push('-b:a', bitrate);
      break;
    case 'opus':
      sourceIsOpus ? args.push('-acodec', 'copy') : args.push('-acodec', 'libopus');
      if (bitrate && !sourceIsOpus) args.push('-b:a', bitrate);
      break;
    case 'm4a':
    case 'aac':
      sourceIsAac ? args.push('-acodec', 'copy') : args.push('-acodec', 'aac');
      if (bitrate && !sourceIsAac) args.push('-b:a', bitrate);
      break;
    default:
      args.push('-acodec', 'libmp3lame');
      if (bitrate) args.push('-b:a', bitrate);
  }
  return args;
}

/**
 * Fetch and convert an audio format to a target file via innertube download + ffmpeg.
 */
export async function convertAudioToFile({ videoId, format, destNoExt, targetExt, quality, cookies, onProgress }) {
  const outPath = `${destNoExt}.${targetExt}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpull-'));
  const tmpPath = path.join(tmpDir, 'raw.tmp');
  const bin = await resolveInnertube();

  try {
    const args = ['download', videoId, '-f', targetExt, '--output-audio', tmpPath];
    if (quality) args.push('-q', quality);
    if (cookies) args.push('--cookies', cookies);

    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let resultMeta = null;

    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'progress') {
              onProgress?.({ downloaded: ev.downloaded, total: ev.total, done: false });
            } else if (ev.type === 'done') {
              resultMeta = ev;
            }
          } catch {}
        }
      });
      proc.stderr.on('data', (d) => { stderr += d; });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`innertube download failed (code ${code}): ${stderr || stdout}`));
      });
    });

    onProgress?.({ done: true });

    const mime = resultMeta?.audioMime || format?.mime_type;
    const ffmpegArgs = buildAudioArgs({ sourceMime: mime, targetExt, quality, input: tmpPath });
    ffmpegArgs.push(outPath);

    await runFfmpeg(ffmpegArgs, (stderr) => {
      const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
      if (match) onProgress?.({ ffmpegTime: match[1] });
    });

    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Fetch video and audio streams via innertube download and mux them with ffmpeg.
 */
export async function muxVideoToFile({ videoId, video, audio, destNoExt, targetExt, quality, cookies, onProgress }) {
  const outPath = `${destNoExt}.${targetExt}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpull-'));
  const tmpVideo = path.join(tmpDir, 'video.tmp');
  const tmpAudio = path.join(tmpDir, 'audio.tmp');
  const bin = await resolveInnertube();

  try {
    const args = ['download', videoId, '-f', targetExt, '--output-audio', tmpAudio, '--output-video', tmpVideo];
    if (quality) args.push('-q', quality);
    if (cookies) args.push('--cookies', cookies);

    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let resultMeta = null;

    let aBytes = 0; let aTotal = 0;
    let vBytes = 0; let vTotal = 0;

    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'progress') {
              if (ev.stream === 'audio') { aBytes = ev.downloaded; aTotal = ev.total; }
              if (ev.stream === 'video') { vBytes = ev.downloaded; vTotal = ev.total; }
              onProgress?.({ downloaded: aBytes + vBytes, total: (aTotal + vTotal) || undefined, done: false });
            } else if (ev.type === 'done') {
              resultMeta = ev;
            }
          } catch {}
        }
      });
      proc.stderr.on('data', (d) => { stderr += d; });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`innertube download failed (code ${code}): ${stderr || stdout}`));
      });
    });

    onProgress?.({ done: true });

    const videoMime = resultMeta?.videoMime || video?.format?.mime_type || '';
    const audioMime = resultMeta?.audioMime || audio?.format?.mime_type || '';
    const isAvc = /avc1|h264/i.test(videoMime);
    const isVp9orVp8orAv1 = /vp9|vp8|av01/i.test(videoMime);
    const isAac = /mp4a/i.test(audioMime);
    const isOpusOrVorbis = /opus|vorbis/i.test(audioMime);

    let vArgs;
    let aArgs;
    if (targetExt === 'mkv') {
      vArgs = ['-c:v', 'copy'];
      aArgs = ['-c:a', 'copy'];
    } else if (targetExt === 'webm') {
      vArgs = isVp9orVp8orAv1 ? ['-c:v', 'copy'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32'];
      aArgs = isOpusOrVorbis ? ['-c:a', 'copy'] : ['-c:a', 'libopus'];
    } else {
      vArgs = isAvc ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'];
      aArgs = isAac ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'];
    }

    const ffmpegArgs = ['-y', '-i', tmpVideo, '-i', tmpAudio, ...vArgs, ...aArgs, '-map', '0:v:0', '-map', '1:a:0', outPath];
    await runFfmpeg(ffmpegArgs, (stderr) => {
      const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
      if (match) onProgress?.({ ffmpegTime: match[1] });
    });

    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}