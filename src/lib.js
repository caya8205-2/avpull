import { Innertube, Platform, Constants } from 'youtubei.js';
import { spawn } from 'node:child_process';
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

export const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'opus', 'flac', 'aac', 'ogg'];
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv'];
export const SUPPORTED_FORMATS = [...AUDIO_FORMATS, ...VIDEO_FORMATS];

const AUDIO_CLIENTS = ['ANDROID_VR', 'ANDROID', 'IOS', 'TV_SIMPLY', 'MWEB', 'WEB'];
const VIDEO_CLIENTS = ['TV_SIMPLY', 'MWEB', 'WEB', 'ANDROID', 'IOS'];

let clientPromise = null;

/** Lazy singleton Innertube client (avoids re-negotiating a session per URL). */
export function getClient() {
  if (!clientPromise) {
    Platform.shim.eval = async (arg) => {
      if (typeof arg === 'string') {
        try {
          return new Function(`return (${arg})`)();
        } catch {
          return new Function(arg)();
        }
      }
      if (typeof arg === 'object' && arg !== null) {
        const code = arg.output || arg.code;
        if (code) {
          const fn = new Function(code);
          return fn();
        }
      }
      return eval(arg);
    };

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

/**
 * Try each YouTube client in turn until one returns a format whose URL can
 * be deciphered. Returns { info, format, client }.
 */
async function chooseValidatedFormat(client, videoId, chooseOpts) {
  const isVideo = chooseOpts.type === 'video';
  const clientList = isVideo ? VIDEO_CLIENTS : AUDIO_CLIENTS;
  const failures = [];

  for (const clientType of clientList) {
    try {
      const info = await client.getBasicInfo(videoId, { client: clientType });
      let format;
      try {
        format = info.chooseFormat(chooseOpts);
      } catch {
        const adaptive = (info.streaming_data?.adaptive_formats || []).filter(
          (f) => (isVideo ? f.has_video && !f.has_audio : f.has_audio && !f.has_video)
        );
        if (adaptive.length > 0) {
          if (isVideo && chooseOpts.quality && chooseOpts.quality !== 'best') {
            const targetHeight = parseInt(chooseOpts.quality);
            const sorted = adaptive.filter((f) => f.height).sort((a, b) => b.height - a.height);
            format = sorted.find((f) => f.height <= targetHeight) || sorted[sorted.length - 1];
          } else {
            format = adaptive[0];
          }
        } else {
          throw new Error('No matching formats found');
        }
      }

      if (!format) throw new Error('Format could not be resolved');
      let decipheredUrl = await info.actions.session.player.decipher(format.url || format.signature_cipher || format.cipher);
      if (!decipheredUrl) throw new Error('No playable URL returned after decipher');
      if (isLimitedIosStream(decipheredUrl)) throw new Error('Skipping limited iOS stream URL');

      if (info.cpn && !decipheredUrl.includes('&cpn=')) {
        decipheredUrl += `&cpn=${info.cpn}`;
      }

      format.url = decipheredUrl;
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
 */
export async function fetchStream(client, videoId, { formatKind, quality }) {
  if (formatKind === 'audio') {
    let audioResult;
    try {
      audioResult = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best', format: 'opus' });
    } catch {
      audioResult = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best' });
    }
    return { info: audioResult.info, kind: 'audio', audio: { format: audioResult.format, session: audioResult.info.actions.session } };
  }

  const { info, format: videoFormat } = await chooseValidatedFormat(client, videoId, {
    type: 'video',
    quality: normalizeVideoQuality(quality),
    format: 'any'
  });
  
  let audioResult;
  try {
    audioResult = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best', format: 'opus' });
  } catch {
    audioResult = await chooseValidatedFormat(client, videoId, { type: 'audio', quality: 'best' });
  }

  return {
    info,
    kind: 'video',
    video: { format: videoFormat, session: info.actions.session },
    audio: { format: audioResult.format, session: audioResult.info.actions.session }
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

// ── Stream Download Pipeline ────────────────────────────
async function downloadFormatToFile(format, tmpPath, onProgress, session) {
  const url = format.url;
  const total = format.content_length ? Number(format.content_length) : null;
  const fetchFn = session?.http?.fetch_function || globalThis.fetch;
  const out = fs.createWriteStream(tmpPath);

  const CHUNK_BLOCK = 10 * 1024 * 1024; // 10MB ranges
  let downloaded = 0;

  if (total && total > CHUNK_BLOCK) {
    while (downloaded < total) {
      const end = Math.min(downloaded + CHUNK_BLOCK - 1, total - 1);
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          ...Constants.STREAM_HEADERS,
          Range: `bytes=${downloaded}-${end}`,
        },
      });

      if (!res.ok && res.status !== 206 && res.status !== 200) {
        throw new Error(`Stream chunk (${downloaded}-${end}) failed: ${res.status} ${res.statusText}`);
      }

      for await (const chunk of res.body) {
        out.write(chunk);
        downloaded += chunk.length;
        onProgress?.({ downloaded, total });
      }
    }
  } else {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        ...Constants.STREAM_HEADERS,
        Range: 'bytes=0-',
      },
    });

    if (!res.ok && res.status !== 206 && res.status !== 200) {
      throw new Error(`Stream failed: ${res.status} ${res.statusText}`);
    }

    for await (const chunk of res.body) {
      out.write(chunk);
      downloaded += chunk.length;
      onProgress?.({ downloaded, total: total || downloaded });
    }
  }

  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });

  onProgress?.({ downloaded: total || downloaded, total: total || downloaded, done: true });
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
 * Fetch an audio-only format to a temp file (with resume on failure), then
 * encode it with ffmpeg. `onProgress({ downloaded, total })` fires periodically
 * as bytes stream in.
 */
export async function convertAudioToFile({ format, session, destNoExt, targetExt, quality, onProgress }) {
  const outPath = `${destNoExt}.${targetExt}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpull-'));
  const tmpPath = path.join(tmpDir, 'raw.tmp');

  try {
    await downloadFormatToFile(format, tmpPath, onProgress, session);

    const args = buildAudioArgs({ sourceMime: format.mime_type, targetExt, quality, input: tmpPath });
    args.push(outPath);
    await runFfmpeg(args, (stderr) => {
      const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
      if (match) onProgress?.({ ffmpegTime: match[1] });
    });
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
      downloadFormatToFile(video.format, tmpVideo, (p) => { vBytes = p.downloaded; emit(); }, video.session),
      downloadFormatToFile(audio.format, tmpAudio, (p) => { aBytes = p.downloaded; emit(); }, audio.session),
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
    await runFfmpeg(args, (stderr) => {
      const match = stderr.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
      if (match) onProgress?.({ ffmpegTime: match[1] });
    });
    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}