import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp, addBusinessHours } from "../server/app.mjs";

const PASSWORD = "test-only-password-7!";
const AT = Date.parse("2026-09-25T10:00:00+05:00");
const input = (overrides = {}) => ({
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

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "semka-api-test-"));
  let currentTime = AT;
  let app;
  let server;
  let base;
  const dbPath = join(dir, "db.sqlite");
  const start = async () => {
    app = createApp({
      adminPassword: PASSWORD,
      dbPath,
      now: () => currentTime,
      staticDir: join(dir, "dist"),
      ...options,
    });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
    app.close();
  };
  await start();
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
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
    async restart() {
      await stop();
      await start();
    },
  };
}

test("catalogue and booking survive a database reopen; public receipt hides customer details", async (t) => {
  const f = await fixture(t);
  const catalog = await f.api("/api/locations");
  assert.equal(catalog.data.locations.length, 5);
  assert.equal(catalog.data.locations[0].id, "loft");
  const result = await f.book();
  assert.equal(result.status, 201);
  assert.equal(result.data.booking.totalPrice, 30000);
  assert.equal(result.data.booking.status, "pending");
  assert.equal(result.data.booking.endTime, "12:00");
  assert.equal(result.data.booking.expiresAt, "2026-09-25T07:00:00.000Z");
  assert.ok(!("phone" in result.data.booking));
  assert.ok(!("name" in result.data.booking));
  await f.restart();
  const read = await f.api(`/api/bookings/${result.data.booking.publicToken}`);
  assert.deepEqual(read.data.booking, result.data.booking);
  assert.equal(
    (await f.api(`/api/bookings/${result.data.booking.id}`)).status,
    404,
  );
  assert.equal((await f.api("/api/bookings")).status, 404);
  const availability = await f.api(
    "/api/locations/loft/availability?date=2026-09-26&duration=1",
  );
  assert.equal(
    availability.data.slots.find((s) => s.time === "10:00").available,
    false,
  );
  assert.equal(
    availability.data.slots.find((s) => s.time === "11:00").available,
    false,
  );
  assert.equal(
    availability.data.slots.find((s) => s.time === "12:00").available,
    true,
  );
});

test("simultaneous overlapping reservations accept exactly one; adjacent and other studios are available", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.book()));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(
    results.filter(
      (r) => r.status === 409 && r.data.code === "SLOT_UNAVAILABLE",
    ).length,
    7,
  );
  assert.equal(
    (await f.book(input({ startTime: "09:00", duration: 1 }))).status,
    201,
  );
  assert.equal(
    (await f.book(input({ startTime: "12:00", duration: 1 }))).status,
    201,
  );
  assert.equal(
    (await f.book(input({ startTime: "11:00", duration: 2 }))).status,
    409,
  );
  assert.equal((await f.book(input({ locationId: "garden" }))).status, 201);
});

test("idempotency prevents duplicates and rejects key reuse with a changed payload", async (t) => {
  const f = await fixture(t);
  const key = randomUUID();
  const first = await f.book(input(), key);
  const second = await f.book(input(), key);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("idempotency-replayed"), "true");
  assert.equal(first.data.booking.id, second.data.booking.id);
  const conflict = await f.book(input({ duration: 1 }), key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "IDEMPOTENCY_CONFLICT");
  const samePhone = await f.book(input({ phone: "87771234567" }), key);
  assert.equal(samePhone.status, 200);
  f.setTime("2026-09-27T09:00:00+05:00");
  assert.equal((await f.book(input(), key)).data.booking.status, "expired");
});

test("two business hour holds skip closed time and expired holds release inventory", async (t) => {
  assert.equal(
    new Date(
      addBusinessHours(Date.parse("2026-09-25T20:30:00+05:00")),
    ).toISOString(),
    "2026-09-26T05:30:00.000Z",
  );
  assert.equal(
    new Date(
      addBusinessHours(Date.parse("2026-09-25T23:00:00+05:00")),
    ).toISOString(),
    "2026-09-26T06:00:00.000Z",
  );
  assert.equal(
    new Date(
      addBusinessHours(Date.parse("2026-09-25T08:00:00+05:00")),
    ).toISOString(),
    "2026-09-25T06:00:00.000Z",
  );
  const f = await fixture(t);
  f.setTime("2026-09-25T20:30:00+05:00");
  const created = await f.book(input({ date: "2026-09-27" }));
  assert.equal(created.status, 201);
  f.setTime("2026-09-26T10:29:59+05:00");
  assert.equal((await f.book(input({ date: "2026-09-27" }))).status, 409);
  f.setTime("2026-09-26T10:30:00+05:00");
  assert.equal(
    (await f.api(`/api/bookings/${created.data.booking.publicToken}`)).data
      .booking.status,
    "expired",
  );
  assert.equal((await f.book(input({ date: "2026-09-27" }))).status, 201);
  const cookie = await f.login();
  const expiredPatch = await f.api(
    `/api/admin/bookings/${created.data.booking.id}`,
    { method: "PATCH", body: { status: "confirmed" }, cookie },
  );
  assert.equal(expiredPatch.status, 409);
});

