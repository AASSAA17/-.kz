// Run with the API stopped and DATABASE_URL targeting a new, empty database.
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { createStorage } from '../server/storage.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const source = new DatabaseSync(resolve(process.env.DB_PATH || 'data/semka.sqlite'), { readOnly: true });
const snapshot = resolve(`data/semka-before-postgres-${Date.now()}.sqlite`);
await backup(source, snapshot);
const target = await createStorage({ databaseUrl: process.env.DATABASE_URL });
const tables = ['users', 'bookings', 'idempotency', 'blocks', 'sessions', 'login_attempts',
  'user_sessions', 'auth_rate_limits', 'phone_verifications', 'audit_events', 'audit'];
try {
  await target.transaction(async tx => {
    for (const table of tables) {
      const count = await tx.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      if (Number(count.count)) throw new Error('Target is not empty; migration cancelled');
    }
    for (const table of tables) {
      const exists = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      const rows = exists ? source.prepare(`SELECT * FROM "${table}"`).all() : [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const sql = `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
        await tx.prepare(sql).run(...columns.map(c => row[c]));
      }
      const count = await tx.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      if (Number(count.count) !== rows.length) throw new Error('Migration count mismatch');
      console.log(`${table}: ${rows.length} verified`);
    }
    for (const table of ['audit', 'audit_events']) {
      await tx.prepare(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id),1), COUNT(*)>0) FROM "${table}"`).get();
    }
  }, ['sqlite-migration']);
  console.log('Migration committed. SQLite snapshot: ' + snapshot);
} finally { source.close(); await target.close(); }
