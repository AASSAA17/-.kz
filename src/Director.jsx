import React, { useEffect, useState } from "react";
import { astanaDate, dateLabel, locationImage, money } from "./lib";
import { ErrorBox, Icon, Link, Loading } from "./ui";

const STORAGE_KEY = "semka-shoot-brief-v1";
const MAX_SHOTS = 24;
const moods = {
  warm: { label: "Тёплый свет", image: "loft", locations: ["loft", "garden", "rooftop"], shots: ["Общий план пространства", "Портрет у окна", "Деталь в контровом свете"] },
  clean: { label: "Чистый фон", image: "cyclorama", locations: ["cyclorama", "loft"], shots: ["Ключевой кадр на чистом фоне", "Крупный план продукта", "Вертикальный кадр для соцсетей"] },
  urban: { label: "Город и фактура", image: "rooftop", locations: ["rooftop", "hangar", "loft"], shots: ["Общий план с городом или архитектурой", "Движение в кадре", "Крупный план фактуры"] },
  green: { label: "Среди зелени", image: "garden", locations: ["garden", "rooftop"], shots: ["Общий план среди растений", "Портрет в рассеянном свете", "Деталь переднего плана"] },
};

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    && value >= astanaDate() && value <= astanaDate(90);
}

function readBrief() {
  const defaults = { title: "", mood: "warm", date: astanaDate(1), duration: 2, crew: 4, budget: 0, shots: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaults;
    return {
      title: typeof saved.title === "string" ? saved.title.slice(0, 80) : "",
      mood: Object.hasOwn(moods, saved.mood) ? saved.mood : defaults.mood,
      date: validDate(saved.date) ? saved.date : defaults.date,
      duration: Number.isInteger(saved.duration) && saved.duration >= 1 && saved.duration <= 8 ? saved.duration : defaults.duration,
      crew: Number.isInteger(saved.crew) && saved.crew >= 1 && saved.crew <= 25 ? saved.crew : defaults.crew,
      budget: Number.isInteger(saved.budget) && saved.budget >= 0 && saved.budget <= 9999999 ? saved.budget : 0,
      shots: Array.isArray(saved.shots) ? saved.shots.filter((shot) => typeof shot?.id === "string" && typeof shot.text === "string")
        .slice(0, MAX_SHOTS).map(({ id, text, done }) => ({ id, text: text.slice(0, 140), done: done === true })) : [],
    };
  } catch { return defaults; }
}

