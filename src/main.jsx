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
import Planner from "./Planner";
import "./styles.css";
import "./design.css";
import "./planner.css";

function Header({ path }) {
  const [menu, setMenu] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    api("/auth/session").then(d => { if (active) setSignedIn(d.authenticated); }).catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, [path]);
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
          aria-label={menu ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={menu}
          aria-controls="primary-nav"
          onClick={() => setMenu(!menu)}
        >
          <Icon name={menu ? "close" : "menu"} />
        </button>
        <nav id="primary-nav" className={menu ? "open" : ""} aria-label="Основная навигация" onClick={(event) => {
          if (event.target.closest("a")) setMenu(false);
        }}>
          <Link to="/#locations" className={path === "/" ? "active" : ""}>
            Локации
          </Link>
          <Link to="/planner" className={path === "/planner" ? "active" : ""} aria-current={path === "/planner" ? "page" : undefined} onClick={(event) => {
            if (path === "/planner" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) event.preventDefault();
          }}>Планировщик</Link>
          <Link to="/#how">Как это работает</Link>
          <Link to={signedIn ? "/profile" : "/login"} className="mobile-registration">{signedIn ? "Мои заявки" : "Войти"}</Link>
        </nav>
        <div className="header-right">
          <span className="city">
            <Icon name="pin" size={15} />
            Астана
          </span>
          <Link to={signedIn ? "/profile" : "/login"} className="admin-link">{signedIn ? "Мои заявки" : "Войти"}</Link>
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
      <a href="/team.html">Команда проекта</a>
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
  const [availability, setAvailability] = useState(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  const [crew, setCrew] = useState(0);
  const [budget, setBudget] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("semka-saved-locations"));
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
    } catch { return []; }
  });
  const resultsHeading = useRef(null);
  function toggleSaved(id) {
    const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem("semka-saved-locations", JSON.stringify(next)); }
    catch { /* Favorites remain available for this visit. */ }
  }
  function resetFilters() {
    setFilter("Все локации");
    setHeroType("Все локации");
    setSearch("");
    setSearchDate("");
    setAvailability(null);
    setCrew(0);
    setBudget(0);
    setSavedOnly(false);
    setFindError("");
  }
  async function findSpaces(event) {
    event.preventDefault();
    if (finding) return;
    setFinding(true); setFindError("");
    try {
      const query = new URLSearchParams({ date: searchDate, duration: searchDuration });
      const result = searchDate ? await api("/locations/availability?" + query) : null;
      setAvailability(result);
      setFilter(heroType);
      setSearch("");
      setSavedOnly(false);
      resultsHeading.current?.focus();
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
  const timesById = new Map(availability?.locations.map(({ id, times }) => [id, times]));
  const totalDuration = availability?.duration ?? 1;
  const budgetLabel = availability ? "за съёмку" : "в час";
  const favoritesForPlan = saved.filter((id) => locations.some((loc) => loc.id === id)).slice(0, 3);
  const plannerParams = new URLSearchParams({ locations: favoritesForPlan.join(",") });
  if (availability) {
    plannerParams.set("date", availability.date);
    plannerParams.set("duration", availability.duration);
  }
  function detailLink(id, time) {
    const path = "/locations/" + id;
    if (!availability) return path;
    const query = new URLSearchParams({ date: availability.date, duration: availability.duration });
    if (time) query.set("time", time);
    return path + "?" + query;
  }
  let list = locations.filter((l) => {
    const cat = l.type === "Крыша" ? "На открытом воздухе" : l.type;
    return (
      (filter === "Все локации" || cat === filter) &&
      (!availability || timesById.get(l.id)?.length) &&
      (!crew || l.capacity >= crew) &&
      (!budget || l.price * totalDuration <= budget) &&
      (!savedOnly || saved.includes(l.id)) &&
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
        <div className="discovery-content">
          <div className="discovery-intro">
            <div className="eyebrow"><Icon name="pin" size={16} /> Астана · Локации для съёмок</div>
            <h1 id="discovery-title">Место для <em>вашего кадра</em></h1>
            <p>Студии, крыши и открытые площадки. Выберите локацию и сразу узнайте, когда она свободна и сколько стоит съёмка.</p>
            <div className="discovery-actions">
              <a href="#locations" className="button primary">Смотреть локации <Icon name="arrow" size={18} /></a>
              <Link to="/planner" className="discovery-browse"><Icon name="calendar" size={18} /> Планировщик съёмки</Link>
            </div>
          </div>
          <figure className="discovery-frame">
            <img className="discovery-photo" src="/images/loft.jpg" alt="Интерьер демонстрационной локации Loft 01" fetchPriority="high" />
            <figcaption><span>Лофт · 90 м²</span><b>Loft 01</b><Link to="/locations/loft" aria-label="Открыть Loft 01"><Icon name="diagonal" size={22} /></Link></figcaption>
          </figure>
          <form className="discovery-search" onSubmit={findSpaces}>
            <label><span>Тип площадки</span><select disabled={finding} value={heroType} onChange={e => setHeroType(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
            <label><span>Дата съёмки</span><input disabled={finding} type="date" min={astanaDate()} max={astanaDate(90)} value={searchDate} onChange={e => setSearchDate(e.target.value)} /></label>
            <label><span>Длительность</span><select disabled={finding} value={searchDuration} onChange={e => setSearchDuration(Number(e.target.value))}>{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} ч</option>)}</select></label>
            <button className="button primary" disabled={finding || !locations.length}>{finding ? "Проверяем…" : "Найти локацию"}<Icon name="search" /></button>
          </form>
          {findError && <div className="discovery-error" role="alert">{findError}</div>}
        </div>
      </section>
      <div className="discovery-facts">
        <span><Icon name="pin" /><b>{locations.length || "—"}</b> локаций в каталоге</span>
        <span><Icon name="clock" /><b>От 1 часа</b> аренда площадки</span>
        <span><Icon name="check" /><b>Без предоплаты</b> заявка на сайте</span>
      </div>
      <section id="locations" className="catalog section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Каталог · Астана</div>
            <h2 ref={resultsHeading} tabIndex={-1}>Площадки для съёмок</h2>
          </div>
          <p>
            Подберите площадку по времени, бюджету и размеру команды.
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
            <button aria-pressed={savedOnly} className={savedOnly ? "selected saved-filter" : "saved-filter"} onClick={() => setSavedOnly(!savedOnly)}>
              <Icon name="heart" size={16} /> Избранное {saved.length > 0 && saved.length}
            </button>
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
            <select aria-label="Размер команды" value={crew} onChange={(e) => setCrew(Number(e.target.value))}>
              <option value={0}>Любая команда</option>
              <option value={8}>От 8 человек</option>
              <option value={12}>От 12 человек</option>
              <option value={20}>От 20 человек</option>
            </select>
            <select aria-label="Максимальный бюджет" value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
              <option value={0}>Любой бюджет</option>
              {[15000, 25000, 40000, 80000].map(value => (
                <option key={value} value={value}>До {money(value)} {budgetLabel}</option>
              ))}
            </select>
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
          <span>{availability ? dateLabel(availability.date) + " · " + availability.duration + " ч" : "Цены за час · время Астаны"}</span>
        </div>
        {savedOnly && favoritesForPlan.length > 0 && (
          <Link className="button catalog-plan" to={"/planner?" + plannerParams}>
            <Icon name="calendar" size={17} /> {favoritesForPlan.length === 1 ? "Расписание избранной локации" : `Сравнить избранное · ${favoritesForPlan.length} локации`} <Icon name="arrow" size={16} />
          </Link>
        )}
        {availability && <button className="clear-date" onClick={() => { setAvailability(null); setSearchDate(""); }}>Убрать дату ×</button>}
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
            <h3>{savedOnly && !saved.length ? "Избранное пока пусто" : "Подходящих площадок не найдено"}</h3>
            <p>{savedOnly && !saved.length ? "Нажмите на сердечко, чтобы сохранить площадку в этом браузере." : "Попробуйте другую дату, длительность или сбросьте фильтры."}</p>
            <button
              className="button"
              onClick={resetFilters}
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div className="location-grid">
            {list.map((loc) => (
              <article className="location-card" key={loc.id}>
                <button type="button" className="save-location" aria-label={"Избранное: " + loc.name} aria-pressed={saved.includes(loc.id)} onClick={() => toggleSaved(loc.id)}>
                  <Icon name="heart" size={20} />
                </button>
                <Link to={detailLink(loc.id)} className="location-card-main">
                <div className="card-image">
                  <img src={locationImage(loc)} alt={loc.name} loading="lazy" />
                  <span className="card-type">{loc.type}</span>
                </div>
                <div className="card-body">
                  <div className="card-title">
                    <h3>{loc.name}</h3>
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
                      <b>{money(loc.price * totalDuration)}</b>{availability ? " за " + totalDuration + " ч" : " / час"}
                    </span>
                    <span>
                      Подробнее <Icon name="arrow" size={16} />
                    </span>
                  </div>
                </div>
                </Link>
                {availability && (
                  <div className="card-times">
                    <span>Свободное начало</span>
                    <div>
                      {timesById.get(loc.id)?.slice(0, 3).map((time) => (
                        <Link key={time} to={detailLink(loc.id, time)} aria-label={loc.name + ", " + time}>{time}</Link>
                      ))}
                      {timesById.get(loc.id)?.length > 3 && <Link to={detailLink(loc.id)}>Все слоты</Link>}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="demo-note">
          Демонстрационный каталог MVP. Фотографии, цены и описания приведены
          для знакомства с сервисом.
        </p>
      </section>
      <section id="how" className="how section">
        <h2>
          От идеи до съёмки.
          <br />
          Всего три шага.
        </h2>
        <div className="steps">
          {[
            [
              "Найдите своё место",
              "Посмотрите пространство, условия и стоимость. Выберите то, что подходит вашей идее.",
              "search",
            ],
            [
              "Выберите время",
              "Свободные часы уже в расписании. Стоимость аренды рассчитывается сразу.",
              "calendar",
            ],
            [
              "Получите подтверждение",
              "Оставьте заявку. Студия проверит её, а статус будет доступен по вашей личной ссылке.",
              "check",
            ],
          ].map(([title, text, icon]) => (
            <div key={title}>
              <div className="step-top">
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

function LocationDetail({ location }) {
  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get("date") || "";
  const parsedDate = new Date(requestedDate + "T00:00:00Z");
  const dateFromLink = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) &&
    requestedDate >= astanaDate() && requestedDate <= astanaDate(90) &&
    Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === requestedDate;
  const initialDate = dateFromLink ? requestedDate : astanaDate(1);
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
  const preferredTime = useRef(dateFromLink ? params.get("time") : null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(Boolean(date));
    setTime("");
    setError("");
    if (!date) {
      setSlots([]);
      return;
    }
    api(
      `/locations/${location.id}/availability?date=${date}&duration=${duration}`,
      { signal: controller.signal },
    )
      .then((d) => {
        if (controller.signal.aborted) return;
        setSlots(d.slots);
        const preferred = preferredTime.current;
        preferredTime.current = null;
        if (d.slots.some((slot) => slot.time === preferred && slot.available))
          setTime(preferred);
        else if (preferred)
          setSubmitError("Выбранное время больше недоступно. Выберите другой интервал.");
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setSlots([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [location.id, date, duration, refresh]);
  function chooseDate(value) {
    if (value === date) return;
    preferredTime.current = null;
    setTime("");
    setDate(value);
    setLoading(Boolean(value));
    setSubmitError("");
  }
  async function submit(e) {
    e.preventDefault();
    if (step !== 2 || submitting || !time || !consent) return;
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
      </div>
      <div className="detail-grid">
        <div>
          <div className="detail-photo">
            <img src={locationImage(location)} alt={location.name} />
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
            <Link className="text-link" to={"/planner?" + new URLSearchParams({ date, duration, locations: location.id })}>
              Посмотреть свободное время на неделю <Icon name="arrow" size={16} />
            </Link>
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
              aria-current={step === 1 ? "step" : undefined}
              disabled={submitting}
              onClick={() => setStep(1)}
            >
              1. Время
            </button>
            <span />
            <button
              className={step === 2 ? "current" : ""}
              aria-current={step === 2 ? "step" : undefined}
              disabled={!time || submitting}
              onClick={() => setStep(2)}
            >
              2. Контакты
            </button>
          </div>
          <form onSubmit={submit} key={step} className="booking-step">
            {step === 1 ? (
              <>
                <h3>Когда будем снимать?</h3>
                <div className="quick-dates" aria-label="Быстрый выбор даты">
                  {["Сегодня", "Завтра", "Послезавтра"].map((label, offset) => (
                    <button key={label} type="button" aria-pressed={date === astanaDate(offset)} onClick={() => chooseDate(astanaDate(offset))}>{label}</button>
                  ))}
                </div>
                <div className="form-row">
                  <label>
                    Дата
                    <input
                      required
                      type="date"
                      min={astanaDate()}
                      max={astanaDate(90)}
                      value={date}
                      onChange={(e) => chooseDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Длительность
                    <select
                      value={duration}
                      onChange={(e) => {
                        preferredTime.current = null;
                        setTime("");
                        setLoading(Boolean(date));
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
                {!loading && date && !slots.some((s) => s.available) && !error && (
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
                    disabled={submitting}
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
              {booking.status === "confirmed" && (
                <a className="button full calendar-download" href={"/api/bookings/" + encodeURIComponent(token) + "/calendar.ics"}>
                  <Icon name="calendar" /> Добавить в календарь
                </a>
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
        ) : path === "/planner" ? (
          <Planner locations={locations} error={error} retry={load} />
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
