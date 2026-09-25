import { createServer } from "node:http";
import { createApp } from "./app.mjs";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT должен быть от 1 до 65535.");
let app;
try {
  app = createApp({
    adminPassword: process.env.ADMIN_PASSWORD,
    dbPath: process.env.DB_PATH,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const server = createServer(app.handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Съёмка.kz: http://localhost:${port} (данные: SQLite; демонстрационные локации)`,
  ),
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Порт ${port} занят. Остановите другой сервер или измените PORT.`
      : error.message,
  );
  app.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
