import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  money,
  astanaDate,
  dateLabel,
  navigate,
  locationImage,
} from "./lib";
import { Icon, Link, ErrorBox, Loading, Status } from "./ui";
import Admin from "./Admin";
import { Auth } from "./Auth";
import "./styles.css";
import "./design.css";

function Header({ path }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  return (
    <>
      <a className="skip" href="#main">
        Перейти к содержимому
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Съёмка.kz, главная">
          <span className="brand-icon">
            <Icon name="camera" size={23} />
          </span>
          съёмка<span className="brand-dot">.kz</span>
        </Link>
        <button
          className="menu-toggle"
          aria-label="Открыть меню"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name={menu ? "close" : "grid"} />
        </button>
        <nav className={menu ? "open" : ""} aria-label="Основная навигация">
          <Link to="/#locations" className={path === "/" ? "active" : ""}>
            Локации
          </Link>
          <Link to="/#how">Как это работает</Link>
          <Link to="/#about">О проекте</Link>
          <Link to="/register" className="mobile-registration">Регистрация</Link>
        </nav>
        <div className="header-right">
          <span className="city">
            <Icon name="pin" size={15} />
            Астана
          </span>
          <Link to="/login" className="admin-link">Войти</Link>
          <Link to="/register" className="admin-link">Регистрация</Link>
        </div>
      </header>
    </>
  );
}
function Footer() {
  return (
    <footer>
      <Link to="/" className="brand">
        съёмка<span className="brand-dot">.kz</span>
      </Link>
      <p>Место, где идея становится кадром.</p>
      <span>© {new Date().getFullYear()} Съёмка.kz</span>
      <Link to="/admin">
        Кабинет студии <Icon name="diagonal" size={14} />
      </Link>
    </footer>
  );
}

function spacesLabel(count) {
  const category = new Intl.PluralRules("ru").select(count);
  return {
    one: "пространство",
    few: "пространства",
    many: "пространств",
    other: "пространства",
  }[category];
}

