import { Innertube, Constants } from 'youtubei.js';
import { spawn } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, c } from './ui.js';

let _ffmpegCached = null;
async function resolveFfmpeg() {
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

export const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'opus', 'flac', 'aac', 'ogg'];
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv'];
export const SUPPORTED_FORMATS = [...AUDIO_FORMATS, ...VIDEO_FORMATS];

// Same fallback order Noctune's resolver uses in production — WEB alone
// often can't decipher without a po_token, but these usually can.
const YOUTUBEI_CLIENTS = ['ANDROID', 'IOS', 'WEB', 'MWEB', 'TV_SIMPLY', 'ANDROID_VR'];

let clientPromise = null;

/** Lazy singleton Innertube client (avoids re-negotiating a session per URL). */
export function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create();
  }
  return clientPromise;
}

const ID_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=)([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
  /youtube\.com\/live\/([\w-]{11})/
];

/** Extract an 11-char YouTube video ID from a URL, or accept a raw ID. */
export function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  for (const re of ID_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

export function isAudioFormat(fmt) {
  return AUDIO_FORMATS.includes(fmt);
}

export function isVideoFormat(fmt) {
  return VIDEO_FORMATS.includes(fmt);
}

/** Sanitize a video title into a safe filename. */
export function safeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

export function formatBytes(n) {
  if (!n && n !== 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
}

function normalizeVideoQuality(q) {
  if (!q) return 'best';
  const s = String(q).trim().toLowerCase();
  if (s === 'best' || s === 'bestefficiency') return s;
  return /p$/.test(s) ? s : `${s}p`;
}

/** iOS-client stream URLs are throttled/range-limited — same guard Noctune uses. */
function isLimitedIosStream(url) {
  try {
    return new URL(url).searchParams.get('c')?.toUpperCase() === 'IOS';
  } catch {
    return url.includes('c=IOS');
  }
}

/** Quick range probe to confirm a deciphered URL is actually fetchable before committing to it. */
function validateStreamUrl(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const doProbe = (attempt) => {
      const headers = { ...Constants.STREAM_HEADERS, Range: 'bytes=0-1048575' };
      const req = https.get(url, { headers }, (res) => {
        res.destroy();
        if (res.statusCode === 200 || res.statusCode === 206) {
          resolve();
        } else {
          reject(new Error(`URL not playable: ${res.statusCode} ${res.statusMessage}`));
        }
      });
      req.on('error', (err) => {
        if (attempt < retries) {
          setTimeout(() => doProbe(attempt + 1), 500 * attempt);
        } else {
          reject(err);
        }
      });
      req.on('socket', (socket) => {
        socket.on('error', () => {});
      });
    };
    doProbe(1);
  });
}

/**
 * Try each YouTube client in turn until one returns a format whose URL can
 * be deciphered *and* is actually fetchable. Returns { info, format, client }.
 */
async function chooseValidatedFormat(client, videoId, chooseOpts) {
  const failures = [];
  for (const clientType of YOUTUBEI_CLIENTS) {
    try {
      const info = await client.getBasicInfo(videoId, { client: clientType });
      const format = info.chooseFormat(chooseOpts);
      const url = await format.decipher(info.actions.session.player);
      if (!url) throw new Error('No playable URL returned');
      if (isLimitedIosStream(url)) throw new Error('Skipping limited iOS stream URL');
      await validateStreamUrl(url);
      format.url = url;
      return { info, format, client: clientType };
    } catch (err) {
      log('WARN', c.yellow, `[${clientType}] ${err.message}`);
      failures.push(`${clientType}: ${err.message}`);
    }
  }
  throw new Error(`All YouTube clients failed: ${failures.join(' | ')}`);
}

/**
 * Fetch video info + the format(s) needed for the requested output.
 *
 * YouTube almost never serves a real muxed "video+audio" stream above 360p
 * anymore, so for video we always grab the best-matching video-only
 * (adaptive) format and the best audio-only format separately, then mux
 * them with ffmpeg. Each format is resolved through a client fallback list
 * (mirrors Noctune's production resolver) since the default WEB client
 * frequently can't decipher a URL without a po_token.
 */
export async function fetchStream(client, videoId, { formatKind, quality }) {
  if (formatKind === 'audio') {
    const { info, format } = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best' });
    return { info, kind: 'audio', audio: { format } };
  }

  const { info, format: videoFormat } = await chooseValidatedFormat(client, videoId, {
    type: 'video',
    quality: normalizeVideoQuality(quality),
    format: 'any'
  });
  const { format: audioFormat } = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best' });

  return {
    info,
    kind: 'video',
    video: { format: videoFormat },
    audio: { format: audioFormat }
  };
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

// ── HTTP agent (keep-alive) ──────────────────────────────
let _agent;
function getAgent() {
  if (!_agent) _agent = new https.Agent({ keepAlive: true, maxSockets: 20 });
  return _agent;
}

// ── Parallel chunked download ────────────────────────────
const CHUNK_COUNT = 6;
const CHUNK_MIN_SIZE = 1024 * 1024;

async function downloadFormatToFile(format, tmpPath, onProgress) {
  const url = format.url;
  const total = format.content_length ? Number(format.content_length) : null;
  const agent = getAgent();

  if (total && total >= CHUNK_MIN_SIZE) {
    const chunkSize = Math.ceil(total / CHUNK_COUNT);
    const ranges = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      if (start > end) break;
      ranges.push({ start, end });
    }

    fs.writeFileSync(tmpPath, Buffer.alloc(total));

    let downloaded = 0;
    await Promise.all(ranges.map(({ start, end }) =>
      new Promise((resolve, reject) => {
        const headers = { ...Constants.STREAM_HEADERS, Range: `bytes=${start}-${end}` };
        https.get(url, { headers, agent }, (res) => {
          if (res.statusCode !== 206) {
            reject(new Error(`Chunk (${start}-${end}) failed: ${res.statusCode} ${res.statusMessage}`));
            return;
          }
          const parts = [];
          res.on('data', (d) => parts.push(d));
          res.on('end', () => {
            const buf = Buffer.concat(parts);
            const fd = fs.openSync(tmpPath, 'r+');
            fs.writeSync(fd, buf, 0, buf.length, start);
            fs.closeSync(fd);
            downloaded += buf.length;
            onProgress?.({ downloaded, total });
            resolve();
          });
          res.on('error', reject);
        }).on('error', reject);
      })
    ));
    onProgress?.({ downloaded: total, total, done: true });
  } else {
    let downloaded = 0;
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmpPath);
      https.get(url, { headers: Constants.STREAM_HEADERS, agent }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Stream failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }
        res.on('data', (chunk) => { downloaded += chunk.length; onProgress?.({ downloaded, total }); });
        res.pipe(out);
        out.on('finish', () => { onProgress?.({ downloaded, total, done: true }); resolve(); });
      }).on('error', reject);
    });
  }
}

