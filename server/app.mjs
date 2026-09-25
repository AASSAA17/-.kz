import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { locations } from "./locations.mjs";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const OFFSET = 5 * HOUR;
const SESSION_TTL = 8 * HOUR;
const HOLD_TTL = 2 * HOUR;
const LIMIT_WINDOW = 15 * 60000;
const MAX_BODY = 16 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const astanaDate = (time) => new Date(time + OFFSET).toISOString().slice(0, 10);
const iso = (time) => new Date(time).toISOString();
const startMillis = (date, time) => Date.parse(`${date}T${time}:00+05:00`);

// Holds count only the studio's working hours, including across midnight.
export function addBusinessHours(time, hours = 2) {
  let cursor = time;
  let remaining = hours * HOUR;
  while (remaining > 0) {
    const date = astanaDate(cursor);
    const open = startMillis(date, "09:00");
    const close = startMillis(date, "21:00");
    if (cursor < open) cursor = open;
    if (cursor >= close) {
      cursor = startMillis(astanaDate(open + DAY), "09:00");
      continue;
    }
    const take = Math.min(remaining, close - cursor);
    cursor += take;
    remaining -= take;
  }
  return cursor;
}

async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
    fail(415, "Отправьте данные в формате JSON.", "CONTENT_TYPE");
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY)
    fail(413, "Слишком большой запрос.", "BODY_TOO_LARGE");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) fail(413, "Слишком большой запрос.", "BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    fail(400, "Не удалось прочитать JSON.", "INVALID_JSON");
  }
}

function textField(value, name, { min = 0, max = 500 } = {}) {
  if (typeof value !== "string")
    fail(400, `Проверьте поле «${name}».`, "VALIDATION");
  const text = value.trim();
  if (
    text.length < min ||
    text.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
  )
    fail(
      400,
      `Проверьте поле «${name}»: от ${min} до ${max} символов.`,
      "VALIDATION",
    );
  return text;
}

function validateDate(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(400, "Укажите дату в формате ГГГГ-ММ-ДД.", "INVALID_DATE");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    fail(400, "Такой даты не существует.", "INVALID_DATE");
  if (value < astanaDate(now))
    fail(400, "Нельзя забронировать прошедшую дату.", "PAST_DATE");
  if (value > astanaDate(now + 90 * DAY))
    fail(
      400,
      "Бронирование доступно не более чем на 90 дней вперёд.",
      "DATE_TOO_FAR",
    );
  return value;
}

function durationValue(value) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 8
  )
    fail(
      400,
      "Длительность съёмки — от 1 до 8 целых часов.",
      "INVALID_DURATION",
    );
  return value;
}

function interval(body, now) {
  const date = validateDate(body.date, now);
  const duration = durationValue(body.duration);
  if (
    typeof body.startTime !== "string" ||
    !/^(09|1\d|20):00$/.test(body.startTime)
  )
    fail(
      400,
      "Выберите время начала с 09:00 до 20:00 с шагом в час.",
      "INVALID_TIME",
    );
  const startHour = Number(body.startTime.slice(0, 2));
  if (startHour + duration > 21)
    fail(400, "Съёмка должна закончиться до 21:00.", "AFTER_CLOSING");
  if (startMillis(date, body.startTime) <= now)
    fail(400, "Это время уже прошло. Выберите другой слот.", "PAST_TIME");
  return {
    date,
    duration,
    startTime: body.startTime,
    endTime: `${String(startHour + duration).padStart(2, "0")}:00`,
  };
}

