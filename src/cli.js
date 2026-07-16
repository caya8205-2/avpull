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
  SUPPORTED_FORMATS
} from './lib.js';
import { log, c, askLine, spinner } from './ui.js';

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
  const program = new Command();

  program
    .name('avpull')
    .description('Download audio/video from YouTube, convert directly to your chosen format (mp3, wav, mp4, etc.)');

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
    .option('-f, --format <format>', `output format (${SUPPORTED_FORMATS.join(', ')})`, 'mp3')
    .option('-o, --output <dir>', 'output directory', 'avpull')
    .option('-n, --name <name>', 'custom filename (no extension, only works with 1 URL)')
    .option('-q, --quality <n>', 'audio: bitrate kbps (e.g. 192, 320). video: resolution (e.g. 720, 1080, best)')
    .option('-b, --batch <file>', 'read URLs from a text file (one URL per line)')
    .action(async (urls, opts) => {
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