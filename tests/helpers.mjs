import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";

export const PASSWORD = "test-only-password-7!";
export const AT = Date.parse("2026-09-25T10:00:00+05:00");
export const input = (overrides = {}) => ({
  locationId: "loft",
  date: "2026-09-26",
  startTime: "10:00",
  duration: 2,
  name: "Тестовый клиент",
  phone: "+7 (777) 123-45-67",
  comment: "Тестовая съёмка",
  consent: true,
  ...overrides,
});

export async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "semka-api-test-"));
  let currentTime = AT;
  let app;
  let server;
  let base;
  const dbPath = join(dir, "db.sqlite");
  const start = async () => {
    if (app || server) throw new Error("Test fixture is already running");
    app = await createApp({
      adminPassword: PASSWORD,
      databaseUrl: null,
      production: false,
      allowedOrigin: null,
      dbPath,
      now: () => currentTime,
      staticDir: join(dir, "dist"),
      ...options,
    });
    server = createServer(app.handler);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    const runningServer = server;
    const runningApp = app;
    server = undefined;
    app = undefined;
    try {
      if (runningServer?.listening) {
        runningServer.closeIdleConnections();
        await new Promise((resolve, reject) =>
          runningServer.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      await runningApp?.close();
    }
  };
  t.after(async () => {
    try {
      await stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  await start();
  const api = async (
    path,
    { method = "GET", body, cookie, key, headers = {} } = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(!["GET", "HEAD"].includes(method) ? { Origin: base } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  };
  const book = (body = input(), key = randomUUID()) =>
    api("/api/bookings", { method: "POST", body, key });
  const login = async () => {
    const response = await api("/api/admin/login", {
      method: "POST",
      body: { password: PASSWORD },
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  return {
    api,
    book,
    login,
    dir,
    dbPath,
    get base() {
      return base;
    },
    get app() {
      return app;
    },
    setTime(value) {
      currentTime = typeof value === "number" ? value : Date.parse(value);
    },
    close: stop,
    open: start,
    async restart() {
      await stop();
      await start();
    },
  };
}