function publicBooking(row) {
  return {
    id: row.id,
    publicToken: row.public_token,
    locationId: row.location_id,
    locationName:
      locations.find((l) => l.id === row.location_id)?.name || row.location_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    totalPrice: row.total_price,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
function adminBooking(row) {
  return {
    ...publicBooking(row),
    name: row.name,
    phone: row.phone,
    comment: row.comment,
    reason: row.reason || "",
    updatedAt: row.updated_at,
  };
}
function blockDto(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: locations.find((l) => l.id === row.location_id)?.name,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function createApp({
  dbPath = resolve(ROOT, "data/semka.sqlite"),
  adminPassword,
  now = Date.now,
  staticDir = resolve(ROOT, "dist"),
  allowedOrigin = process.env.ALLOWED_ORIGIN,
} = {}) {
  if (
    typeof adminPassword !== "string" ||
    adminPassword.length < 12 ||
    adminPassword.length > 256
  )
    throw new Error(
      "ADMIN_PASSWORD должен содержать от 12 до 256 символов. Выполните npm run setup.",
    );
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, public_token TEXT UNIQUE NOT NULL, location_id TEXT NOT NULL,
      date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', total_price INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected','cancelled','expired')),
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      consent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS booking_slots ON bookings(location_id, date, status);
    CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, booking_id TEXT NOT NULL REFERENCES bookings(id));
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL,
      end_time TEXT NOT NULL, duration INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS block_slots ON blocks(location_id, date);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const passwordSalt = randomBytes(16);
  const passwordHash = scryptSync(adminPassword, passwordSalt, 64);
  const attempts = new Map();
  let closed = false;

  const audit = (id, action, detail, at = now()) =>
    db
      .prepare(
        "INSERT INTO audit(entity_id,action,detail,created_at) VALUES(?,?,?,?)",
      )
      .run(id, action, detail, iso(at));
  function expire(at = now()) {
    const stale = db
      .prepare(
        "SELECT id FROM bookings WHERE status='pending' AND expires_at<=?",
      )
      .all(iso(at));
    const update = db.prepare(
      "UPDATE bookings SET status='expired', updated_at=?, reason='Истёк срок подтверждения' WHERE id=? AND status='pending'",
    );
    for (const row of stale) {
      update.run(iso(at), row.id);
      audit(row.id, "expired", "Истёк срок подтверждения", at);
    }
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(at);
  }
  function location(value) {
    const result = locations.find((l) => l.id === value || l.slug === value);
    if (!result) fail(404, "Локация не найдена.", "LOCATION_NOT_FOUND");
    return result;
  }
  function conflict(locationId, date, start, end) {
    const booking = db
      .prepare(
        "SELECT id FROM bookings WHERE location_id=? AND date=? AND status IN ('pending','confirmed') AND start_time<? AND end_time>? LIMIT 1",
      )
      .get(locationId, date, end, start);
    const block = db
      .prepare(
        "SELECT id FROM blocks WHERE location_id=? AND date=? AND start_time<? AND end_time>? LIMIT 1",
      )
      .get(locationId, date, end, start);
    return Boolean(booking || block);
  }
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function session(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("semka_session="));
    const token = cookie?.slice("semka_session=".length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db
      .prepare(
        "SELECT token_hash,expires_at FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(digest(token), now());
    return row || null;
  }
  function requireAdmin(req) {
    const result = session(req);
    if (!result) fail(401, "Войдите как администратор.", "UNAUTHORIZED");
    return result;
  }
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (req.headers["sec-fetch-site"] === "cross-site")
      fail(403, "Запрос с другого сайта запрещён.", "ORIGIN_FORBIDDEN");
    if (!origin)
      fail(
        403,
        "Для изменения данных требуется заголовок Origin.",
        "ORIGIN_REQUIRED",
      );
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail(403, "Источник запроса недопустим.", "ORIGIN_FORBIDDEN");
    }
    const requestProtocol = req.socket.encrypted ? "https:" : "http:";
    if (
      parsed.origin !== `${requestProtocol}//${req.headers.host}` &&
      parsed.origin !== allowedOrigin
    )
      fail(403, "Запрос с другого сайта запрещён.", "ORIGIN_FORBIDDEN");
  }
  function setCookie(res, token, req, maxAge = SESSION_TTL / 1000) {
    const secure =
      req.socket.encrypted || (allowedOrigin || "").startsWith("https://");
    res.setHeader(
      "Set-Cookie",
      `semka_session=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
    );
  }
  function send(res, status, data) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
  }

  async function api(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (!["GET", "HEAD"].includes(method)) checkOrigin(req);
    expire();
    if (method === "GET" && path === "/api/health")
      return send(res, 200, { ok: true, timezone: "Asia/Almaty", demo: true });
    if (method === "GET" && path === "/api/locations")
      return send(res, 200, { locations });
    const availability = path.match(
      /^\/api\/locations\/([^/]+)\/availability$/,
    );
    if (method === "GET" && availability) {
      const loc = location(availability[1]);
      const at = now();
      const date = validateDate(url.searchParams.get("date"), at);
      const rawDuration = url.searchParams.get("duration") || "1";
      if (!/^[1-8]$/.test(rawDuration))
        fail(
          400,
          "Длительность съёмки — от 1 до 8 целых часов.",
          "INVALID_DURATION",
        );
      const duration = durationValue(Number(rawDuration));
      const slots = [];
      for (let hour = 9; hour + duration <= 21; hour++) {
        const time = `${String(hour).padStart(2, "0")}:00`;
        const end = `${String(hour + duration).padStart(2, "0")}:00`;
        slots.push({
          time,
          available:
            startMillis(date, time) > at && !conflict(loc.id, date, time, end),
        });
      }
      return send(res, 200, { date, slots, closingTime: "21:00" });
    }
    if (method === "POST" && path === "/api/bookings") {
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !UUID.test(key))
        fail(
          400,
          "Передайте уникальный Idempotency-Key в формате UUID.",
          "IDEMPOTENCY_REQUIRED",
        );
      const body = await jsonBody(req);
      const loc = location(body.locationId);
      const name = textField(body.name, "Имя", { min: 2, max: 80 });
      const phoneInput = textField(body.phone, "Телефон", { min: 10, max: 25 });
      if (!/^\+?[\d\s()-]+$/.test(phoneInput))
        fail(
          400,
          "Укажите телефон Казахстана в формате +7 XXX XXX XX XX.",
          "INVALID_PHONE",
        );
      const digits = phoneInput.replace(/\D/g, "");
      if (!/^[78]\d{10}$/.test(digits))
        fail(
          400,
          "Укажите телефон Казахстана в формате +7 XXX XXX XX XX.",
          "INVALID_PHONE",
        );
      const phone = `+7${digits.slice(1)}`;
      const comment = textField(body.comment ?? "", "Комментарий", {
        max: 1000,
      });
      if (body.consent !== true)
        fail(
          400,
          "Подтвердите согласие на обработку данных заявки.",
          "CONSENT_REQUIRED",
        );
      // Hash stable normalized user intent; retries remain safe after the slot starts or hold expires.
      const payload = {
        locationId: loc.id,
        date: body.date,
        startTime: body.startTime,
        duration: body.duration,
        name,
        phone,
        comment,
        consent: true,
      };
      const payloadHash = digest(JSON.stringify(payload));
      const result = transaction(() => {
        const previous = db
          .prepare("SELECT * FROM idempotency WHERE key=?")
          .get(key);
        if (previous) {
          if (previous.payload_hash !== payloadHash)
            fail(
              409,
              "Этот ключ уже использован для другой заявки.",
              "IDEMPOTENCY_CONFLICT",
            );
          return {
            replay: true,
            booking: db
              .prepare("SELECT * FROM bookings WHERE id=?")
              .get(previous.booking_id),
          };
        }
        const at = now();
        expire(at);
        const slot = interval(body, at);
        if (conflict(loc.id, slot.date, slot.startTime, slot.endTime))
          fail(
            409,
            "Этот интервал уже занят. Выберите другое время.",
            "SLOT_UNAVAILABLE",
          );
        const id = randomUUID();
        const token = randomBytes(24).toString("hex");
        const expires = iso(addBusinessHours(at, HOLD_TTL / HOUR));
        db.prepare(
          `INSERT INTO bookings(id,public_token,location_id,date,start_time,end_time,duration,name,phone,comment,total_price,status,expires_at,created_at,updated_at,consent_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
        ).run(
          id,
          token,
          loc.id,
          slot.date,
          slot.startTime,
          slot.endTime,
          slot.duration,
          name,
          phone,
          comment,
          loc.price * slot.duration,
          expires,
          iso(at),
          iso(at),
          iso(at),
        );
        db.prepare(
          "INSERT INTO idempotency(key,payload_hash,booking_id) VALUES(?,?,?)",
        ).run(key, payloadHash, id);
        audit(id, "created", "Создана заявка; согласие получено", at);
        return {
          replay: false,
          booking: db.prepare("SELECT * FROM bookings WHERE id=?").get(id),
        };
      });
      if (result.replay) res.setHeader("Idempotency-Replayed", "true");
      return send(res, result.replay ? 200 : 201, {
        booking: publicBooking(result.booking),
      });
    }
    const publicRead = path.match(/^\/api\/bookings\/([a-f0-9]{48})$/);
    if (method === "GET" && publicRead) {
      const booking = db
        .prepare("SELECT * FROM bookings WHERE public_token=?")
        .get(publicRead[1]);
      if (!booking)
        fail(404, "Заявка не найдена. Проверьте ссылку.", "BOOKING_NOT_FOUND");
      return send(res, 200, { booking: publicBooking(booking) });
    }
    if (method === "GET" && path === "/api/admin/session")
      return send(res, 200, { authenticated: Boolean(session(req)) });
    if (method === "POST" && path === "/api/admin/login") {
      const ip = req.socket.remoteAddress || "unknown";
      const at = now();
      for (const [address, value] of attempts)
        if (value.resetAt <= at) attempts.delete(address);
      const attempt = attempts.get(ip) || {
        count: 0,
        resetAt: at + LIMIT_WINDOW,
      };
      if (attempt.count >= 5) {
        res.setHeader("Retry-After", Math.ceil((attempt.resetAt - at) / 1000));
        fail(
          429,
          "Слишком много попыток. Повторите через 15 минут.",
          "RATE_LIMITED",
        );
      }
      const body = await jsonBody(req);
      const password =
        typeof body.password === "string" && body.password.length <= 256
          ? body.password
          : "";
      const check = scryptSync(password, passwordSalt, 64);
      if (!timingSafeEqual(check, passwordHash)) {
        attempt.count++;
        attempts.set(ip, attempt);
        fail(401, "Неверный пароль.", "INVALID_CREDENTIALS");
      }
      attempts.delete(ip);
      const existing = session(req);
      if (existing)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          existing.token_hash,
        );
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)").run(
        digest(token),
        at + SESSION_TTL,
      );
      setCookie(res, token, req);
      return send(res, 200, { authenticated: true });
    }
    if (path.startsWith("/api/admin/")) {
      const currentSession = requireAdmin(req);
      if (method === "POST" && path === "/api/admin/logout") {
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          currentSession.token_hash,
        );
        setCookie(res, "", req, 0);
        return send(res, 200, { authenticated: false });
      }
      if (method === "GET" && path === "/api/admin/bookings") {
        const status = url.searchParams.get("status") || "";
        const date = url.searchParams.get("date") || "";
        const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
        if (
          status &&
          ![
            "pending",
            "confirmed",
            "cancelled",
            "rejected",
            "expired",
            "all",
          ].includes(status)
        )
          fail(400, "Неизвестный статус.", "INVALID_STATUS");
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
          fail(400, "Некорректный фильтр даты.", "INVALID_DATE");
        const values = [];
        const where = [];
        if (status && status !== "all") {
          where.push("status=?");
          values.push(status);
        }
        if (date) {
          where.push("date=?");
          values.push(date);
        }
        // Case folding in JS handles Cyrillic as well as Latin names.
        let rows = db
          .prepare(
            `SELECT * FROM bookings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC`,
          )
          .all(...values);
        if (q)
          rows = rows.filter((r) =>
            `${r.name} ${r.phone} ${r.id}`
              .toLocaleLowerCase("ru")
              .includes(q.toLocaleLowerCase("ru")),
          );
        return send(res, 200, { bookings: rows.map(adminBooking) });
      }
      const adminPatch = path.match(
        /^\/api\/admin\/bookings\/([a-f0-9-]{36})$/,
      );
      if (method === "PATCH" && adminPatch) {
        const body = await jsonBody(req);
        if (!["confirmed", "rejected", "cancelled"].includes(body.status))
          fail(400, "Неизвестный статус заявки.", "INVALID_STATUS");
        const reason = textField(body.reason ?? "", "Причина", { max: 500 });
        if (["rejected", "cancelled"].includes(body.status) && !reason)
          fail(400, "Укажите причину отказа или отмены.", "REASON_REQUIRED");
        const booking = transaction(() => {
          expire();
          const row = db
            .prepare("SELECT * FROM bookings WHERE id=?")
            .get(adminPatch[1]);
          if (!row) fail(404, "Заявка не найдена.", "BOOKING_NOT_FOUND");
          const transitions = {
            pending: ["confirmed", "rejected", "cancelled"],
            confirmed: ["cancelled"],
          };
          if (!transitions[row.status]?.includes(body.status))
            fail(
              409,
              "Статус изменился или этот переход недоступен. Обновите список.",
              "INVALID_TRANSITION",
            );
          if (
            body.status === "confirmed" &&
            startMillis(row.date, row.start_time) <= now()
          )
            fail(409, "Нельзя подтвердить прошедшую съёмку.", "PAST_TIME");
          db.prepare(
            "UPDATE bookings SET status=?,reason=?,updated_at=? WHERE id=?",
          ).run(body.status, reason, iso(now()), row.id);
          audit(row.id, `${row.status}→${body.status}`, reason);
          return db.prepare("SELECT * FROM bookings WHERE id=?").get(row.id);
        });
        return send(res, 200, { booking: adminBooking(booking) });
      }
      if (method === "GET" && path === "/api/admin/blocks")
        return send(res, 200, {
          blocks: db
            .prepare("SELECT * FROM blocks ORDER BY date,start_time")
            .all()
            .map(blockDto),
        });
      if (method === "POST" && path === "/api/admin/blocks") {
        const body = await jsonBody(req);
        const loc = location(body.locationId);
        const reason = textField(body.reason, "Причина блокировки", {
          min: 3,
          max: 500,
        });
        const block = transaction(() => {
          const at = now();
          expire(at);
          const slot = interval(body, at);
          if (conflict(loc.id, slot.date, slot.startTime, slot.endTime))
            fail(
              409,
              "В этом интервале уже есть заявка или блокировка.",
              "SLOT_UNAVAILABLE",
            );
          const id = randomUUID();
          db.prepare(
            "INSERT INTO blocks(id,location_id,date,start_time,end_time,duration,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            id,
            loc.id,
            slot.date,
            slot.startTime,
            slot.endTime,
            slot.duration,
            reason,
            iso(at),
          );
          audit(id, "blocked", reason, at);
          return db.prepare("SELECT * FROM blocks WHERE id=?").get(id);
        });
        return send(res, 201, { block: blockDto(block) });
      }
      const blockDelete = path.match(/^\/api\/admin\/blocks\/([a-f0-9-]{36})$/);
      if (method === "DELETE" && blockDelete) {
        const block = db
          .prepare("SELECT * FROM blocks WHERE id=?")
          .get(blockDelete[1]);
        if (!block) fail(404, "Блокировка не найдена.", "BLOCK_NOT_FOUND");
        transaction(() => {
          db.prepare("DELETE FROM blocks WHERE id=?").run(block.id);
          audit(block.id, "unblocked", block.reason);
        });
        return send(res, 200, { ok: true });
      }
      if (method === "GET" && path === "/api/admin/audit") {
        const events = db
          .prepare(
            "SELECT entity_id AS entityId,action,detail,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 200",
          )
          .all();
        return send(res, 200, { events });
      }
    }
    fail(404, "Маршрут API не найден.", "NOT_FOUND");
  }

  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".json": "application/json; charset=utf-8",
  };
  async function handler(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (!["GET", "HEAD"].includes(req.method))
        fail(405, "Метод не поддерживается.", "METHOD_NOT_ALLOWED");
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        fail(400, "Некорректный адрес.", "INVALID_PATH");
      }
      if (
        decoded.includes("\0") ||
        decoded.split(/[\\/]/).some((part) => part.startsWith("."))
      )
        fail(404, "Страница не найдена.", "NOT_FOUND");
      const root = resolve(staticDir);
      let file = resolve(root, `.${decoded}`);
      if (file !== root && !file.startsWith(root + sep))
        fail(404, "Страница не найдена.", "NOT_FOUND");
      let info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        if (extname(decoded)) fail(404, "Файл не найден.", "NOT_FOUND");
        file = resolve(root, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile())
        return send(res, 503, {
          error:
            "Фронтенд ещё не собран. Выполните npm run build или запустите npm run dev.",
          code: "FRONTEND_NOT_BUILT",
        });
      res.statusCode = 200;
      res.setHeader(
        "Content-Type",
        mime[extname(file).toLowerCase()] || "application/octet-stream",
      );
      res.setHeader(
        "Cache-Control",
        extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      );
      if (req.method === "HEAD") return res.end();
      res.end(await readFile(file));
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!(error instanceof HttpError))
        console.error("API error:", error.name, error.message);
      send(res, error.status || 500, {
        error:
          error instanceof HttpError
            ? error.message
            : "Внутренняя ошибка сервера. Повторите запрос позже.",
        code:
          error.code && error instanceof HttpError
            ? error.code
            : "INTERNAL_ERROR",
      });
    }
  }
  return {
    handler,
    db,
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}
