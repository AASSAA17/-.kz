import { randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Для проекта нужен Node.js 24 или новее. Текущая версия:', process.version);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const password = randomBytes(24).toString('base64url');
let handle;

try {
  // wx creates a new file and fails if one already exists.
  handle = await open(envPath, 'wx', 0o600);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const existing = await readFile(envPath, 'utf8');
  console.log('Файл .env уже существует. Его значения сохранены без изменений.');
  const existingLength = (parseEnv(existing).ADMIN_PASSWORD || '').length;
  if (existingLength < 12 || existingLength > 256) {
    console.error('Укажите ADMIN_PASSWORD длиной от 12 до 256 символов в существующем .env перед запуском сервера.');
    process.exitCode = 1;
  } else {
    console.log('Пароль администратора находится в .env, строка ADMIN_PASSWORD.');
  }
}

if (handle) {
  try {
    await handle.writeFile([
      '# Локальные настройки. Не добавляйте этот файл в Git.',
      'PORT=3001',
      `ADMIN_PASSWORD=${password}`,
      '',
    ].join('\n'), 'utf8');
  } finally {
    await handle.close();
  }
  console.log('Создан .env для локального запуска.');
  console.log(`Пароль администратора: ${password}`);
  console.log('Сохраните пароль. Он также доступен в .env, строка ADMIN_PASSWORD.');
  console.log('Далее: npm run dev → http://localhost:5173');
}
