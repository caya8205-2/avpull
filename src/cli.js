import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  getClient,
  extractVideoId,
  fetchStream,
  convertAudioToFile,
  muxVideoToFile,
  isVideoFormat,
  safeFilename,
  formatBytes,
  AUDIO_FORMATS,
  VIDEO_FORMATS,
  SUPPORTED_FORMATS
} from './lib.js';
import { isYouTubeUrl } from './platform.js';
import { getMediaInfo, downloadWithYtDlp } from './ytdlp.js';
import https from 'node:https';
import { log, c, askLine, spinner } from './ui.js';

const CURRENT_VERSION = '0.8.1';
const CONFIG_DIR = path.join(os.homedir(), '.avpull');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(key, value) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const cfg = loadConfig();
  cfg[key] = value;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getDefaultOutput() {
  const env = process.env.AVPULL_OUTPUT;
  if (env) return path.resolve(env);
  const cfg = loadConfig();
  if (cfg.defaultOutput) return cfg.defaultOutput;
  return path.join(os.homedir(), 'Downloads', 'avpull');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'avpull-updater' }, timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) { res.destroy(); reject(new Error(`${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('parse')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseVersion(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function isNewer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

async function checkForUpdates() {
  try {
    const release = await fetchJson('https://api.github.com/repos/caya8205-2/avpull/releases/latest');
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(CURRENT_VERSION);
    if (!isNewer(latest, current)) return;

    console.log();
    log('UPDATE', c.yellow, `v${latest.join('.')} is available (current: v${current.join('.')})`);
    
    // Detect how it's currently running
    const execName = process.execPath.split(/[\\/]/).pop().toLowerCase();
    const isStandalone = execName === 'avpull.exe' || execName === 'avpull';

    if (isStandalone) {
      if (process.platform === 'win32') {
        log('INFO', c.cyan, '  powershell -ExecutionPolicy Bypass -c "irm https://avpull.caya.web.id/install.ps1 | iex"');
      } else {
        log('INFO', c.cyan, '  curl -fsSL https://avpull.caya.web.id/install.sh | bash');
      }
    } else {
      log('INFO', c.cyan, '  npm i -g avpull@latest');
    }
    console.log();
  } catch {}
}

function uniquify(destNoExt, ext) {
  let out = `${destNoExt}.${ext}`;
  let i = 2;
  while (fs.existsSync(out)) {
    out = `${destNoExt} (${i}).${ext}`;
    i++;
  }
  return out;
}

async function readBatchFile(file) {
  const content = await fs.promises.readFile(file, 'utf-8');
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function makeProgressHandler(spin, label) {
  return ({ downloaded, total, done, ffmpegTime }) => {
    if (ffmpegTime) {
      spin.update(`${label} — converting (time: ${ffmpegTime})`);
      return;
    }
    if (done) {
      spin.update(`${label} — finalizing...`);
      return;
    }
    const dl = formatBytes(downloaded);
    if (total) {
      const pct = Math.min(100, Math.round((downloaded / total) * 100));
      spin.update(`${label} — download & convert ${pct}% (${dl}/${formatBytes(total)})`);
    } else {
      spin.update(`${label} — download & convert ${dl}`);
    }
  };
}

async function processOneYouTube(client, rawUrl, opts, format, index, total) {
  const label = total > 1 ? `[${index + 1}/${total}] ${rawUrl}` : rawUrl;
  const id = extractVideoId(rawUrl);
  if (!id) {
    log('ERR', c.red, `Unrecognized YouTube URL, skipping: ${rawUrl}`);
    return;
  }

  const isVideo = isVideoFormat(format);
  const maxRetries = 3;
  let firstOutPath = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const spin = spinner(`${label} — fetching info...`);
    try {
      const result = await fetchStream(client, id, {
        formatKind: isVideo ? 'video' : 'audio',
        quality: opts.quality,
        poToken: opts.poToken,
        cookies: opts.cookies
      });

      const title = result.info.basic_info?.title || id;
      const useCustomName = opts.name && total === 1;
      const baseName = useCustomName ? opts.name : safeFilename(title);
      const destNoExt = path.join(opts.output, baseName);

      let outPath, outNoExt;
      if (attempt === 1) {
        outPath = uniquify(destNoExt, format);
        firstOutPath = outPath;
      } else {
        outPath = firstOutPath;
        if (fs.existsSync(outPath)) {
          fs.rmSync(outPath, { force: true });
        }
      }
      outNoExt = outPath.slice(0, -(format.length + 1));

      if (isVideo) {
        await muxVideoToFile({
          videoId: id,
          video: result.video,
          audio: result.audio,
          destNoExt: outNoExt,
          targetExt: format,
          quality: opts.quality,
          poToken: opts.poToken,
          cookies: opts.cookies,
          onProgress: makeProgressHandler(spin, label)
        });
      } else {
        await convertAudioToFile({
          videoId: id,
          format: result.audio.format,
          destNoExt: outNoExt,
          targetExt: format,
          quality: opts.quality || 192,
          poToken: opts.poToken,
          cookies: opts.cookies,
          onProgress: makeProgressHandler(spin, label)
        });
      }

      spin.stop(`${c.green('[OK]')} ${title} -> ${c.dim(outPath)}`);
      return;
    } catch (err) {
      const is403 = err.message.includes('403') || err.message.includes('Forbidden');
      if (is403 || attempt >= maxRetries) {
        spin.stop(`${c.yellow('[INFO]')} ${label} — YouTube CDN stream restricted, falling back to yt-dlp...`);
        return await processOneExternal(rawUrl, opts, format, index, total);
      }
      const retryMsg = ` — retrying (${attempt}/${maxRetries})`;
      spin.stop(`${c.red('[ERR]')} ${label} — ${err.message}${retryMsg}`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

async function processOneExternal(rawUrl, opts, format, index, total) {
  const label = total > 1 ? `[${index + 1}/${total}] ${rawUrl}` : rawUrl;
  const maxRetries = 2;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const spin = spinner(`${label} — fetching info...`);
    try {
      const info = await getMediaInfo(rawUrl, {
        cookies: opts.cookies,
        cookiesBrowser: opts.cookiesBrowser
      });

      const title = info.title || 'untitled';
      const useCustomName = opts.name && total === 1;
      const baseName = useCustomName ? opts.name : safeFilename(title);
      const destNoExt = path.join(opts.output, baseName);
      const outPath = uniquify(destNoExt, format);
      const outNoExt = outPath.slice(0, -(format.length + 1));

      spin.update(`${label} — downloading...`);

      const finalPath = await downloadWithYtDlp({
        url: rawUrl,
        destNoExt: outNoExt,
        targetExt: format,
        quality: opts.quality,
        cookies: opts.cookies,
        cookiesBrowser: opts.cookiesBrowser,
        onProgress: ({ percent }) => {
          spin.update(`${label} — download ${percent.toFixed(1)}%`);
        }
      });

      spin.stop(`${c.green('[OK]')} ${title} -> ${c.dim(finalPath)}`);
      return;
    } catch (err) {
      lastErr = err;
      const retryMsg = attempt < maxRetries ? ` — retrying (${attempt}/${maxRetries - 1})` : '';
      spin.stop(`${c.red('[ERR]')} ${label} — ${err.message}${retryMsg}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }

  // ── Ultimate Guardrail Fallback: Progressive MP4 stream ──
  const spinGuard = spinner(`${label} — trying fallback via stable MP4 stream...`);
  try {
    const fallbackBase = (opts.name && total === 1) ? opts.name : safeFilename(extractVideoId(rawUrl) || 'download');
    const destNoExt = path.join(opts.output, fallbackBase);
    const outPath = uniquify(destNoExt, format);
    const outNoExt = outPath.slice(0, -(format.length + 1));

    const finalPath = await downloadWithYtDlp({
      url: rawUrl,
      destNoExt: outNoExt,
      targetExt: format,
      quality: opts.quality,
      forceMp4Stream: true,
      cookies: opts.cookies,
      cookiesBrowser: opts.cookiesBrowser,
      onProgress: ({ percent }) => {
        spinGuard.update(`${label} — fallback MP4 stream download ${percent.toFixed(1)}%`);
      }
    });

    spinGuard.stop(`${c.green('[OK]')} ${fallbackBase} (via MP4 guardrail) -> ${c.dim(finalPath)}`);
  } catch (finalErr) {
    spinGuard.stop(`${c.red('[ERR]')} ${label} — guardrail fallback failed: ${finalErr.message}`);
  }
}

export async function runCli(argv) {
  await checkForUpdates();

  const program = new Command();

  program
    .name('avpull')
    .description('Download audio/video from YouTube, convert directly to your chosen format (mp3, wav, mp4, etc.)')
    .version(CURRENT_VERSION, '-v, --version', 'output the current version');

  program.addHelpText('after', `
Examples:
  avpull "https://youtu.be/VIDEO_ID"
  avpull "https://youtu.be/VIDEO_ID" -f mp3 -q 320
  avpull "https://youtu.be/VIDEO_ID" -f mp4 -q 1080 -o ./videos
  avpull "https://x.com/user/status/123" -f mp4
  avpull "https://www.tiktok.com/@user/video/123" -f mp3
  avpull "https://www.instagram.com/reel/ABC/" --cookies-from-browser chrome
  avpull -b urls.txt -f wav
  avpull "https://youtu.be/VIDEO_ID" -n "my song"
  avpull -s ~/Music/avpull
  avpull --show-default`);

  program.command('uninstall')
    .description('Remove avpull from the system')
    .action(async () => {
      if (process.platform === 'win32') {
        // ── Windows uninstall ──
        const appDir = path.join(process.env.LOCALAPPDATA || '', 'avpull');
        const exeDir = path.dirname(process.execPath);

        if (path.resolve(exeDir) !== path.resolve(appDir)) {
          log('ERR', c.red, 'avpull is not installed via the official installer.');
          log('INFO', c.cyan, 'Try: npm uninstall -g avpull');
          log('INFO', c.cyan, 'Or run "Get-Command avpull" to find the location and delete it manually.');
          return;
        }

        log('WARN', c.yellow, 'This will remove avpull from your system.');
        const answer = await askLine('Continue? [y/N] ');
        if (!answer.toLowerCase().startsWith('y')) {
          log('INFO', c.cyan, 'Cancelled.');
          return;
        }

        try {
          execSync(
            `powershell -Command "$p=[Environment]::GetEnvironmentVariable('PATH','User');$p=($p -split ';'|?{$_ -ne '${appDir.replace(/'/g, "''")}'})-join';';[Environment]::SetEnvironmentVariable('PATH',$p,'User')"`,
            { stdio: 'pipe' }
          );
          log('OK', c.green, 'Removed from PATH (user-level).');
        } catch (err) {
          log('WARN', c.yellow, `Could not update PATH: ${err.message}`);
        }

        const tmpScript = path.join(os.tmpdir(), 'avpull-cleanup.bat');
        const batContent =
          '@echo off\r\n' +
          'ping 127.0.0.1 -n 3 > nul\r\n' +
          'rmdir /s /q "' + appDir + '"\r\n' +
          'del "' + tmpScript + '"\r\n';
        fs.writeFileSync(tmpScript, batContent, 'utf-8');
        execSync(`start /B "" "${tmpScript}"`, { stdio: 'ignore' });

        log('OK', c.green, 'avpull will be removed after this window closes.');
        log('INFO', c.cyan, 'Close this terminal, then the uninstaller will finish.');
      } else {
        // ── Linux / macOS uninstall ──
        const appDir = path.join(os.homedir(), '.local', 'bin', 'avpull');
        const exeDir = path.dirname(process.execPath);

        if (path.resolve(exeDir) !== path.resolve(appDir)) {
          log('ERR', c.red, 'avpull is not installed via the official installer.');
          log('INFO', c.cyan, 'Try: npm uninstall -g avpull');
          log('INFO', c.cyan, 'Or run "which avpull" to find the location and delete it manually.');
          return;
        }

        log('WARN', c.yellow, 'This will remove avpull from your system.');
        const answer = await askLine('Continue? [y/N] ');
        if (!answer.toLowerCase().startsWith('y')) {
          log('INFO', c.cyan, 'Cancelled.');
          return;
        }

        // Remove install directory
        try {
          fs.rmSync(appDir, { recursive: true, force: true });
          log('OK', c.green, `Removed ${appDir}`);
        } catch (err) {
          log('WARN', c.yellow, `Could not remove directory: ${err.message}`);
        }

        // Remove PATH entries from shell rc files
        const rcFiles = ['.bashrc', '.zshrc', '.profile'].map(f => path.join(os.homedir(), f));
        for (const rc of rcFiles) {
          try {
            if (!fs.existsSync(rc)) continue;
            let content = fs.readFileSync(rc, 'utf-8');
            const lines = content.split('\n');
            const filtered = lines.filter(l => !l.includes(appDir) && l.trim() !== '# avpull');
            fs.writeFileSync(rc, filtered.join('\n'));
          } catch {}
        }
        log('OK', c.green, 'Removed from PATH (shell rc files).');
        log('INFO', c.cyan, 'Open a new terminal for changes to take effect.');
      }
    });

  program
    .argument('[urls...]', 'one or more YouTube URLs')
    .option('-f, --format <format>', `output format: ${AUDIO_FORMATS.join(', ')} (audio), ${VIDEO_FORMATS.join(', ')} (video)`, 'mp3')
    .option('-o, --output <dir>', 'output directory')
    .option('-s, --save-default <dir>', 'set and save default output directory')
    .option('--sd, --show-default', 'show current default output directory')
    .option('-n, --name <name>', 'custom filename (no extension, only works with 1 URL)')
    .option('-q, --quality <n>', 'audio: bitrate kbps (128, 192, 256, 320, etc). video: resolution (240, 360, 480, 720, 1080) or best')
    .option('-b, --batch <file>', 'read URLs from a text file (one URL per line)')
    .option('--cookies-from-browser <browser>', 'use cookies from browser (chrome, firefox, edge, brave) — needed for Instagram/Facebook')
    .option('--cookies <file>', 'path to cookies.txt file (Netscape format)')
    .option('--po-token <token>', 'YouTube Proof of Origin token (PO-Token) for unthrottled 720p/1080p/4K')
    .option('--save-po-token <token>', 'set and save default YouTube PO-Token')
    .action(async (urls, opts) => {
      // (action body unchanged, we just need to add the argv patch before parse)

      if (opts.showDefault) {
        log('OK', c.cyan, getDefaultOutput());
        return;
      }

      if (opts.saveDefault) {
        const resolved = path.resolve(opts.saveDefault);
        saveConfig('defaultOutput', resolved);
        log('OK', c.green, `Default output set to: ${resolved}`);
        if (!urls.length && !opts.batch) return;
      }

      if (opts.savePoToken) {
        saveConfig('poToken', opts.savePoToken);
        log('OK', c.green, `Default PO-Token saved.`);
        if (!urls.length && !opts.batch) return;
      }

      const cfg = loadConfig();
      if (!opts.poToken && cfg.poToken) opts.poToken = cfg.poToken;
      if (!opts.cookies && cfg.cookies) opts.cookies = cfg.cookies;

      opts.output = opts.output ? path.resolve(opts.output) : getDefaultOutput();
      const format = String(opts.format).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(format)) {
        log('ERR', c.red, `Format "${format}" not supported. Options: ${SUPPORTED_FORMATS.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      let list = [...urls];

      if (opts.batch) {
        try {
          list.push(...(await readBatchFile(opts.batch)));
        } catch (err) {
          log('ERR', c.red, `Failed to read batch file: ${err.message}`);
          process.exitCode = 1;
          return;
        }
      }

      if (list.length === 0) {
        log('avpull', c.cyan, 'download & convert audio/video from YouTube');
        console.log();
        log('INFO', c.yellow, 'No URLs provided.');
        const input = await askLine('Audio/Video URL: ');
        if (!input) {
          log('ERR', c.red, 'No URL provided, exiting.');
          process.exitCode = 1;
          return;
        }
        list = input.split(',').map((s) => s.trim()).filter(Boolean);
      }

      if (opts.name && list.length > 1) {
        log('WARN', c.yellow, '--name ignored because there is more than 1 URL, using video titles as filenames.');
      }

      // Lazy-init YouTube client only if needed
      let client = null;
      for (let i = 0; i < list.length; i++) {
        if (isYouTubeUrl(list[i])) {
          if (!client) client = await getClient();
          await processOneYouTube(client, list[i], opts, format, i, list.length);
        } else {
          await processOneExternal(list[i], opts, format, i, list.length);
        }
      }
    });

  const sdIndex = argv.indexOf('-sd');
  if (sdIndex !== -1) {
    argv[sdIndex] = '--sd';
  }
  await program.parseAsync(argv);
}