import React, { useEffect, useState } from "react";
import { api, money, dateLabel, astanaDate, statusLabels } from "./lib";
import { Icon, ErrorBox, Loading, Status, Link } from "./ui";
export default function Admin({ locations }) {
  const [auth, setAuth] = useState(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [bookings, setBookings] = useState([]),
    [blocks, setBlocks] = useState([]),
    [filter, setFilter] = useState(""),
    [query, setQuery] = useState(""),
    [date, setDate] = useState(""),
    [tab, setTab] = useState("bookings"),
    [notice, setNotice] = useState("");
  const [block, setBlock] = useState({
    locationId: "",
    date: astanaDate(1),
    startTime: "09:00",
    duration: 1,
    reason: "",
  });
  useEffect(() => {
    api("/admin/session")
      .then((d) => setAuth(d.authenticated))
      .catch(() => setAuth(false));
  }, []);
  async function load() {
    try {
      const [a, b] = await Promise.all([
        api("/admin/bookings"),
        api("/admin/blocks"),
      ]);
      setBookings(a.bookings);
      setBlocks(b.blocks);
      setError("");
      return true;
    } catch (e) {
      setError(e.message);
      setNotice("");
      if (e.status === 401) setAuth(false);
      return false;
    }
  }
  useEffect(() => {
    if (auth) {
      load();
      const id = setInterval(load, 30000);
      return () => clearInterval(id);
    }
  }, [auth]);
  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setAuth(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("/admin/logout", { method: "POST" });
      setAuth(false);
      setBookings([]);
      setBlocks([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function action(fn, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (await load()) setNotice(message);
    } catch (e) {
      if (e.status === 409) await load();
      setError(e.message);
      if (e.status === 401) setAuth(false);
    } finally {
      setBusy(false);
    }
  }
  const visible = bookings.filter(
    (b) =>
      (!filter || b.status === filter) &&
      (!date || b.date === date) &&
      (!query ||
        `${b.id} ${b.name} ${b.phone} ${b.locationName}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  if (auth === null) return <Loading text="Проверяем вход…" />;
  if (!auth)
    return (
      <section className="login-section section">
        <div className="login-aside">
          <div className="eyebrow">ЗА КАДРОМ / КАБИНЕТ СТУДИИ</div>
          <h1>
            Все съёмки.
            <br />
            Под контролем<span className="orange">.</span>
          </h1>
          <p>
            Управляйте заявками и расписанием
            <br />в одном пространстве.
          </p>
          <div className="login-illustration">
            <Icon name="calendar" size={100} />
            <span>Съёмка.kz / studio</span>
          </div>
        </div>
        <form className="login-card" onSubmit={login}>
          <span className="brand-icon">
            <Icon name="camera" />
          </span>
          <h2>Вход для администратора</h2>
          <p>Введите пароль вашей студии.</p>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorBox>{error}</ErrorBox>
          <button className="button primary full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
            <Icon name="arrow" />
          </button>
          <p className="panel-note">
            Для локального запуска пароль создан командой настройки и сохранён в
            файле .env.
          </p>
          <Link to="/" className="text-link">
            ← Вернуться к сайту
          </Link>
        </form>
      </section>
    );
  return (
    <section className="admin section">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">ЗА КАДРОМ</div>
          <h1>
            Кабинет студии<span className="orange">.</span>
          </h1>
          <p>Заявки и расписание · время Астаны, UTC+5</p>
        </div>
        <div className="admin-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => action(() => Promise.resolve(), "Данные обновлены")}
          >
            Обновить
          </button>
          <button className="button" disabled={busy} onClick={logout}>
            Выйти
          </button>
        </div>
      </div>
      <div className="stat-grid">
        <div>
          <span>Всего заявок</span>
          <b>{bookings.length}</b>
        </div>
        <div>
          <span>Ожидают решения</span>
          <b className="orange">
            {bookings.filter((b) => b.status === "pending").length}
          </b>
        </div>
        <div>
          <span>Подтверждены</span>
          <b>{bookings.filter((b) => b.status === "confirmed").length}</b>
        </div>
        <div>
          <span>Закрытых интервалов</span>
          <b>{blocks.length}</b>
        </div>
      </div>
      <div className="admin-tabs">
        <button
          className={tab === "bookings" ? "selected" : ""}
          onClick={() => setTab("bookings")}
        >
          Заявки
        </button>
        <button
          className={tab === "blocks" ? "selected" : ""}
          onClick={() => setTab("blocks")}
        >
          Закрытое время
        </button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {tab === "bookings" ? (
        <>
          <div className="admin-filters">
            <label className="search-field">
              <Icon name="search" />
              <input
                aria-label="Поиск заявок"
                placeholder="Имя, телефон или номер заявки"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Статус заявки"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Все статусы</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Дата съёмки"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {(filter || query || date) && (
              <button
                className="button"
                onClick={() => {
                  setFilter("");
                  setQuery("");
                  setDate("");
                }}
              >
                Сбросить
              </button>
            )}
          </div>
          <div className="bookings-list">
            {!visible.length ? (
              <div className="empty">
                <Icon name="calendar" size={32} />
                <h3>Заявок пока нет</h3>
                <p>
                  {bookings.length
                    ? "Измените фильтры, чтобы увидеть другие заявки."
                    : "Новая заявка с сайта появится здесь."}
                </p>
              </div>
            ) : (
              visible.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  busy={busy}
                  onAction={(status, reason) =>
                    action(
                      () =>
                        api(`/admin/bookings/${b.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status, reason }),
                        }),
                      "Статус заявки обновлён",
                    )
                  }
                />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="block-layout">
          <form
            className="block-form"
            onSubmit={(e) => {
              e.preventDefault();
              action(
                () =>
                  api("/admin/blocks", {
                    method: "POST",
                    body: JSON.stringify({
                      ...block,
                      locationId: block.locationId || locations[0]?.id,
                      duration: Number(block.duration),
                    }),
                  }),
                "Интервал закрыт для бронирования",
              );
            }}
          >
            <h3>Закрыть время</h3>
            <p className="muted">Для обслуживания или внешней брони.</p>
            <label>
              Локация
              <select
                required
                value={block.locationId || locations[0]?.id || ""}
                onChange={(e) =>
                  setBlock({ ...block, locationId: e.target.value })
                }
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Дата
              <input
                required
                type="date"
                min={astanaDate()}
                max={astanaDate(90)}
                value={block.date}
                onChange={(e) => setBlock({ ...block, date: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Начало
                <select
                  value={block.startTime}
                  onChange={(e) =>
                    setBlock({ ...block, startTime: e.target.value })
                  }
                >
                  {Array.from(
                    { length: 12 },
                    (_, i) => `${String(9 + i).padStart(2, "0")}:00`,
                  ).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Длительность
                <select
                  value={block.duration}
                  onChange={(e) =>
                    setBlock({ ...block, duration: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <option key={i} value={i}>
                      {i} ч.
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Причина
              <input
                required
                maxLength={500}
                value={block.reason}
                onChange={(e) => setBlock({ ...block, reason: e.target.value })}
                placeholder="Например, техническое обслуживание"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              Закрыть интервал
            </button>
          </form>
          <div>
            {blocks.length ? (
              blocks.map((b) => (
                <div className="block-card" key={b.id}>
                  <div>
                    <h3>
                      {b.locationName ||
                        locations.find(
                          (l) => String(l.id) === String(b.locationId),
                        )?.name}
                    </h3>
                    <p>
                      {dateLabel(b.date)} · {b.startTime} — {b.endTime}
                    </p>
                    <p className="muted">{b.reason}</p>
                  </div>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api(`/admin/blocks/${b.id}`, { method: "DELETE" }),
                        "Интервал снова доступен",
                      )
                    }
                  >
                    Открыть время
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">
                <Icon name="calendar" size={32} />
                <h3>Всё открыто</h3>
                <p>Закрытые интервалы появятся здесь.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
function BookingRow({ booking: b, busy, onAction }) {
  const [reason, setReason] = useState("");
  return (
    <article className="booking-row">
      <div className="booking-row-top">
        <div>
          <span className="row-id">#{b.id}</span>
          <h3>{b.locationName}</h3>
        </div>
        <Status value={b.status} />
      </div>
      <div className="booking-row-info">
        <div>
          <span>Съёмка</span>
          <b>{dateLabel(b.date)}</b>
          <p>
            {b.startTime} — {b.endTime} · {b.duration} ч.
          </p>
        </div>
        <div>
          <span>Клиент</span>
          <b>{b.name}</b>
          <a href={`tel:${b.phone}`}>{b.phone}</a>
        </div>
        <div>
          <span>Стоимость</span>
          <b>{money(b.totalPrice)}</b>
          <p>Без оплаты на сайте</p>
        </div>
      </div>
      {b.comment && <p className="client-comment">{b.comment}</p>}
      {b.reason && <p className="muted">Причина: {b.reason}</p>}
      {["pending", "confirmed"].includes(b.status) && (
        <div className="row-controls">
          {b.status === "pending" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => onAction("confirmed", "")}
            >
              Подтвердить <Icon name="check" size={16} />
            </button>
          )}
          <input
            aria-label={`Причина для заявки ${b.id}`}
            placeholder="Причина отклонения или отмены"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="button danger"
            disabled={busy || !reason.trim()}
            onClick={() =>
              onAction(
                b.status === "pending" ? "rejected" : "cancelled",
                reason,
              )
            }
          >
            {b.status === "pending" ? "Отклонить" : "Отменить бронь"}
          </button>
        </div>
      )}
    </article>
  );
}
