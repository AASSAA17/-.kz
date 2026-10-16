import { createServer } from "node:http";
import { createApp } from "./app.mjs";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT должен быть от 1 до 65535.");
function errorMessage(error) {
  let message = error instanceof Error ? error.message : "Неизвестная ошибка";
  for (const secret of [process.env.DATABASE_URL, process.env.ADMIN_PASSWORD]) {
    if (secret) message = message.split(secret).join("[скрыто]");
  }
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL скрыт]");
}

let app;
try {
  app = await createApp({
    adminPassword: process.env.ADMIN_PASSWORD,
    dbPath: process.env.DB_PATH,
    databaseUrl: process.env.DATABASE_URL,
    production,
    allowedOrigin: process.env.ALLOWED_ORIGIN || process.env.RENDER_EXTERNAL_URL,
  });
} catch (error) {
  console.error("Не удалось запустить приложение:", errorMessage(error));
  process.exit(1);
}
const server = createServer(app.handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, host, () =>
  console.log(
    `Съёмка.kz: ${host}:${port}; база: ${process.env.DATABASE_URL ? "PostgreSQL" : "SQLite"}; демонстрационный каталог`,
  ),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Drain HTTP requests before closing the database pool; bound shutdown time.
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(code || 1);
  }, 10000);
  deadline.unref();
  server.close(async () => {
    try {
      await app.close();
      clearTimeout(deadline);
      process.exitCode = code;
    } catch (error) {
      console.error("Ошибка остановки:", errorMessage(error));
      process.exitCode = 1;
    }
  });
  server.closeIdleConnections();
}

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Порт ${port} занят. Остановите другой сервер или измените PORT.`
      : errorMessage(error),
  );
  stop(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
