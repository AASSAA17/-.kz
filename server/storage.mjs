import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function schemaSql(kind) {
  const serial =
    kind === "postgres"
      ? "BIGSERIAL PRIMARY KEY"
      : "INTEGER PRIMARY KEY AUTOINCREMENT";
  return `
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, public_token TEXT UNIQUE NOT NULL, location_id TEXT NOT NULL,
      date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', total_price INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled','expired')),
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', consent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS booking_slots ON bookings(location_id,date,status);
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
      booking_id TEXT NOT NULL REFERENCES bookings(id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration INTEGER NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS block_slots ON blocks(location_id,date);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (
      throttle_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','studio_owner','admin')),
      phone_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id,expires_at);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      throttle_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phone_verifications (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      sent_at BIGINT NOT NULL, sends_in_hour INTEGER NOT NULL DEFAULT 1, hour_started_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id ${serial}, user_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id ${serial}, entity_id TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `;
}

// SQL is application-owned. Only placeholders outside quoted literals change.
export function postgresPlaceholders(sql) {
  let output = "";
  let quote = null;
  let index = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === quote) {
        if (sql[i + 1] === quote) output += sql[++i];
        else quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else output += char === "?" ? `$${++index}` : char;
  }
  return output;
}

export function postgresConfig(databaseUrl, { production = false } = {}) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL должен быть PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.pathname.slice(1)
  ) {
    throw new Error(
      "DATABASE_URL должен содержать сервер, пользователя и имя PostgreSQL базы.",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    url.hostname,
  );
  const localPlaintext =
    !production && loopback && url.searchParams.get("sslmode") === "disable";
  // Parse explicitly: connection-string ssl parameters cannot override verified TLS.
  // This is sslmode=verify-full: trusted CA chain AND certificate host verification.
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: localPlaintext
      ? false
      : { rejectUnauthorized: true, servername: url.hostname },
    enableChannelBinding: true,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    application_name: "semka-mvp",
  };
}

export async function createStorage({
  dbPath,
  databaseUrl,
  databaseSchema = "public",
  production = false,
}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseSchema))
    throw new Error("Недопустимое имя PostgreSQL схемы.");
  if (!databaseUrl) {
    const { DatabaseSync } = await import("node:sqlite");
    if (dbPath !== ":memory:")
      mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    const raw = new DatabaseSync(dbPath);
    raw.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    raw.exec(schemaSql("sqlite"));
    try { raw.exec("ALTER TABLE bookings ADD COLUMN user_id TEXT REFERENCES users(id)"); } catch {}
    let tail = Promise.resolve();
    let closed = false;
    const context = new AsyncLocalStorage();
    function serialized(fn) {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    }
    const tx = {
      prepare(sql) {
        return {
          async get(...values) {
            return raw.prepare(sql).get(...values);
          },
          async all(...values) {
            return raw.prepare(sql).all(...values);
          },
          async run(...values) {
            return raw.prepare(sql).run(...values);
          },
        };
      },
    };
    const db = {
      kind: "sqlite",
      raw,
      prepare(sql) {
        return Object.fromEntries(
          ["get", "all", "run"].map((method) => [
            method,
            (...values) => {
              if (context.getStore()) return tx.prepare(sql)[method](...values);
              return serialized(() => tx.prepare(sql)[method](...values));
            },
          ]),
        );
      },
      async transaction(fn) {
        if (context.getStore())
          throw new Error("Nested transactions are not supported.");
        return serialized(async () => {
          raw.exec("BEGIN IMMEDIATE");
          try {
            const result = await context.run(tx, () => fn(tx));
            raw.exec("COMMIT");
            return result;
          } catch (error) {
            raw.exec("ROLLBACK");
            throw error;
          }
        });
      },
      async ping() {
        await db.prepare("SELECT 1 AS ready").get();
      },
      async close() {
        if (!closed) {
          closed = true;
          await serialized(() => raw.close());
        }
      },
    };
    return db;
  }

  const { Pool } = await import("pg");
  const pool = new Pool(postgresConfig(databaseUrl, { production }));
  // Never emit connection strings or database errors containing user input.
  pool.on("error", (error) =>
    console.error("PostgreSQL pool error:", error.code || "CONNECTION_ERROR"),
  );
  const context = new AsyncLocalStorage();
  let closed = false;
  function transactionClient(client) {
    return {
      prepare(sql) {
        const query = postgresPlaceholders(sql);
        return {
          async get(...values) {
            return (await client.query(query, values)).rows[0];
          },
          async all(...values) {
            return (await client.query(query, values)).rows;
          },
          async run(...values) {
            return { changes: (await client.query(query, values)).rowCount };
          },
        };
      },
    };
  }
  const db = {
    kind: "postgres",
    prepare(sql) {
      return Object.fromEntries(
        ["get", "all", "run"].map((method) => [
          method,
          (...values) => {
            const active = context.getStore();
            if (active) return active.prepare(sql)[method](...values);
            return db.transaction((tx) => tx.prepare(sql)[method](...values));
          },
        ]),
      );
    },
    async transaction(fn, locks = []) {
      if (context.getStore())
        throw new Error("Nested transactions are not supported.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL search_path TO "${databaseSchema}", pg_catalog`,
        );
        await client.query("SET LOCAL lock_timeout='10s'");
        await client.query("SET LOCAL statement_timeout='15s'");
        // Every process uses the same order. Idempotency sorts before inventory.
        for (const key of [...new Set(locks)].sort()) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`semka:${databaseSchema}:${key}`],
          );
        }
        const tx = transactionClient(client);
        const result = await context.run(tx, () => fn(tx));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async ping() {
      await db.prepare("SELECT 1 AS ready").get();
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
  try {
    // One schema migration at a time, including when multiple instances boot.
    await db.transaction(async () => {
      const active = context.getStore();
      await active.prepare(schemaSql("postgres")).run();
      await active.prepare("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id)").run();
    }, ["schema-migration"]);
  } catch (error) {
    await db.close();
    throw new Error(
      "Не удалось подготовить PostgreSQL. Проверьте DATABASE_URL, доступ к базе и права схемы.",
      { cause: error },
    );
  }
  return db;
}
