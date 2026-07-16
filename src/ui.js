import pc from 'picocolors';
import readline from 'node:readline';

/** log('OK', pc.green, 'Download complete') -> "[OK] Download complete" */
export function log(prefix, color, msg) {
  console.error(`${color(`[${prefix}]`)} ${msg}`);
}

export function askLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Minimal single-line spinner, good enough for a CLI (no extra TUI dependency). */
export function spinner(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${pc.cyan(frames[i = (i + 1) % frames.length])} ${label}`);
  }, 80);
  return {
    update(newLabel) {
      label = newLabel;
    },
    stop(finalMsg) {
      clearInterval(timer);
      process.stdout.write(`\r${' '.repeat(label.length + 2)}\r`);
      if (finalMsg) console.log(finalMsg);
    }
  };
}

export { pc as c };
