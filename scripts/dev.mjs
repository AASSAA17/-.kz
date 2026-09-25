import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Для проекта нужен Node.js 24 или новее. Текущая версия:', process.version);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitePath = resolve(root, 'node_modules/vite/bin/vite.js');
try {
  await access(vitePath);
  await access(resolve(root, '.env'));
} catch {
  console.error('Сначала выполните npm install, затем npm run setup.');
  process.exit(1);
}

const children = new Set();
let stopping = false;

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, 5_000);
    child.once('close', finish);

    if (process.platform === 'win32') {
      // Stop this child and its own helper processes, including esbuild.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      killer.once('error', () => child.kill());
      killer.once('close', (code) => { if (code !== 0) child.kill(); });
    } else {
      child.kill('SIGTERM');
    }
  });
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(stopChild));
  process.exitCode = code;
}

function launch(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    shell: false,
    env: process.env,
  });
  children.add(child);
  child.once('error', (error) => {
    console.error(`Не удалось запустить ${name}: ${error.message}`);
    void stop(1);
  });
  child.once('close', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.log(`${name} остановлен${signal ? ` (${signal})` : ''}.`);
    void stop(code ?? 1);
  });
}

process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));
process.on('SIGHUP', () => void stop(129));
if (process.platform === 'win32') process.on('SIGBREAK', () => void stop(131));

console.log('Запуск API и интерфейса. Для остановки нажмите Ctrl+C.');
launch('API', ['--env-file-if-exists=.env', resolve(root, 'server/index.mjs')]);
launch('Vite', [vitePath, '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