function downloadBrief(brief, matches) {
  const lines = [
    brief.title.trim() || "План съёмки",
    `Стиль: ${moods[brief.mood].label}`,
    `Планируемая дата: ${dateLabel(brief.date)}`,
    `Длительность: ${brief.duration} ч · команда: ${brief.crew} чел.`,
    `Бюджет аренды: ${brief.budget ? money(brief.budget) : "без ограничения"}`,
    "", "Площадки для сравнения",
    ...matches.map((loc) => `- ${loc.name} · ${money(loc.price * brief.duration)} за ${brief.duration} ч`),
    ...(matches.length ? ["Проверьте свободные часы в планировщике перед заявкой."] : ["Под заданные условия нет площадок."]),
    "", "Шот-лист",
    ...brief.shots.map((shot) => `[${shot.done ? "x" : " "}] ${shot.text}`),
  ];
  const url = URL.createObjectURL(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "semka-shoot-brief.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Director({ locations, error, retry }) {
  const [brief, setBrief] = useState(readBrief);
  const [shotText, setShotText] = useState("");
  const mood = moods[brief.mood];
  const matching = locations.filter((loc) => loc.capacity >= brief.crew && (!brief.budget || loc.price * brief.duration <= brief.budget));
  const matches = mood.locations.map((id) => matching.find((loc) => loc.id === id)).filter(Boolean);
  const alternatives = !matches.length ? [...matching].sort((a, b) => a.price - b.price).slice(0, 3) : [];
  const shortlist = matches.length ? matches : alternatives;
  const planner = "/planner?" + new URLSearchParams({ locations: shortlist.map((loc) => loc.id).join(","), date: brief.date, duration: brief.duration });
  const completed = brief.shots.filter((shot) => shot.done).length;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(brief)); }
    catch { /* The brief remains available in this tab. */ }
  }, [brief]);

  function update(field, value) {
    setBrief((previous) => ({ ...previous, [field]: value }));
  }

  function addShots(labels) {
    const candidates = labels.map((text) => ({ id: crypto.randomUUID(), text, done: false }));
    setBrief((previous) => {
      const existing = new Set(previous.shots.map((shot) => shot.text));
      const added = candidates.filter(({ text }) => !existing.has(text)).slice(0, MAX_SHOTS - previous.shots.length);
      return { ...previous, shots: [...previous.shots, ...added] };
    });
  }

  return (
    <div className="director">
      <header className="director-hero">
        <img key={mood.image} src={`/images/${mood.image}.jpg`} alt="" />
        <div>
          <Link to="/#locations" className="director-back">← Каталог локаций</Link>
          <h1>Режиссёрская</h1>
          <p>Подберите место под идею и соберите шот-лист для команды.</p>
        </div>
      </header>
      <div className="director-layout">
        <section className="director-panel" aria-labelledby="brief-title">
          <h2 id="brief-title">Параметры съёмки</h2>
          <label className="director-field">Название проекта
            <input value={brief.title} maxLength={80} onChange={(event) => update("title", event.target.value)} placeholder="Например, портретная серия" />
          </label>
          <fieldset className="director-mood">
            <legend>Визуальный стиль</legend>
            <div>
              {Object.entries(moods).map(([id, item]) => (
                <label key={id} className="mood-option">
                  <input type="radio" name="mood" value={id} checked={id === brief.mood} onChange={() => update("mood", id)} />
                  <img src={`/images/${item.image}.jpg`} alt="" loading="lazy" />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="director-fields">
            <label className="director-field">Дата съёмки
              <input type="date" defaultValue={brief.date} min={astanaDate()} max={astanaDate(90)} onChange={(event) => {
                if (validDate(event.target.value)) update("date", event.target.value);
              }} onBlur={(event) => { if (!validDate(event.target.value)) event.target.value = brief.date; }} />
            </label>
            <label className="director-field">Длительность
              <select value={brief.duration} onChange={(event) => update("duration", Number(event.target.value))}>
                {Array.from({ length: 8 }, (_, index) => index + 1).map((hours) => <option key={hours} value={hours}>{hours} ч</option>)}
              </select>
            </label>
            <label className="director-field">Участников
              <input type="number" inputMode="numeric" min={1} max={25} defaultValue={brief.crew} onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isInteger(value) && value >= 1 && value <= 25) update("crew", value);
              }} onBlur={(event) => { event.target.value = brief.crew; }} />
            </label>
            <label className="director-field">Бюджет аренды, ₸
              <input type="number" inputMode="numeric" min={0} max={9999999} defaultValue={brief.budget || ""} placeholder="Без ограничения" onChange={(event) => {
                const value = event.target.value === "" ? 0 : event.target.valueAsNumber;
                if (Number.isInteger(value) && value >= 0 && value <= 9999999) update("budget", value);
              }} onBlur={(event) => { event.target.value = brief.budget || ""; }} />
            </label>
          </div>
        </section>
        <section className="director-panel director-shotlist" aria-labelledby="shots-title">
          <div className="director-panel-heading"><h2 id="shots-title">Шот-лист</h2><span aria-live="polite">{completed} из {brief.shots.length} готово</span></div>
          {brief.shots.length > 0 && <progress aria-label="Снятые кадры" max={brief.shots.length} value={completed} />}
          <p>Отметьте снятые кадры. План сохраняется в этом браузере.</p>
          <button type="button" className="button director-template" disabled={brief.shots.length === MAX_SHOTS || mood.shots.every((text) => brief.shots.some((shot) => shot.text === text))} onClick={() => addShots(mood.shots)}><Icon name="spark" size={17} /> Добавить кадры для стиля</button>
          <ul>
            {brief.shots.map((shot) => (
              <li key={shot.id}>
                <label><input type="checkbox" checked={shot.done} onChange={(event) => update("shots", brief.shots.map((item) => item.id === shot.id ? { ...item, done: event.target.checked } : item))} /><span>{shot.text}</span></label>
                <button type="button" aria-label={`Удалить кадр «${shot.text}»`} onClick={() => update("shots", brief.shots.filter(({ id }) => id !== shot.id))}><Icon name="close" size={17} /></button>
              </li>
            ))}
          </ul>
          <form className="director-add" onSubmit={(event) => {
            event.preventDefault();
            const text = shotText.trim();
            if (!text) return;
            addShots([text]);
            setShotText("");
          }}>
            <input aria-label="Новый кадр" placeholder="Что ещё нужно снять?" value={shotText} maxLength={140} onChange={(event) => setShotText(event.target.value)} />
            <button type="submit" aria-label="Добавить кадр" disabled={!shotText.trim() || brief.shots.length === MAX_SHOTS}><Icon name="plus" /></button>
          </form>
          <button type="button" className="button primary director-export" onClick={() => downloadBrief(brief, shortlist)}><Icon name="download" size={18} /> Скачать бриф</button>
        </section>
      </div>
      <section className="director-results" aria-labelledby="recommendations-title">
        <div className="director-panel-heading"><h2 id="recommendations-title">Подборка площадок</h2>{shortlist.length > 0 && <Link className="button primary" to={planner}>Проверить свободное время <Icon name="arrow" size={17} /></Link>}</div>
        {error ? <><ErrorBox>{error}</ErrorBox><button className="button" onClick={retry}>Повторить</button></> : !locations.length ? <Loading text="Загружаем площадки…" /> : (
          <>
            <p aria-live="polite">{matches.length ? `Подходят по стилю, вместимости и бюджету. Стоимость указана за ${brief.duration} ч.` : alternatives.length ? "Для выбранного стиля совпадений нет. Ниже площадки, подходящие по бюджету и вместимости." : "Площадок под эти условия нет. Измените бюджет, длительность или размер команды."}</p>
            <div className="director-result-grid">
              {shortlist.map((loc) => (
                <Link key={loc.id} className="director-result" to={`/locations/${loc.id}?` + new URLSearchParams({ date: brief.date, duration: brief.duration })}>
                  <img src={locationImage(loc)} alt="" loading="lazy" />
                  <div><span>{loc.type} · до {loc.capacity} чел.</span><h3>{loc.name}</h3><strong>{money(loc.price * brief.duration)}</strong><Icon name="diagonal" size={19} /></div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