test("admin authentication, secure session storage, TTL and logout are enforced", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.api("/api/admin/session")).data, {
    authenticated: false,
  });
  assert.equal((await f.api("/api/admin/bookings")).status, 401);
  assert.equal((await f.api("/api/admin/blocks")).status, 401);
  assert.equal((await f.api("/api/admin/audit")).status, 401);
  const login = await f.api("/api/admin/login", {
    method: "POST",
    body: { password: PASSWORD },
  });
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=28800/);
  const cookie = setCookie.split(";")[0];
  const raw = cookie.split("=")[1];
  const session = f.app.db.prepare("SELECT * FROM sessions").get();
  assert.notEqual(session.token_hash, raw);
  assert.equal(
    (await f.api("/api/admin/session", { cookie })).data.authenticated,
    true,
  );
  f.setTime(AT + 8 * 3600000);
  assert.equal((await f.api("/api/admin/bookings", { cookie })).status, 401);
  const newCookie = await f.login();
  assert.equal(
    (await f.api("/api/admin/logout", { method: "POST", cookie: newCookie }))
      .status,
    200,
  );
  assert.equal(
    (await f.api("/api/admin/bookings", { cookie: newCookie })).status,
    401,
  );
});

test("login throttles after five failures and resets after fifteen minutes", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.api("/api/admin/login", {
          method: "POST",
          body: { password: "wrong" },
        })
      ).status,
      401,
    );
  const blocked = await f.api("/api/admin/login", {
    method: "POST",
    body: { password: PASSWORD },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "900");
  f.setTime(AT + 15 * 60000);
  assert.equal(
    (
      await f.api("/api/admin/login", {
        method: "POST",
        body: { password: PASSWORD },
      })
    ).status,
    200,
  );
});

test("only valid booking transitions are allowed, cancellation releases slot and audit records changes", async (t) => {
  const f = await fixture(t);
  const created = await f.book();
  const id = created.data.booking.id;
  const cookie = await f.login();
  const patch = (body) =>
    f.api(`/api/admin/bookings/${id}`, { method: "PATCH", body, cookie });
  assert.equal(
    (
      await f.api(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        body: { status: "confirmed" },
      })
    ).status,
    401,
  );
  assert.equal((await patch({ status: "confirmed" })).status, 200);
  f.setTime(AT + 3 * 3600000);
  assert.equal(
    (await f.api(`/api/bookings/${created.data.booking.publicToken}`)).data
      .booking.status,
    "confirmed",
  );
  assert.equal(
    (await patch({ status: "rejected", reason: "Неверный переход" })).status,
    409,
  );
  assert.equal((await patch({ status: "cancelled" })).status, 400);
  assert.equal(
    (await patch({ status: "cancelled", reason: "По просьбе клиента" })).status,
    200,
  );
  assert.equal((await patch({ status: "confirmed" })).status, 409);
  const list = await f.api(
    "/api/admin/bookings?status=cancelled&q=%D0%BA%D0%BB%D0%B8%D0%B5%D0%BD%D1%82",
    { cookie },
  );
  assert.equal(list.data.bookings.length, 1);
  assert.equal(list.data.bookings[0].phone, "+77771234567");
  assert.equal((await f.book()).status, 201);
  const audit = await f.api("/api/admin/audit", { cookie });
  assert.ok(
    audit.data.events.some(
      (e) => e.entityId === id && e.action === "pending→confirmed",
    ),
  );
  assert.ok(
    audit.data.events.some(
      (e) => e.entityId === id && e.action === "confirmed→cancelled",
    ),
  );
});

