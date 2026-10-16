import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AT, fixture, input } from "./helpers.mjs";
import { postgresConfig } from "../server/storage.mjs";

// Opt-in only: use a disposable PostgreSQL database/Neon branch, never production.
// No DATABASE_URL fallback. Every write and cleanup is confined to a new schema.
const databaseUrl = process.env.TEST_DATABASE_URL;

function databaseIdentity(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Test database URL is invalid (connection details omitted)"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol),
    "TEST_DATABASE_URL must be a PostgreSQL URL");
  assert.ok(url.pathname.length > 1, "A test database name is required");
  // Neon direct and pooled endpoints can address the same database.
  return `${url.hostname.replace(/-pooler\./, ".")}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`;
}

test("PostgreSQL: independent instances share durable, race-safe inventory", {
  skip: databaseUrl ? false : "Set TEST_DATABASE_URL to a disposable test database to run PostgreSQL integration tests",
  timeout: 120000,
}, async (t) => {
  const testIdentity = databaseIdentity(databaseUrl);
  if (process.env.DATABASE_URL) {
    assert.notEqual(testIdentity, databaseIdentity(process.env.DATABASE_URL),
      "Refusing to test the configured application database; use a separate test database or Neon branch");
  }

  const { Pool } = await import("pg");
  const schema = `semka_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^semka_test_[a-f0-9]{32}$/);
  const control = new Pool({ ...postgresConfig(databaseUrl), max: 1,
    connectionTimeoutMillis: 15000, statement_timeout: 20000 });
  const apps = [];
  let created = false;
  t.after(async () => {
    // Close all app pools before dropping only the identifier generated above.
    const closed = await Promise.allSettled(apps.map((app) => app.close()));
    try {
      if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await control.end();
    }
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  });

  await control.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const options = { databaseUrl, databaseSchema: schema };
  const a = await fixture(t, options);
  apps.push(a);
  const b = await fixture(t, options);
  apps.push(b);
  assert.notEqual(a.app.db, b.app.db, "The race must use separate database adapters/pools");
  for (const app of [a, b]) {
    const result = await app.app.db.prepare("SELECT current_schema() AS schema").get();
    assert.equal(result.schema, schema, "Application queries must use only the isolated test schema");
  }

  await t.test("concurrent overlapping bookings admit one; adjacent slots and other locations remain free", async () => {
    const body = input({ date: "2026-09-27" });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      [a, b][i % 2].book(body)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.data.code === "SLOT_UNAVAILABLE").length, 7);
    assert.equal((await b.book({ ...body, startTime: "09:00", duration: 1 })).status, 201);
    assert.equal((await a.book({ ...body, startTime: "12:00", duration: 1 })).status, 201);
    assert.equal((await b.book({ ...body, locationId: "garden" })).status, 201);
    const partial = await Promise.all([
      a.book(input({ date: "2026-10-06", startTime: "10:00", duration: 2 })),
      b.book(input({ date: "2026-10-06", startTime: "11:00", duration: 2 })),
    ]);
    assert.deepEqual(partial.map((r) => r.status).sort(), [201, 409],
      "Different start times still contend when their intervals overlap");
  });

  await t.test("simultaneous retries return one booking without duplicate rows", async () => {
    const key = randomUUID();
    const body = input({ date: "2026-09-28", comment: "PG simultaneous identical retries" });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      [a, b][i % 2].book(body, key)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200).length, 7);
    assert.equal(new Set(results.map((r) => r.data.booking.id)).size, 1);
    for (const result of results.filter((r) => r.status === 200))
      assert.equal(result.headers.get("idempotency-replayed"), "true");
    const row = await a.app.db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE comment=?").get(body.comment);
    assert.equal(Number(row.count), 1);
  });

  await t.test("one idempotency key cannot concurrently create different non-overlapping bookings", async () => {
    const key = randomUUID();
    const marker = "PG simultaneous changed payload";
    const results = await Promise.all([
      a.book(input({ date: "2026-09-29", startTime: "10:00", comment: marker }), key),
      b.book(input({ date: "2026-09-30", startTime: "15:00", locationId: "garden", comment: marker }), key),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(results.find((r) => r.status === 409).data.code, "IDEMPOTENCY_CONFLICT");
    const row = await a.app.db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE comment=?").get(marker);
    assert.equal(Number(row.count), 1, "The losing request must not leave an orphan booking");
  });

  await t.test("booking/block races and block/block races cannot reserve the same interval", async () => {
    const cookieA = await a.login();
    const cookieB = await b.login();
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      const body = { locationId: "loft", date, startTime: "10:00", duration: 2, reason: "PG maintenance race" };
      const results = await Promise.all([
        a.book(input({ date })),
        b.api("/api/admin/blocks", { method: "POST", body, cookie: cookieB }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const availability = await b.api(`/api/locations/loft/availability?date=${date}&duration=1`);
      assert.equal(availability.data.slots.find((s) => s.time === "10:00").available, false);
      assert.equal(availability.data.slots.find((s) => s.time === "12:00").available, true);
    }
    const body = { locationId: "loft", date: "2026-10-04", startTime: "10:00", duration: 2, reason: "PG two admin blocks" };
    const results = await Promise.all([
      a.api("/api/admin/blocks", { method: "POST", body, cookie: cookieA }),
      b.api("/api/admin/blocks", { method: "POST", body, cookie: cookieB }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const row = await a.app.db.prepare("SELECT COUNT(*) AS count FROM blocks WHERE date=?").get(body.date);
    assert.equal(Number(row.count), 1);
  });

  await t.test("all pools can close and reopen without losing booking, idempotency or admin session", async () => {
    const key = randomUUID();
    const body = input({ date: "2026-10-05" });
    const booked = await a.book(body, key);
    assert.equal(booked.status, 201);
    const cookie = await a.login();
    const confirmed = await b.api(`/api/admin/bookings/${booked.data.booking.id}`, {
      method: "PATCH", body: { status: "confirmed" }, cookie,
    });
    assert.equal(confirmed.status, 200, "A session created by one instance must work on the other");
    await Promise.all([a.close(), b.close()]);
    await a.open();
    const receipt = await a.api(`/api/bookings/${booked.data.booking.publicToken}`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.booking.id, booked.data.booking.id);
    assert.equal(receipt.data.booking.status, "confirmed");
    assert.ok(!("phone" in receipt.data.booking));
    const replay = await a.book(body, key);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");
    assert.equal(replay.data.booking.id, booked.data.booking.id);
    assert.equal((await a.api("/api/admin/session", { cookie })).data.authenticated, true);
    const cancelled = await a.api(`/api/admin/bookings/${booked.data.booking.id}`, {
      method: "PATCH", body: { status: "cancelled", reason: "PG reopen cleanup scenario" }, cookie,
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await a.book(body)).status, 201, "Cancellation must release persisted inventory");
  });

  await t.test("concurrent hold expiration releases inventory and writes one audit event", async () => {
    if (!b.app) await b.open();
    const body = input({ date: "2026-10-07" });
    const held = await a.book(body);
    assert.equal(held.status, 201);
    a.setTime(AT + 2 * 3600000);
    b.setTime(AT + 2 * 3600000);
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      [a, b][i % 2].api(`/api/bookings/${held.data.booking.publicToken}`)));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.data.booking.status, "expired");
    }
    const audit = await a.app.db.prepare("SELECT COUNT(*) AS count FROM audit WHERE entity_id=? AND action='expired'").get(held.data.booking.id);
    assert.equal(Number(audit.count), 1, "An expired hold must be audited only once across instances");
    assert.equal((await b.book(body)).status, 201);
  });
});
