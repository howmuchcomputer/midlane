import { spawn } from 'node:child_process';

// Pass the address as an argument, never through a shell.
export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export function openBrowser(url) {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  const fallback = () => console.log(`  Open this address in your browser to play: ${url}\n`);
  child.once('error', fallback);
  child.once('exit', (code) => { if (code !== 0 && code !== null) fallback(); });
  child.unref();
}