function Home({ locations, error, retry }) {
  const [filter, setFilter] = useState("Все локации");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [heroType, setHeroType] = useState("Все локации");
  const [searchDate, setSearchDate] = useState("");
  const [searchDuration, setSearchDuration] = useState(1);
  const [availableIds, setAvailableIds] = useState(null);
  const [appliedDate, setAppliedDate] = useState("");
  const [appliedDuration, setAppliedDuration] = useState(1);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  async function findSpaces(event) {
    event.preventDefault();
    if (finding) return;
    setFinding(true); setFindError("");
    try {
      let available = null;
      if (searchDate) {
        const results = await Promise.all(locations.map(async loc => {
          const data = await api(`/locations/${loc.id}/availability?date=${searchDate}&duration=${searchDuration}`);
          return data.slots.some(slot => slot.available) ? loc.id : null;
        }));
        available = results.filter(Boolean);
      }
      setAvailableIds(available); setFilter(heroType); setSearch("");
      setAppliedDate(searchDate); setAppliedDuration(searchDuration);
      document.getElementById("locations")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) { setFindError(e.message); }
    finally { setFinding(false); }
  }
  const categories = [
    "Все локации",
    "Лофт",
    "Циклорама",
    "На открытом воздухе",
    "Сад",
    "Ангар",
  ];
  let list = locations.filter((l) => {
    const cat = l.type === "Крыша" ? "На открытом воздухе" : l.type;
    return (
      (filter === "Все локации" || cat === filter) &&
      (availableIds === null || availableIds.includes(l.id)) &&
      `${l.name} ${l.description} ${l.type}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  if (sort === "price") list = [...list].sort((a, b) => a.price - b.price);
  if (sort === "space") list = [...list].sort((a, b) => b.area - a.area);
  return (
    <>
      <section className="discovery-hero" aria-labelledby="discovery-title">
        <img className="discovery-photo" src="/images/garden.jpg" alt="Зелёное пространство Secret Garden" fetchPriority="high" />
        <div className="discovery-content">
          <div className="eyebrow">АСТАНА · ПРОСТРАНСТВА ДЛЯ СЪЁМКИ</div>
          <h1 id="discovery-title">Найдите место.<br />Создайте <em>свою историю.</em></h1>
          <p>Светлые студии, городские крыши и тихие сады.<br />Выберите пространство для вашего следующего кадра.</p>
          <form className="discovery-search" onSubmit={findSpaces}>
            <label><span>Локация</span><select value={heroType} onChange={e => setHeroType(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
            <label><span>Дата съёмки</span><input type="date" min={astanaDate()} max={astanaDate(90)} value={searchDate} onChange={e => setSearchDate(e.target.value)} aria-label="Дата съёмки" /></label>
            <label><span>Длительность</span><select value={searchDuration} onChange={e => setSearchDuration(Number(e.target.value))}>{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} ч</option>)}</select></label>
            <button className="button primary" disabled={finding || !locations.length}>{finding ? "Проверяем…" : "Найти место"}<Icon name="diagonal" /></button>
          </form>
          {findError && <div className="discovery-error" role="alert">{findError}</div>}
        </div>
        <span className="discovery-caption">Secret Garden · демонстрационная локация</span>
      </section>
      <div className="discovery-facts">
        <span><b>{locations.length || "—"}</b> пространств в каталоге</span>
        <span><b>от 1 часа</b> аренда локации</span>
        <span><b>₸</b> стоимость до отправки заявки</span>
      </div>
      <section id="locations" className="catalog section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">МЕСТО ДЛЯ ВАШЕЙ ИДЕИ</div>
            <h2>
              Откройте свой ракурс
            </h2>
          </div>
          <p>
            У каждого пространства — свой характер.<br />
            Найдите тот, который подходит вам.
          </p>
        </div>
        <div className="catalog-tools">
          <div className="filters" aria-label="Тип локации">
            {categories.map((cat) => (
              <button
                key={cat}
                className={cat === filter ? "selected" : ""}
                aria-pressed={cat === filter}
                onClick={() => setFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="catalog-controls">
            <label className="search-field">
              <Icon name="search" size={18} />
              <input
                placeholder="Найти локацию"
                aria-label="Найти локацию"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Сортировка локаций"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="default">По умолчанию</option>
              <option value="price">Сначала дешевле</option>
              <option value="space">Сначала просторнее</option>
            </select>
          </div>
        </div>
        <div className="catalog-meta">
          <span>
            {list.length} {spacesLabel(list.length)}
          </span>
          <span>{appliedDate ? `Свободные часы на ${dateLabel(appliedDate)} · ${appliedDuration} ч` : "Цены за час · время Астаны"}</span>
        </div>
        {appliedDate && <button className="clear-date" onClick={() => { setAvailableIds(null); setAppliedDate(""); setSearchDate(""); }}>Сбросить поиск по дате ×</button>}
        <div aria-live="polite" className="sr-only">Найдено: {list.length}</div>
        {error ? (
          <>
            <ErrorBox>{error}</ErrorBox>
            <button className="button" onClick={retry}>
              Попробовать снова
            </button>
          </>
        ) : !locations.length ? (
          <Loading />
        ) : list.length === 0 ? (
          <div className="empty">
            <Icon name="search" size={32} />
            <h3>Здесь пока тихо</h3>
            <p>Попробуйте другой запрос или тип пространства.</p>
            <button
              className="button"
              onClick={() => {
                setSearch("");
                setFilter("Все локации"); setHeroType("Все локации"); setAvailableIds(null); setAppliedDate(""); setSearchDate("");
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div className="location-grid">
            {list.map((loc, i) => (
              <Link
                to={`/locations/${loc.id}${appliedDate ? `?date=${appliedDate}&duration=${appliedDuration}` : ""}`}
                key={loc.id}
                className="location-card"
              >
                <div className="card-image">
                  <img src={locationImage(loc)} alt={loc.name} loading="lazy" />
                  <span className="card-type">{loc.type}</span>
                  <span className="card-arrow">
                    <Icon name="diagonal" />
                  </span>
                </div>
                <div className="card-body">
                  <div className="card-title">
                    <h3>{loc.name}</h3>
                    <span>
                      {String(locations.indexOf(loc) + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p>{loc.shortDescription || loc.description}</p>
                  <div className="card-specs">
                    <span>
                      <Icon name="grid" size={15} />
                      {loc.area} м²
                    </span>
                    <span>
                      <Icon name="users" size={15} />
                      до {loc.capacity} человек
                    </span>
                  </div>
                  <div className="card-price">
                    <span>
                      <b>{money(loc.price)}</b> / час
                    </span>
                    <span>
                      Выбрать время <Icon name="arrow" size={16} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="demo-note">
          Демонстрационный каталог MVP. Фотографии, цены и описания приведены
          для знакомства с сервисом.
        </p>
      </section>
      <section id="how" className="how section">
        <div className="eyebrow">02 / МЕНЬШЕ ПЕРЕПИСКИ, БОЛЬШЕ ТВОРЧЕСТВА</div>
        <h2>
          От идеи до съёмки.
          <br />
          Всего три шага.
        </h2>
        <div className="steps">
          {[
            [
              "01",
              "Найдите своё место",
              "Посмотрите пространство, условия и стоимость. Выберите то, что подходит вашей идее.",
              "search",
            ],
            [
              "02",
              "Выберите время",
              "Свободные часы уже в расписании. Стоимость аренды рассчитывается сразу.",
              "calendar",
            ],
            [
              "03",
              "Получите подтверждение",
              "Оставьте заявку. Студия проверит её, а статус будет доступен по вашей личной ссылке.",
              "check",
            ],
          ].map(([n, title, text, icon]) => (
            <div key={n}>
              <div className="step-top">
                <span>{n}</span>
                <Icon name={icon} size={27} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="about" className="about section">
        <div>
          <div className="eyebrow">СОЗДАНО ТЕМИ, КТО СНИМАЕТ</div>
          <h2>
            Хороший кадр
            <br />
            начинается с места.
          </h2>
        </div>
        <div>
          <p>
            Мы — Арсен и Адильжан, сооснователи Съёмка.kz. Делаем поиск локации
            понятным: всё важное о пространстве, времени и цене — в одном месте.
          </p>
          <p>
            Этот MVP помогает пройти путь от выбора площадки до подтверждения
            заявки. Без оплаты на сайте и лишних сообщений.
          </p>
          <a href="#locations" className="text-link">
            Найти место для съёмки <Icon name="arrow" />
          </a>
        </div>
      </section>
    </>
  );
}

function LocationDetail({ location, index }) {
  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get("date") || "";
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= astanaDate() && requestedDate <= astanaDate(90) ? requestedDate : astanaDate(1);
  const [date, setDate] = useState(initialDate);
  const [duration, setDuration] = useState(/^[1-8]$/.test(params.get("duration") || "") ? Number(params.get("duration")) : 1);
  const [slots, setSlots] = useState([]);
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const request = useRef({ signature: "", key: "" });
  useEffect(() => {
    let live = true;
    setLoading(true);
    setTime("");
    setError("");
    api(
      `/locations/${location.id}/availability?date=${date}&duration=${duration}`,
    )
      .then((d) => {
        if (live) setSlots(d.slots);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setSlots([]);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [location.id, date, duration, refresh]);
  async function submit(e) {
    e.preventDefault();
    if (!time || !consent) return;
    setSubmitting(true);
    setSubmitError("");
    const body = {
      locationId: location.id,
      date,
      startTime: time,
      duration,
      name,
      phone,
      comment,
      consent,
    };
    const signature = JSON.stringify(body);
    if (request.current.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      const d = await api("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": request.current.key },
        body: signature,
      });
      navigate(`/booking/${d.booking.publicToken}`);
    } catch (e) {
      setSubmitError(e.message);
      if (e.status === 409) {
        setStep(1);
        setRefresh((v) => v + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }
  const end = time
    ? `${String(Number(time.slice(0, 2)) + duration).padStart(2, "0")}:00`
    : "";
  return (
    <div className="detail section">
      <Link to="/#locations" className="back-link">
        ← Все локации
      </Link>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">АСТАНА / {location.type}</div>
          <h1>{location.name}</h1>
          <p>
            <Icon name="pin" size={17} />
            {location.address || "Астана · демонстрационная локация"}
          </p>
        </div>
        <span className="detail-index">/ {String(index).padStart(2, "0")}</span>
      </div>
      <div className="detail-grid">
        <div>
          <div className="detail-photo">
            <img src={locationImage(location)} alt={location.name} />
            <span className="image-tag">ВАШЕ ПРОСТРАНСТВО ДЛЯ ТВОРЧЕСТВА</span>
          </div>
          <div className="detail-specs">
            <span>
              <Icon name="grid" />
              {location.area} м²
            </span>
            <span>
              <Icon name="users" />
              До {location.capacity} человек
            </span>
            <span>
              <Icon name="clock" />
              09:00 — 21:00
            </span>
          </div>
          <h2 className="small-heading">Характер пространства</h2>
          <p className="detail-description">{location.description}</p>
          <h3>Всё для вашего кадра</h3>
          <div className="amenities">
            {location.amenities?.map((a) => (
              <span key={a}>
                <Icon name="check" size={17} />
                {a}
              </span>
            ))}
          </div>
          <div className="rules">
            <h3>Перед съёмкой</h3>
            <p>
              Аренда от одного часа. Время указано по Астане (UTC+5). Заявка
              временно удерживает выбранный интервал на 2 рабочих часа студии.
              Бронирование действует после подтверждения администратора.
            </p>
            <p>
              Оплата на сайте не требуется. В этой версии используется
              демонстрационный каталог.
            </p>
          </div>
        </div>
        <aside className="booking-panel">
          <div className="booking-price">
            <b>{money(location.price)}</b>
            <span>/ час</span>
          </div>
          <div className="booking-progress">
            <button
              className={step === 1 ? "current" : ""}
              onClick={() => setStep(1)}
            >
              1. Время
            </button>
            <span />
            <button
              className={step === 2 ? "current" : ""}
              disabled={!time}
              onClick={() => setStep(2)}
            >
              2. Контакты
            </button>
          </div>
          <form onSubmit={submit}>
            {step === 1 ? (
              <>
                <h3>Когда будем снимать?</h3>
                <div className="form-row">
                  <label>
                    Дата
                    <input
                      required
                      type="date"
                      min={astanaDate()}
                      max={astanaDate(90)}
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setSubmitError("");
                      }}
                    />
                  </label>
                  <label>
                    Длительность
                    <select
                      value={duration}
                      onChange={(e) => {
                        setDuration(Number(e.target.value));
                        setSubmitError("");
                      }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} ч.
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="field-label">
                  Начало съёмки <span>UTC+5</span>
                </div>
                {loading ? (
                  <Loading text="Проверяем свободное время…" />
                ) : (
                  <div className="slots">
                    {slots.map((s) => (
                      <button
                        type="button"
                        key={s.time}
                        disabled={!s.available}
                        aria-pressed={time === s.time}
                        className={time === s.time ? "chosen" : ""}
                        onClick={() => {
                          setTime(s.time);
                          setSubmitError("");
                        }}
                      >
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
                {!loading && !slots.some((s) => s.available) && !error && (
                  <p className="muted">
                    На эту дату нет свободных интервалов. Выберите другой день.
                  </p>
                )}
                <ErrorBox>{submitError || error}</ErrorBox>
                {error && (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => setRefresh((v) => v + 1)}
                  >
                    Обновить расписание
                  </button>
                )}
                <div className="booking-total">
                  <span>
                    {duration} ч. × {money(location.price)}
                  </span>
                  <b>{money(location.price * duration)}</b>
                </div>
                <button
                  type="button"
                  className="button primary full"
                  disabled={!time || loading}
                  onClick={() => setStep(2)}
                >
                  Продолжить <Icon name="arrow" />
                </button>
                <p className="panel-note">
                  Без оплаты на сайте. После заявки студия подтвердит время.
                </p>
              </>
            ) : (
              <>
                <h3>Оставьте контакты</h3>
                <div className="booking-summary">
                  {dateLabel(date)}
                  <br />
                  <b>
                    {time} — {end} · {duration} ч.
                  </b>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setStep(1)}
                  >
                    Изменить время
                  </button>
                </div>
                <label>
                  Ваше имя
                  <input
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как к вам обращаться"
                  />
                </label>
                <label>
                  Телефон
                  <input
                    type="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 700 123 45 67"
                    maxLength={25}
                  />
                </label>
                <label>
                  Комментарий <span className="muted">необязательно</span>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={1000}
                    placeholder="Что планируете снимать?"
                    rows={3}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    Согласен на обработку имени и телефона для оформления этой
                    заявки.
                  </span>
                </label>
                <ErrorBox>{submitError || error}</ErrorBox>
                <div className="booking-total">
                  <span>Итого за аренду</span>
                  <b>{money(location.price * duration)}</b>
                </div>
                <button
                  className="button primary full"
                  disabled={submitting || !consent}
                >
                  {submitting ? "Отправляем…" : "Отправить заявку"}
                  <Icon name="arrow" />
                </button>
                <p className="panel-note">
                  Заявка ещё не означает подтверждённую бронь.
                </p>
              </>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}

function BookingStatus({ token }) {
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const d = await api(`/bookings/${encodeURIComponent(token)}`);
      setBooking(d.booking);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [token]);
  return (
    <section className="status-page section">
      <Link to="/" className="back-link">
        ← На главную
      </Link>
      <div className="status-card">
        <div className="success-icon">
          <Icon
            name={booking?.status === "confirmed" ? "check" : "calendar"}
            size={32}
          />
        </div>
        <div className="eyebrow">ВАША СЪЁМКА</div>
        <h1>
          {booking?.status === "confirmed"
            ? "Увидимся на площадке!"
            : "Всё о вашей заявке"}
        </h1>
        <ErrorBox>{error}</ErrorBox>
        {!booking && !error ? (
          <Loading />
        ) : (
          booking && (
            <>
              <Status value={booking.status} />
              <p className="status-explanation">
                {booking.status === "pending"
                  ? "Заявка отправлена. Студия проверит её и подтвердит время. Сохраните эту страницу: здесь появится решение."
                  : booking.status === "confirmed"
                    ? "Студия подтвердила выбранное время. Детали съёмки и оплату согласуйте с администратором."
                    : booking.status === "expired"
                      ? "Время ожидания подтверждения истекло. Интервал снова доступен для бронирования."
                      : booking.reason ||
                        "Эта заявка больше не удерживает время. Вы можете выбрать другой интервал."}
              </p>
              <div className="receipt">
                <h3>{booking.locationName}</h3>
                <dl>
                  <div>
                    <dt>Дата</dt>
                    <dd>{dateLabel(booking.date)}</dd>
                  </div>
                  <div>
                    <dt>Время Астаны</dt>
                    <dd>
                      {booking.startTime} — {booking.endTime}
                    </dd>
                  </div>
                  <div>
                    <dt>Длительность</dt>
                    <dd>{booking.duration} ч.</dd>
                  </div>
                  <div className="receipt-total">
                    <dt>Стоимость</dt>
                    <dd>{money(booking.totalPrice)}</dd>
                  </div>
                </dl>
                <small>Заявка № {booking.id}</small>
              </div>
              {booking.status === "pending" && booking.expiresAt && (
                <p className="panel-note">
                  Удержание до{" "}
                  {new Date(booking.expiresAt).toLocaleString("ru-RU", {
                    timeZone: "Asia/Almaty",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  по Астане.
                </p>
              )}
              <button
                className="button primary full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    setCopied(true);
                  } catch {
                    setError("Скопируйте ссылку из адресной строки браузера.");
                  }
                }}
              >
                {copied ? "Ссылка скопирована" : "Скопировать ссылку на заявку"}
                <Icon name="diagonal" />
              </button>
              <p className="panel-note">
                Ссылка личная: любой, у кого она есть, сможет увидеть статус
                этой заявки.
              </p>
            </>
          )
        )}
        <button className="button full" disabled={busy} onClick={refresh}>
          {busy ? "Обновляем…" : "Обновить статус"}
        </button>
        <Link to="/#locations" className="text-link">
          Вернуться к локациям <Icon name="arrow" size={16} />
        </Link>
      </div>
    </section>
  );
}
function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const d = await api("/locations");
      setLocations(d.locations);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const onPath = () => {
      setPath(window.location.pathname);
      if (window.location.hash)
        setTimeout(
          () =>
            document
              .getElementById(window.location.hash.slice(1))
              ?.scrollIntoView(),
          30,
        );
    };
    window.addEventListener("popstate", onPath);
    return () => window.removeEventListener("popstate", onPath);
  }, []);
  useEffect(() => {
    if (locations.length && window.location.hash)
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [locations]);
  const detail = path.match(/^\/locations\/([^/]+)$/);
  const status = path.match(/^\/booking\/([^/]+)$/);
  const loc =
    detail &&
    locations.find((l) => String(l.id) === decodePathSegment(detail[1]));
  return (
    <>
      <Header path={path} />
      <main id="main">
        {["/login", "/register", "/verify-phone", "/profile"].includes(path) ? (<Auth path={path} />) : path === "/admin" ? (
          <Admin locations={locations} />
        ) : status ? (
          <BookingStatus key={status[1]} token={status[1]} />
        ) : detail ? (
          loc ? (
            <LocationDetail
              key={loc.id}
              location={loc}
              index={locations.indexOf(loc) + 1}
            />
          ) : error ? (
            <div className="section">
              <ErrorBox>{error}</ErrorBox>
              <button className="button" onClick={load}>
                Повторить
              </button>
            </div>
          ) : locations.length ? (
            <div className="empty">
              <h1>Локация не найдена</h1>
              <Link to="/">Вернуться к каталогу</Link>
            </div>
          ) : (
            <Loading />
          )
        ) : path === "/" ? (
          <Home locations={locations} error={error} retry={load} />
        ) : (
          <div className="empty">
            <h1>Этого кадра ещё нет</h1>
            <p>Страница не найдена.</p>
            <Link to="/" className="button primary">
              На главную
            </Link>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
