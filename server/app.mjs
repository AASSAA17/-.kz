import { createStorage } from "./storage.mjs";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

export async function createApp({
  dbPath = resolve(ROOT, "data/semka.sqlite"),
  databaseUrl = process.env.DATABASE_URL,
  databaseSchema = "public",
  adminPassword,
  now = Date.now,
  staticDir = resolve(ROOT, "dist"),
  allowedOrigin = process.env.ALLOWED_ORIGIN,
  production = process.env.NODE_ENV === "production",
} = {}) {
  if (
    typeof adminPassword !== "string" ||
    adminPassword.length < 12 ||
    adminPassword.length > 256
  )
    throw new Error(
      "ADMIN_PASSWORD должен содержать от 12 до 256 символов. Выполните npm run setup.",
    );
  if (production && !databaseUrl)
    throw new Error(
      "В production требуется DATABASE_URL: локальный SQLite не подходит для эфемерного диска Render.",
    );
  if (allowedOrigin) {
    let parsed;
    try {
      parsed = new URL(allowedOrigin);
    } catch {
      throw new Error(
        "ALLOWED_ORIGIN должен быть точным origin сайта, например https://semka.onrender.com.",
      );
    }
    if (
      parsed.origin !== allowedOrigin ||
      !["http:", "https:"].includes(parsed.protocol)
    )
      throw new Error(
        "ALLOWED_ORIGIN должен содержать только схему и домен, без пути и завершающего слеша.",
      );
  }
  if (production && !allowedOrigin?.startsWith("https://"))
    throw new Error("В production требуется ALLOWED_ORIGIN с HTTPS.");
  const db = await createStorage({
    dbPath,
    databaseUrl,
    databaseSchema,
    production,
  });
  const passwordSalt = randomBytes(16);
  const passwordHash = scryptSync(adminPassword, passwordSalt, 64);
  const inventoryKey = (locationId, date) =>
    `inventory:${locationId}:${typeof date === "string" ? date : "invalid-date"}`;

  async function audit(tx, id, action, detail, at = now()) {
    await tx
      .prepare(
        "INSERT INTO audit(entity_id,action,detail,created_at) VALUES(?,?,?,?)",
      )
      .run(id, action, detail, iso(at));
  }
  // Call only while holding this studio/day's inventory lock. RETURNING prevents duplicate audit events.
  async function expire(tx, locationId, date, at = now()) {
    const stale = await tx
      .prepare(
        "UPDATE bookings SET status='expired',updated_at=?,reason='Истёк срок подтверждения' WHERE location_id=? AND date=? AND status='pending' AND expires_at<=? RETURNING id",
      )
      .all(iso(at), locationId, date, iso(at));
    for (const row of stale)
      await audit(tx, row.id, "expired", "Истёк срок подтверждения", at);
  }
  async function expireAll() {
    const at = now();
    const days = await db
      .prepare(
        "SELECT DISTINCT location_id,date FROM bookings WHERE status='pending' AND expires_at<=? ORDER BY location_id,date",
      )
      .all(iso(at));
    // Never hold several inventory locks while cleaning unrelated days.
    for (const day of days)
      await db.transaction(
        (tx) => expire(tx, day.location_id, day.date, at),
        [inventoryKey(day.location_id, day.date)],
      );
  }
  function location(value) {
    const result = locations.find((l) => l.id === value || l.slug === value);
    if (!result) fail(404, "Локация не найдена.", "LOCATION_NOT_FOUND");
    return result;
  }
  async function conflict(tx, locationId, date, start, end) {
    const booking = await tx
      .prepare(
        "SELECT id FROM bookings WHERE location_id=? AND date=? AND status IN ('pending','confirmed') AND start_time<? AND end_time>? LIMIT 1",
      )
      .get(locationId, date, end, start);
    const block = await tx
      .prepare(
        "SELECT id FROM blocks WHERE location_id=? AND date=? AND start_time<? AND end_time>? LIMIT 1",
      )
      .get(locationId, date, end, start);
    return Boolean(booking || block);
  }
  function sessionTokenHash(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("semka_session="));
    const token = cookie?.slice("semka_session=".length);
    return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
  }
  async function session(req) {
    const tokenHash = sessionTokenHash(req);
    if (!tokenHash) return null;
    return (
      (await db
        .prepare(
          "SELECT token_hash,expires_at FROM sessions WHERE token_hash=? AND expires_at>?",
        )
        .get(tokenHash, now())) || null
    );
  }
  async function requireAdmin(req) {
    const result = await session(req);
    if (!result) fail(401, "Войдите как администратор.", "UNAUTHORIZED");
    return result;
  }
  function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    const normalized = digits.length === 11 && (digits[0] === "7" || digits[0] === "8")
      ? `+7${digits.slice(1)}` : "";
    if (!/^\+7\d{10}$/.test(normalized))
      fail(400, "Введите номер Казахстана в формате +7XXXXXXXXXX.", "INVALID_PHONE");
    return normalized;
  }
  function validPassword(value) {
    if (typeof value !== "string" || value.length < 12 || value.length > 128)
      fail(400, "Пароль должен содержать от 12 до 128 символов.", "WEAK_PASSWORD");
    if (["password", "qwerty", "123456", "password123"].includes(value.toLowerCase()) ||
      [/[a-zа-я]/i, /\d/, /[^\w\s]/].filter((rule) => rule.test(value)).length < 3)
      fail(400, "Используйте более сложный пароль: буквы, цифры и символ.", "WEAK_PASSWORD");
    return value;
  }
  function userTokenHash(req) {
    const cookie = (req.headers.cookie || "").split(";").map((s) => s.trim())
      .find((s) => s.startsWith("semka_user_session="));
    const token = cookie?.slice("semka_user_session=".length);
    return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
  }
  async function userSession(req) {
    const tokenHash = userTokenHash(req);
    if (!tokenHash) return null;
    return db.prepare("SELECT s.token_hash,u.id,u.first_name,u.last_name,u.email,u.phone,u.role,u.phone_verified_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").get(tokenHash, now());
  }
  async function requireUser(req) {
    const result = await userSession(req);
    if (!result) fail(401, "Войдите в личный кабинет.", "UNAUTHORIZED");
    return result;
  }
  function checkOrigin(req) {
    if (req.headers["sec-fetch-site"] === "cross-site")
      fail(403, "Запрос с другого сайта запрещён.", "ORIGIN_FORBIDDEN");
    const origin = req.headers.origin;
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
    // Render terminates TLS. Trust configured public origin, never arbitrary forwarded headers.
    const directOrigin = `${req.socket.encrypted ? "https:" : "http:"}//${req.headers.host}`;
    const accepted = production
      ? parsed.origin === allowedOrigin
      : parsed.origin === directOrigin || parsed.origin === allowedOrigin;
    if (!accepted)
      fail(403, "Запрос с другого сайта запрещён.", "ORIGIN_FORBIDDEN");
  }
  function setCookie(res, token, req, maxAge = SESSION_TTL / 1000) {
    const secure =
      production ||
      req.socket.encrypted ||
      (allowedOrigin || "").startsWith("https://");
    res.setHeader(
      "Set-Cookie",
      `semka_session=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
    );
  }
  function setUserCookie(res, token, req, maxAge = SESSION_TTL / 1000) {
    const secure = production || req.socket.encrypted || (allowedOrigin || "").startsWith("https://");
    res.setHeader("Set-Cookie", `semka_user_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
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
    if (method === "GET" && path === "/api/health") {
      try {
        await db.ping();
      } catch {
        return send(res, 503, { ok: false, code: "DATABASE_UNAVAILABLE" });
      }
      return send(res, 200, { ok: true, timezone: "Asia/Almaty", demo: true });
    }
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
      const occupied = await db.transaction(
        async (tx) => {
          await expire(tx, loc.id, date, at);
          return tx
            .prepare(
              "SELECT start_time,end_time FROM bookings WHERE location_id=? AND date=? AND status IN ('pending','confirmed') UNION ALL SELECT start_time,end_time FROM blocks WHERE location_id=? AND date=?",
            )
            .all(loc.id, date, loc.id, date);
        },
        [inventoryKey(loc.id, date)],
      );
      const slots = [];
      for (let hour = 9; hour + duration <= 21; hour++) {
        const time = `${String(hour).padStart(2, "0")}:00`;
        const end = `${String(hour + duration).padStart(2, "0")}:00`;
        slots.push({
          time,
          available:
            startMillis(date, time) > at &&
            !occupied.some(
              (item) => item.start_time < end && item.end_time > time,
            ),
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
      // Stable normalized intent allows retries after the original hold has expired.
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
      const result = await db.transaction(
        async (tx) => {
          const previous = await tx
            .prepare("SELECT * FROM idempotency WHERE key=?")
            .get(key);
          if (previous) {
            if (previous.payload_hash !== payloadHash)
              fail(
                409,
                "Этот ключ уже использован для другой заявки.",
                "IDEMPOTENCY_CONFLICT",
              );
            await expire(tx, loc.id, body.date);
            return {
              replay: true,
              booking: await tx
                .prepare("SELECT * FROM bookings WHERE id=?")
                .get(previous.booking_id),
            };
          }
          const at = now();
          const slot = interval(body, at);
          await expire(tx, loc.id, slot.date, at);
          if (
            await conflict(tx, loc.id, slot.date, slot.startTime, slot.endTime)
          )
            fail(
              409,
              "Этот интервал уже занят. Выберите другое время.",
              "SLOT_UNAVAILABLE",
            );
          const id = randomUUID();
          const token = randomBytes(24).toString("hex");
          const expires = iso(addBusinessHours(at, HOLD_TTL / HOUR));
          await tx
            .prepare(
              `INSERT INTO bookings(id,public_token,location_id,date,start_time,end_time,duration,name,phone,comment,total_price,status,expires_at,created_at,updated_at,consent_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
            )
            .run(
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
          await tx
            .prepare(
              "INSERT INTO idempotency(key,payload_hash,booking_id) VALUES(?,?,?)",
            )
            .run(key, payloadHash, id);
          await audit(
            tx,
            id,
            "created",
            "Создана заявка; согласие получено",
            at,
          );
          return {
            replay: false,
            booking: await tx
              .prepare("SELECT * FROM bookings WHERE id=?")
              .get(id),
          };
        },
        [`idempotency:${key}`, inventoryKey(loc.id, body.date)],
      );
      if (result.replay) res.setHeader("Idempotency-Replayed", "true");
      return send(res, result.replay ? 200 : 201, {
        booking: publicBooking(result.booking),
      });
    }
    const publicRead = path.match(/^\/api\/bookings\/([a-f0-9]{48})$/);
    if (method === "GET" && publicRead) {
      let booking = await db
        .prepare("SELECT * FROM bookings WHERE public_token=?")
        .get(publicRead[1]);
      if (!booking)
        fail(404, "Заявка не найдена. Проверьте ссылку.", "BOOKING_NOT_FOUND");
      if (booking.status === "pending")
        booking = await db.transaction(
          async (tx) => {
            await expire(tx, booking.location_id, booking.date);
            return tx
              .prepare("SELECT * FROM bookings WHERE id=?")
              .get(booking.id);
          },
          [inventoryKey(booking.location_id, booking.date)],
        );
      return send(res, 200, { booking: publicBooking(booking) });
    }
    if (method === "POST" && path === "/api/auth/register") {
      const body = await jsonBody(req);
      const firstName = textField(body.firstName, "Имя", { min: 2, max: 60 });
      const lastName = textField(body.lastName, "Фамилия", { min: 2, max: 60 });
      const email = textField(body.email, "Email", { min: 5, max: 254 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Проверьте email.", "INVALID_EMAIL");
      const phone = normalizePhone(body.phone);
      const password = validPassword(body.password);
      if (body.password !== body.passwordRepeat) fail(400, "Пароли не совпадают.", "PASSWORD_MISMATCH");
      if (body.consent !== true) fail(400, "Нужно согласие на обработку данных.", "CONSENT_REQUIRED");
      const at = now(); const id = randomUUID(); const salt = randomBytes(16).toString("hex");
      try {
        await db.transaction(async (tx) => {
          const existing = await tx.prepare("SELECT id FROM users WHERE email=? OR phone=? LIMIT 1").get(email, phone);
          if (existing) fail(409, "Не удалось создать аккаунт с этими данными.", "ACCOUNT_EXISTS");
          await tx.prepare("INSERT INTO users(id,first_name,last_name,email,phone,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .run(id, firstName, lastName, email, phone, scryptSync(password, salt, 64).toString("hex"), salt, iso(at), iso(at));
          const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
          await tx.prepare("INSERT INTO phone_verifications(user_id,code_hash,expires_at,sent_at,hour_started_at) VALUES(?,?,?,?,?)")
            .run(id, digest(`${id}:${code}`), at + 5 * 60000, at, at);
          await tx.prepare("INSERT INTO audit_events(user_id,action,detail,created_at) VALUES(?,?,?,?)").run(id, "register", "Аккаунт создан, ожидается подтверждение телефона", iso(at));
          body._devCode = production ? undefined : code;
        }, ["auth:register:" + digest(email), "auth:register:" + digest(phone)]);
      } catch (error) { if (error instanceof HttpError) throw error; throw error; }
      return send(res, 201, { ok: true, verificationRequired: true, ...(production ? {} : { devCode: body._devCode }) });
    }
    if (method === "POST" && path === "/api/auth/verify-phone") {
      const body = await jsonBody(req); const email = textField(body.email, "Email", { min: 5, max: 254 }).toLowerCase();
      const code = textField(body.code, "Код", { min: 6, max: 6 }); if (!/^\d{6}$/.test(code)) fail(400, "Код состоит из шести цифр.", "INVALID_CODE");
      const at = now(); const user = await db.transaction(async (tx) => {
        const account = await tx.prepare("SELECT * FROM users WHERE email=?").get(email); const verification = account && await tx.prepare("SELECT * FROM phone_verifications WHERE user_id=?").get(account.id);
        if (!account || !verification || verification.expires_at <= at || verification.attempts >= 5 || !timingSafeEqual(Buffer.from(verification.code_hash), Buffer.from(digest(`${account.id}:${code}`)))) {
          if (verification) await tx.prepare("UPDATE phone_verifications SET attempts=attempts+1 WHERE user_id=?").run(account.id);
          fail(400, "Код недействителен или срок его действия истёк.", "INVALID_CODE");
        }
        await tx.prepare("UPDATE users SET phone_verified_at=?,updated_at=? WHERE id=?").run(iso(at), iso(at), account.id);
        await tx.prepare("DELETE FROM phone_verifications WHERE user_id=?").run(account.id);
        await tx.prepare("INSERT INTO audit_events(user_id,action,detail,created_at) VALUES(?,?,?,?)").run(account.id, "phone_verified", "Телефон подтверждён", iso(at)); return account;
      }, ["verify:" + digest(email)]);
      return send(res, 200, { ok: true, email: user.email });
    }
    if (method === "POST" && path === "/api/auth/login") {
      const body = await jsonBody(req); const email = textField(body.email, "Email", { min: 5, max: 254 }).toLowerCase();
      const password = typeof body.password === "string" ? body.password : ""; const at = now();
      const ip = req.socket.remoteAddress || "unknown"; const accountKey = `login:email:${digest(email)}`; const ipKey = `login:ip:${digest(ip)}`;
      const result = await db.transaction(async (tx) => {
        for (const key of [accountKey, ipKey]) { const limit = await tx.prepare("SELECT failures,reset_at FROM auth_rate_limits WHERE throttle_key=?").get(key); if (limit && limit.reset_at > at && limit.failures >= 5) fail(429, "Слишком много попыток. Попробуйте позже.", "RATE_LIMIT"); }
        const user = await tx.prepare("SELECT * FROM users WHERE email=?").get(email);
        const received = user ? scryptSync(password, user.password_salt, 64) : randomBytes(64);
        const expected = user ? Buffer.from(user.password_hash, "hex") : randomBytes(64);
        const valid = Boolean(user) && expected.length === received.length && timingSafeEqual(expected, received);
        if (!valid || !user.phone_verified_at) {
          for (const key of [accountKey, ipKey]) { const old = await tx.prepare("SELECT failures,reset_at FROM auth_rate_limits WHERE throttle_key=?").get(key); const failures = old && old.reset_at > at ? old.failures + 1 : 1; await tx.prepare("INSERT INTO auth_rate_limits(throttle_key,failures,reset_at) VALUES(?,?,?) ON CONFLICT(throttle_key) DO UPDATE SET failures=excluded.failures,reset_at=excluded.reset_at").run(key, failures, at + LIMIT_WINDOW); }
          fail(401, "Не удалось войти. Проверьте данные и подтверждение телефона.", "LOGIN_FAILED");
        }
        for (const key of [accountKey, ipKey]) await tx.prepare("DELETE FROM auth_rate_limits WHERE throttle_key=?").run(key);
        const token = randomBytes(32).toString("hex"); await tx.prepare("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(digest(token), user.id, at + SESSION_TTL, iso(at));
        return { token, user };
      }, [accountKey, ipKey]);
      setUserCookie(res, result.token, req); return send(res, 200, { user: { id: result.user.id, firstName: result.user.first_name, lastName: result.user.last_name, email: result.user.email, role: result.user.role } });
    }
    if (method === "GET" && path === "/api/auth/session") { const user = await userSession(req); return send(res, 200, { authenticated: Boolean(user), user: user && { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, phone: user.phone, role: user.role } }); }
    if (method === "POST" && path === "/api/auth/logout") { const tokenHash = userTokenHash(req); if (tokenHash) await db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(tokenHash); setUserCookie(res, "", req, 0); return send(res, 200, { ok: true }); }
    if (method === "GET" && path === "/api/profile") { const user = await requireUser(req); return send(res, 200, { user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, phone: user.phone, role: user.role } }); }
    if (method === "GET" && path === "/api/admin/session")
      return send(res, 200, { authenticated: Boolean(await session(req)) });
    if (method === "POST" && path === "/api/admin/login") {
      const body = await jsonBody(req);
      const password =
        typeof body.password === "string" && body.password.length <= 256
          ? body.password
          : "";
      // One account-wide limit is shared by instances and cannot be bypassed by spoofing proxy headers.
      const result = await db.transaction(
        async (tx) => {
          const at = now();
          const stored = await tx
            .prepare(
              "SELECT failures,reset_at FROM login_attempts WHERE throttle_key=?",
            )
            .get("admin");
          const attempt =
            stored && Number(stored.reset_at) > at
              ? { count: stored.failures, resetAt: Number(stored.reset_at) }
              : { count: 0, resetAt: at + LIMIT_WINDOW };
          if (attempt.count >= 5)
            return {
              limited: true,
              retryAfter: Math.ceil((attempt.resetAt - at) / 1000),
            };
          const check = scryptSync(password, passwordSalt, 64);
          if (!timingSafeEqual(check, passwordHash)) {
            await tx
              .prepare(
                "INSERT INTO login_attempts(throttle_key,failures,reset_at) VALUES(?,?,?) ON CONFLICT(throttle_key) DO UPDATE SET failures=excluded.failures,reset_at=excluded.reset_at",
              )
              .run("admin", attempt.count + 1, attempt.resetAt);
            return { invalid: true };
          }
          await tx
            .prepare("DELETE FROM login_attempts WHERE throttle_key=?")
            .run("admin");
          await tx.prepare("DELETE FROM sessions WHERE expires_at<=?").run(at);
          const existing = sessionTokenHash(req);
          if (existing)
            await tx
              .prepare("DELETE FROM sessions WHERE token_hash=?")
              .run(existing);
          const token = randomBytes(32).toString("hex");
          await tx
            .prepare("INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)")
            .run(digest(token), at + SESSION_TTL);
          return { token };
        },
        ["login:admin"],
      );
      if (result.limited) {
        res.setHeader("Retry-After", result.retryAfter);
        fail(
          429,
          "Слишком много попыток. Повторите через 15 минут.",
          "RATE_LIMITED",
        );
      }
      if (result.invalid) fail(401, "Неверный пароль.", "INVALID_CREDENTIALS");
      setCookie(res, result.token, req);
      return send(res, 200, { authenticated: true });
    }
    if (path.startsWith("/api/admin/")) {
      const currentSession = await requireAdmin(req);
      if (method === "POST" && path === "/api/admin/logout") {
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .run(currentSession.token_hash);
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
        await expireAll();
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
        let rows = await db
          .prepare(
            `SELECT * FROM bookings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC,id DESC`,
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
        const target = await db
          .prepare("SELECT location_id,date FROM bookings WHERE id=?")
          .get(adminPatch[1]);
        if (!target) fail(404, "Заявка не найдена.", "BOOKING_NOT_FOUND");
        const booking = await db.transaction(
          async (tx) => {
            await expire(tx, target.location_id, target.date);
            const row = await tx
              .prepare("SELECT * FROM bookings WHERE id=?")
              .get(adminPatch[1]);
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
            await tx
              .prepare(
                "UPDATE bookings SET status=?,reason=?,updated_at=? WHERE id=?",
              )
              .run(body.status, reason, iso(now()), row.id);
            await audit(tx, row.id, `${row.status}→${body.status}`, reason);
            return tx.prepare("SELECT * FROM bookings WHERE id=?").get(row.id);
          },
          [inventoryKey(target.location_id, target.date)],
        );
        return send(res, 200, { booking: adminBooking(booking) });
      }
      if (method === "GET" && path === "/api/admin/blocks")
        return send(res, 200, {
          blocks: (
            await db
              .prepare("SELECT * FROM blocks ORDER BY date,start_time")
              .all()
          ).map(blockDto),
        });
      if (method === "POST" && path === "/api/admin/blocks") {
        const body = await jsonBody(req);
        const loc = location(body.locationId);
        const reason = textField(body.reason, "Причина блокировки", {
          min: 3,
          max: 500,
        });
        const block = await db.transaction(
          async (tx) => {
            const at = now();
            const slot = interval(body, at);
            await expire(tx, loc.id, slot.date, at);
            if (
              await conflict(
                tx,
                loc.id,
                slot.date,
                slot.startTime,
                slot.endTime,
              )
            )
              fail(
                409,
                "В этом интервале уже есть заявка или блокировка.",
                "SLOT_UNAVAILABLE",
              );
            const id = randomUUID();
            await tx
              .prepare(
                "INSERT INTO blocks(id,location_id,date,start_time,end_time,duration,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
              )
              .run(
                id,
                loc.id,
                slot.date,
                slot.startTime,
                slot.endTime,
                slot.duration,
                reason,
                iso(at),
              );
            await audit(tx, id, "blocked", reason, at);
            return tx.prepare("SELECT * FROM blocks WHERE id=?").get(id);
          },
          [inventoryKey(loc.id, body.date)],
        );
        return send(res, 201, { block: blockDto(block) });
      }
      const blockDelete = path.match(/^\/api\/admin\/blocks\/([a-f0-9-]{36})$/);
      if (method === "DELETE" && blockDelete) {
        const target = await db
          .prepare("SELECT location_id,date FROM blocks WHERE id=?")
          .get(blockDelete[1]);
        if (!target) fail(404, "Блокировка не найдена.", "BLOCK_NOT_FOUND");
        await db.transaction(
          async (tx) => {
            const block = await tx
              .prepare("SELECT * FROM blocks WHERE id=?")
              .get(blockDelete[1]);
            if (!block) fail(404, "Блокировка не найдена.", "BLOCK_NOT_FOUND");
            await tx.prepare("DELETE FROM blocks WHERE id=?").run(block.id);
            await audit(tx, block.id, "unblocked", block.reason);
          },
          [inventoryKey(target.location_id, target.date)],
        );
        return send(res, 200, { ok: true });
      }
      if (method === "GET" && path === "/api/admin/audit") {
        const events = await db
          .prepare(
            'SELECT entity_id AS "entityId",action,detail,created_at AS "createdAt" FROM audit ORDER BY id DESC LIMIT 200',
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
        console.error("API error:", error.code || error.name);
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
    async close() {
      await db.close();
    },
  };
}