test("blocks require admin, cannot overlap bookings, and removal restores availability", async (t) => {
  const f = await fixture(t);
  const body = {
    locationId: "loft",
    date: "2026-09-26",
    startTime: "10:00",
    duration: 2,
    reason: "Обслуживание зала",
  };
  assert.equal(
    (await f.api("/api/admin/blocks", { method: "POST", body })).status,
    401,
  );
  const cookie = await f.login();
  const block = await f.api("/api/admin/blocks", {
    method: "POST",
    body,
    cookie,
  });
  assert.equal(block.status, 201);
  assert.equal((await f.book()).status, 409);
  assert.equal(
    (
      await f.api("/api/admin/blocks", {
        method: "POST",
        body: { ...body, startTime: "11:00" },
        cookie,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.api("/api/locations/loft/availability?date=2026-09-26&duration=2")
    ).data.slots.find((s) => s.time === "09:00").available,
    false,
  );
  assert.equal(
    (await f.api("/api/admin/blocks", { cookie })).data.blocks.length,
    1,
  );
  assert.equal(
    (
      await f.api(`/api/admin/blocks/${block.data.block.id}`, {
        method: "DELETE",
        cookie,
      })
    ).status,
    200,
  );
  assert.equal((await f.book()).status, 201);
  assert.equal(
    (await f.api("/api/admin/blocks", { method: "POST", body, cookie })).status,
    409,
  );
});

test("validation rejects invalid dates, invalid intervals, missing consent and malformed inputs", async (t) => {
  const f = await fixture(t);
  const badCases = [
    [{ date: "2026-02-30" }, "INVALID_DATE"],
    [{ date: "2026-09-24" }, "PAST_DATE"],
    [{ date: "2027-01-01" }, "DATE_TOO_FAR"],
    [{ date: "2026-09-25", startTime: "10:00" }, "PAST_TIME"],
    [{ startTime: "10:30" }, "INVALID_TIME"],
    [{ startTime: "20:00", duration: 2 }, "AFTER_CLOSING"],
    [{ duration: 0 }, "INVALID_DURATION"],
    [{ duration: 9 }, "INVALID_DURATION"],
    [{ duration: "2" }, "INVALID_DURATION"],
    [{ consent: false }, "CONSENT_REQUIRED"],
    [{ phone: "+1 555 123 1234" }, "INVALID_PHONE"],
    [{ name: "A" }, "VALIDATION"],
    [{ comment: "x".repeat(1001) }, "VALIDATION"],
  ];
  for (const [changes, code] of badCases) {
    const result = await f.book(input(changes));
    assert.equal(result.status, 400, JSON.stringify(changes));
    assert.equal(result.data.code, code);
  }
  assert.equal((await f.book(input({ locationId: "unknown" }))).status, 404);
  assert.equal(
    (await f.api("/api/bookings", { method: "POST", body: input() })).data.code,
    "IDEMPOTENCY_REQUIRED",
  );
  assert.equal(
    (
      await f.api("/api/bookings", {
        method: "POST",
        body: "{ broken",
        key: randomUUID(),
      })
    ).data.code,
    "INVALID_JSON",
  );
  assert.equal(
    (
      await f.api("/api/bookings", {
        method: "POST",
        body: "x".repeat(17000),
        key: randomUUID(),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.api(
        "/api/locations/loft/availability?date=2026-09-26&duration=1.5",
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.api("/api/locations/loft/availability?date=2026-09-26&duration=0"))
      .status,
    400,
  );
});

test("cross origin mutations are denied even with a valid admin session; responses have security headers", async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const response = await f.api("/api/admin/logout", {
    method: "POST",
    cookie,
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await f.api("/api/admin/session", { cookie })).data.authenticated,
    true,
  );
  const missing = await fetch(f.base + "/api/admin/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(missing.status, 403);
  const health = await f.api("/api/health");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("referrer-policy"), "no-referrer");
  assert.equal(health.headers.get("cache-control"), "no-store");
});

test("static frontend routes work without exposing source files or dotfiles", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.dir, "dist"), { recursive: true });
  await writeFile(
    join(f.dir, "dist/index.html"),
    "<!doctype html><title>MVP</title>",
  );
  await writeFile(join(f.dir, "dist/.env"), "SECRET=bad");
  const route = await fetch(f.base + "/booking/receipt");
  assert.equal(route.status, 200);
  assert.match(await route.text(), /MVP/);
  assert.equal((await fetch(f.base + "/.env")).status, 404);
  assert.equal((await fetch(f.base + "/%2eenv")).status, 404);
  assert.equal((await fetch(f.base + "/missing.svg")).status, 404);
  assert.equal((await fetch(f.base + "/server/app.mjs")).status, 404);
});
