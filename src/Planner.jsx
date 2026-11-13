import React, { useEffect, useRef, useState } from "react";
import { api, astanaDate, dateLabel, locationImage, money } from "./lib";
import { ErrorBox, Icon, Link, Loading } from "./ui";

const MAX_LOCATIONS = 3;
const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

function validStart(value) {
  const day = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= astanaDate() && value <= astanaDate(90)
    && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

function moveDate(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function bookingLink(id, date, duration, time) {
  return `/locations/${id}?` + new URLSearchParams({ date, duration, time });
}

export default function Planner({ locations, error, retry }) {
  if (error) return <section className="section"><ErrorBox>{error}</ErrorBox><button className="button" onClick={retry}>Загрузить площадки снова</button></section>;
  if (!locations.length) return <Loading text="Загружаем планировщик…" />;
  return <Schedule locations={locations} />;
}

function Schedule({ locations }) {
  const params = new URLSearchParams(window.location.search);
  const [date, setDate] = useState(() => validStart(params.get("date")) ? params.get("date") : astanaDate(1));
  const [duration, setDuration] = useState(() => /^[1-8]$/.test(params.get("duration")) ? Number(params.get("duration")) : 2);
  const [selected, setSelected] = useState(() => {
    const ids = [...new Set((params.get("locations") || "").split(","))]
      .filter((id) => locations.some((location) => location.id === id));
    return ids.length ? ids.slice(0, MAX_LOCATIONS) : locations.slice(0, 2).map(({ id }) => id);
  });
  const [commonOnly, setCommonOnly] = useState(() => params.get("common") === "1");
  const [response, setResponse] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [share, setShare] = useState(null);
  const dateInput = useRef(null);
  const query = new URLSearchParams({ date, duration, locations: selected.join(",") }).toString();
  const showCommon = commonOnly && selected.length > 1;
  const planPath = `/planner?${query}${showCommon ? "&common=1" : ""}`;
  const shareUrl = window.location.origin + planPath;
  const current = response?.query === query && response.refresh === refresh ? response : null;
  const schedule = current?.data;
  const sameTimes = schedule?.days.map((_, index) => {
    const schedules = schedule.locations.map((item) => item.schedule[index].times);
    return schedules[0].filter((time) => schedules.every((times) => times.includes(time)));
  });

  useEffect(() => {
    const controller = new AbortController();
    api(`/locations/week?${query}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResponse({ query, refresh, data }); })
      .catch((error) => { if (!controller.signal.aborted) setResponse({ query, refresh, error: error.message }); });
    return () => controller.abort();
  }, [query, refresh]);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", planPath);
  }, [planPath]);

  function toggleLocation(id) {
    const active = selected.includes(id);
    if ((active && selected.length === 1) || (!active && selected.length === MAX_LOCATIONS)) return;
    setSelected(active ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  function changeWeek(offset) {
    const next = moveDate(date, offset);
    const bounded = next < astanaDate() ? astanaDate() : next > astanaDate(90) ? astanaDate(90) : next;
    dateInput.current.value = bounded;
    setDate(bounded);
  }

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShare({ planPath, copied: true });
    } catch {
      setShare({ planPath, copied: false });
    }
  }

  const cheapest = schedule?.locations.reduce((best, item) => {
    const index = item.schedule.findIndex(({ times }, index) => (showCommon ? sameTimes[index] : times).length);
    if (index === -1 || (best && best.total <= item.total)) return best;
    const day = item.schedule[index];
    return { id: item.id, total: item.total, date: day.date, time: (showCommon ? sameTimes[index] : day.times)[0] };
  }, null);
  const byId = new Map(locations.map((loc) => [loc.id, loc]));

  return (
    <section className="planner" aria-labelledby="planner-title">
      <Link to="/#locations" className="planner-back">← Каталог локаций</Link>
      <header className="planner-heading">
        <div>
          <h1 id="planner-title">Планировщик <em>съёмки</em></h1>
          <p>Сравните до трёх локаций, найдите свободное время и поделитесь планом с командой.</p>
        </div>
        <button type="button" className="button planner-share" onClick={copyPlan}><Icon name="share" size={18} /> Скопировать ссылку</button>
      </header>
      <div aria-live="polite">
        {share?.planPath === planPath && (share.copied ? <p className="planner-copy">Ссылка на план скопирована.</p> : (
          <label className="planner-copy">Ссылка на план <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></label>
        ))}
      </div>
      <div className="planner-controls">
        <fieldset>
          <legend>Локации <span>{selected.length} из {MAX_LOCATIONS}</span></legend>
          <div className="planner-options">
            {locations.map((loc) => {
              const active = selected.includes(loc.id);
              return <button key={loc.id} type="button" aria-pressed={active} disabled={(active && selected.length === 1) || (!active && selected.length === MAX_LOCATIONS)} onClick={() => toggleLocation(loc.id)}>
                {active && <Icon name="check" size={15} />} {loc.name}
              </button>;
            })}
          </div>
        </fieldset>
        <div className="planner-fields">
          <label>Длительность съёмки
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              {Array.from({ length: 8 }, (_, index) => index + 1).map((hours) => <option key={hours} value={hours}>{hours} ч</option>)}
            </select>
          </label>
          <label>Начало недели
            <input type="date" ref={dateInput} defaultValue={date} min={astanaDate()} max={astanaDate(90)} onChange={(event) => {
              if (validStart(event.target.value)) setDate(event.target.value);
            }} onBlur={(event) => { if (!validStart(event.target.value)) event.target.value = date; }} />
          </label>
        </div>
      </div>
      {cheapest && (
        <div className="planner-highlight">
          <Icon name="calendar" size={23} />
          <div><span>Самая доступная цена среди выбранных</span><strong>{byId.get(cheapest.id).name} · {money(cheapest.total)} за {duration} ч</strong></div>
          <Link to={bookingLink(cheapest.id, cheapest.date, duration, cheapest.time)}>{dateLabel(cheapest.date)} в {cheapest.time} <Icon name="arrow" size={17} /></Link>
        </div>
      )}
      <div className="planner-week">
        <div><h2>Свободное время</h2><p>Время Астаны (UTC+5)</p></div>
        <div className="planner-week-actions">
          {selected.length > 1 && <label className="planner-common"><input type="checkbox" checked={showCommon} onChange={(event) => setCommonOnly(event.target.checked)} /> Только общие слоты</label>}
          <button type="button" className="planner-icon-button" aria-label="Предыдущая неделя" disabled={date <= astanaDate()} onClick={() => changeWeek(-7)}><Icon name="left" /></button>
          <button type="button" className="planner-icon-button" aria-label="Следующая неделя" disabled={date >= astanaDate(90)} onClick={() => changeWeek(7)}><Icon name="right" /></button>
          <button type="button" className="button planner-refresh" onClick={() => setRefresh((value) => value + 1)}>Обновить</button>
        </div>
      </div>
      {current?.error ? <ErrorBox>{current.error}</ErrorBox> : !schedule ? <Loading text="Проверяем расписание…" /> : (
        <>
          {!cheapest && <p role="status">{showCommon ? "Общих интервалов нет. Отключите фильтр, чтобы увидеть расписание каждой площадки." : "На эти даты нет свободных интервалов. Попробуйте сократить съёмку или выбрать другую неделю."}</p>}
          <p className="planner-scroll-hint">Прокрутите расписание вправо, чтобы увидеть остальные дни.</p>
          <div className="planner-table-scroll" tabIndex={0} role="region" aria-label="Недельное расписание локаций">
            <table className="planner-table">
              <caption className="sr-only">Свободное начало съёмки длительностью {duration} ч</caption>
              <thead><tr><th scope="col">Площадка</th>{schedule.days.map((day) => <th scope="col" key={day}><span>{weekday.format(new Date(day))}</span>{dayNumber.format(new Date(day))}</th>)}</tr></thead>
              <tbody>
                {schedule.locations.map(({ id, total, schedule: days }) => {
                  const loc = byId.get(id);
                  return (
                    <tr key={id}>
                      <th scope="row">
                        <img src={locationImage(loc)} alt="" width="144" height="72" loading="lazy" />
                        <Link to={`/locations/${id}`}>{loc.name}</Link>
                        <span>{loc.area} м² · до {loc.capacity} чел.</span>
                        <strong>{money(total)}</strong><small> за {duration} ч</small>
                      </th>
                      {days.map(({ date, times }, index) => {
                        const displayed = showCommon ? sameTimes[index] : times;
                        return (
                          <td key={date}>
                            {displayed.length ? <div className="planner-times">
                              {displayed.map((time) => <Link key={time} to={bookingLink(id, date, duration, time)} aria-label={`${loc.name}, ${dateLabel(date)}, ${time}`}>{time}</Link>)}
                            </div> : <span className="planner-unavailable" aria-label="Свободных интервалов нет">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="planner-note">Выберите время, чтобы перейти к заявке. Наличие проверяется повторно при бронировании.</p>
        </>
      )}
    </section>
  );
}
