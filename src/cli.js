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
import https from 'node:https';
import { log, c, askLine, spinner } from './ui.js';

const CURRENT_VERSION = '0.3.0';
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
    log('INFO', c.cyan, '  npm:    npm i -g avpull@latest');
    log('INFO', c.cyan, '  script: powershell -ExecutionPolicy Bypass -c "irm https://caya8205-2.github.io/avpull/install.ps1 | iex"');
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
  return ({ downloaded, total, done }) => {
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

async function processOne(client, rawUrl, opts, format, index, total) {
  const label = total > 1 ? `[${index + 1}/${total}] ${rawUrl}` : rawUrl;
  const id = extractVideoId(rawUrl);
  if (!id) {
    log('ERR', c.red, `Unrecognized URL, skipping: ${rawUrl}`);
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
        quality: opts.quality
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
          video: result.video,
          audio: result.audio,
          destNoExt: outNoExt,
          targetExt: format,
          onProgress: makeProgressHandler(spin, label)
        });
      } else {
        await convertAudioToFile({
          format: result.audio.format,
          destNoExt: outNoExt,
          targetExt: format,
          quality: opts.quality || 192,
          onProgress: makeProgressHandler(spin, label)
        });
      }

      spin.stop(`${c.green('[OK]')} ${title} -> ${c.dim(outPath)}`);
      return;
    } catch (err) {
      const retryMsg = attempt < maxRetries ? ` — retrying (${attempt}/${maxRetries - 1})` : '';
      spin.stop(`${c.red('[ERR]')} ${label} — ${err.message}${retryMsg}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }
}

export async function runCli(argv) {
  await checkForUpdates();

  const program = new Command();

  program
    .name('avpull')
    .description('Download audio/video from YouTube, convert directly to your chosen format (mp3, wav, mp4, etc.)');

  program.addHelpText('after', `
Examples:
  avpull "https://youtu.be/VIDEO_ID"
  avpull "https://youtu.be/VIDEO_ID" -f mp3 -q 320
  avpull "https://youtu.be/VIDEO_ID" -f mp4 -q 1080 -o ./videos
  avpull -b urls.txt -f wav
  avpull "https://youtu.be/VIDEO_ID" -n "my song"
  avpull -s ~/Music/avpull
  avpull --show-default`);

  program.command('uninstall')
    .description('Remove avpull from the system (AppData + PATH)')
    .action(async () => {
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
    });

  program
    .argument('[urls...]', 'one or more YouTube URLs')
    .option('-f, --format <format>', `output format: ${AUDIO_FORMATS.join(', ')} (audio), ${VIDEO_FORMATS.join(', ')} (video)`, 'mp3')
    .option('-o, --output <dir>', 'output directory')
    .option('-s, --save-default <dir>', 'set and save default output directory')
    .option('--show-default', 'show current default output directory')
    .option('-n, --name <name>', 'custom filename (no extension, only works with 1 URL)')
    .option('-q, --quality <n>', 'audio: bitrate kbps (128, 192, 256, 320, etc). video: resolution (240, 360, 480, 720, 1080) or best')
    .option('-b, --batch <file>', 'read URLs from a text file (one URL per line)')
    .action(async (urls, opts) => {
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

      const client = await getClient();
      for (let i = 0; i < list.length; i++) {
        await processOne(client, list[i], opts, format, i, list.length);
      }
    });

  await program.parseAsync(argv);
}