/** Guess audio ffmpeg codec args to go from a source mime_type to a target extension. */
function buildAudioArgs({ sourceMime, targetExt, quality, input }) {
  const args = ['-y', '-i', input || 'pipe:0', '-vn'];
  const bitrate = quality ? `${quality}k` : '192k';
  const sourceIsOpus = /opus/i.test(sourceMime || '');
  const sourceIsAac = /mp4a/i.test(sourceMime || '');

  switch (targetExt) {
    case 'mp3':
      args.push('-acodec', 'libmp3lame', '-b:a', bitrate);
      break;
    case 'wav':
      args.push('-acodec', 'pcm_s16le');
      break;
    case 'flac':
      args.push('-acodec', 'flac');
      break;
    case 'ogg':
      args.push('-acodec', 'libvorbis', '-b:a', bitrate);
      break;
    case 'opus':
      sourceIsOpus ? args.push('-acodec', 'copy') : args.push('-acodec', 'libopus', '-b:a', bitrate);
      break;
    case 'm4a':
    case 'aac':
      sourceIsAac ? args.push('-acodec', 'copy') : args.push('-acodec', 'aac', '-b:a', bitrate);
      break;
    default:
      args.push('-acodec', 'libmp3lame', '-b:a', bitrate);
  }
  return args;
}

/**
 * Fetch an audio-only format to a temp file (with resume on failure), then
 * encode it with ffmpeg. `onProgress({ downloaded, total })` fires periodically
 * as bytes stream in.
 */
export async function convertAudioToFile({ format, destNoExt, targetExt, quality, onProgress }) {
  const outPath = `${destNoExt}.${targetExt}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpull-'));
  const tmpPath = path.join(tmpDir, 'raw.tmp');

  try {
    await downloadFormatToFile(format, tmpPath, onProgress);

    const args = buildAudioArgs({ sourceMime: format.mime_type, targetExt, quality, input: tmpPath });
    args.push(outPath);
    await runFfmpeg(args);
    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Fetch a video-only format and an audio-only format to temp files, then mux
 * them into a single output file with ffmpeg. Copies streams (fast remux)
 * whenever the source codec is already compatible with the target
 * container, only re-encoding when it isn't.
 * `onProgress({ downloaded, total })` reports combined bytes of both streams.
 */
export async function muxVideoToFile({ video, audio, destNoExt, targetExt, onProgress }) {
  const outPath = `${destNoExt}.${targetExt}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpull-'));
  const tmpVideo = path.join(tmpDir, 'video.tmp');
  const tmpAudio = path.join(tmpDir, 'audio.tmp');

  const vTotal = video.format.content_length ? Number(video.format.content_length) : undefined;
  const aTotal = audio.format.content_length ? Number(audio.format.content_length) : undefined;
  const total = vTotal !== undefined && aTotal !== undefined ? vTotal + aTotal : undefined;

  let vBytes = 0;
  let aBytes = 0;
  let lastEmit = 0;
  const emit = (done = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!done && now - lastEmit < 200) return;
    lastEmit = now;
    onProgress({ downloaded: vBytes + aBytes, total, done });
  };

  try {
    await Promise.all([
      downloadFormatToFile(video.format, tmpVideo, (p) => { vBytes = p.downloaded; emit(p.done); }),
      downloadFormatToFile(audio.format, tmpAudio, (p) => { aBytes = p.downloaded; emit(p.done); }),
    ]);
    emit(true);

    const videoMime = video.format.mime_type || '';
    const audioMime = audio.format.mime_type || '';
    const isAvc = /avc1|h264/i.test(videoMime);
    const isVp9orVp8orAv1 = /vp9|vp8|av01/i.test(videoMime);
    const isAac = /mp4a/i.test(audioMime);
    const isOpusOrVorbis = /opus|vorbis/i.test(audioMime);

    let vArgs;
    let aArgs;
    if (targetExt === 'mkv') {
      // mkv is a permissive container, almost anything muxes without re-encoding
      vArgs = ['-c:v', 'copy'];
      aArgs = ['-c:a', 'copy'];
    } else if (targetExt === 'webm') {
      vArgs = isVp9orVp8orAv1 ? ['-c:v', 'copy'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32'];
      aArgs = isOpusOrVorbis ? ['-c:a', 'copy'] : ['-c:a', 'libopus'];
    } else {
      // mp4
      vArgs = isAvc ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'];
      aArgs = isAac ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'];
    }

    const args = ['-y', '-i', tmpVideo, '-i', tmpAudio, ...vArgs, ...aArgs, '-map', '0:v:0', '-map', '1:a:0', outPath];
    await runFfmpeg(args);
    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}