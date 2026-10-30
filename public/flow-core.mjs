// Shared by the browser board and the reproducible lab report. No dependencies.
export const STATUSES = ['backlog', 'ready', 'doing', 'review', 'testing', 'done'];
export const LABELS = { backlog: 'Бэклог', ready: 'Готово к работе', doing: 'В работе', review: 'Ожидает ревью', testing: 'Проверка и стенд', done: 'Готово' };
export const ACTIVE = ['doing', 'review', 'testing'];
const DAY = 86400000;
const parse = value => Date.parse(value);
const validTime = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(parse(value));

export function validateDataset(data) {
  if (!data || data.version !== 1 || !['actual', 'simulation'].includes(data.kind) || !Array.isArray(data.tasks) || !Array.isArray(data.sprints)) throw new Error('Нужна выгрузка доски версии 1 с типом actual или simulation.');
  if (data.tasks.length > 1000 || data.sprints.length > 20) throw new Error('Слишком большая выгрузка.');
  const sprintIds = new Set();
  for (const s of data.sprints) {
    if (!s.id || sprintIds.has(s.id) || !validTime(s.start) || !validTime(s.end) || parse(s.end) <= parse(s.start) || parse(s.end) - parse(s.start) > 90 * DAY || !s.goal) throw new Error('Проверьте уникальность, цель и даты спринтов (до 90 дней).');
    sprintIds.add(s.id);
  }
  const ids = new Set();
  let totalEvents = 0;
  for (const task of data.tasks) {
    if (typeof task.id !== 'string' || ids.has(task.id) || !task.title || !task.owner || !sprintIds.has(task.sprint) || !['standard','fixed','expedite','minor'].includes(task.serviceClass) || !Array.isArray(task.history) || !task.history.length || task.history.length > 1000) throw new Error('Проверьте карточки: ID, название, владельца, спринт, класс и историю.');
    ids.add(task.id);
    totalEvents += task.history.length;
    if (totalEvents > 10000 || parse(task.history.at(-1).at) - parse(task.history[0].at) > 366 * DAY) throw new Error('История ограничена 10 000 переходов и годом на карточку.');
    let previous = -Infinity;
    let done = false, started = false;
    for (const event of task.history) {
      if (!STATUSES.includes(event.status) || !validTime(event.at) || parse(event.at) < previous || done) throw new Error(`Некорректная история ${task.id}. После Done создайте отдельную карточку дефекта.`);
      previous = parse(event.at);
      if (started && ['backlog','ready'].includes(event.status)) throw new Error(`${task.id}: начатая карточка остаётся в активном потоке; возврат — в doing.`);
      if (event.status === 'doing') started = true;
      done = event.status === 'done';
    }
    if (task.history[0].status !== 'backlog') throw new Error(`${task.id}: история начинается с backlog.`);
    if (task.history.some(e => ['review','testing','done'].includes(e.status)) && !task.history.some(e => e.status === 'doing')) throw new Error(`${task.id}: отсутствует начало работы.`);
  }
  return data;
}

// One working day = 8h, Mon–Fri 09:00–17:00 UTC+05. Public holidays are not inferred.
export function workDays(from, to) {
  let start = typeof from === 'number' ? from : parse(from);
  const end = typeof to === 'number' ? to : parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Некорректный интервал времени.');
  let total = 0;
  while (start < end) {
    const local = new Date(start + 5 * 3600000);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 5 * 3600000;
    const next = midnight + DAY;
    if (![0, 6].includes(local.getUTCDay())) total += Math.max(0, Math.min(end, midnight + 17 * 3600000) - Math.max(start, midnight + 9 * 3600000));
    start = next;
  }
  return total / (8 * 3600000);
}
export function percentile(values, p = .85) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
export function stateAt(task, at = Infinity) {
  return task.history.filter(e => parse(e.at) <= at).at(-1)?.status ?? null;
}
const mean = a => a.length ? a.reduce((x,y) => x+y, 0) / a.length : null;
export function taskMetrics(task, cutoff) {
  const events = task.history.filter(e => parse(e.at) <= cutoff);
  const start = events.find(e => e.status === 'doing');
  const done = events.find(e => e.status === 'done');
  const end = done ? parse(done.at) : cutoff;
  const times = Object.fromEntries(ACTIVE.map(s => [s, 0]));
  events.forEach((e, i) => { if (e.status in times) times[e.status] += workDays(parse(e.at), Math.min(parse(events[i+1]?.at) || end, end)); });
  return { id: task.id, title: task.title, owner: task.owner, start: start?.at ?? null, done: done?.at ?? null,
    cycle: start && done ? workDays(start.at, done.at) : null,
    age: start && !done ? workDays(start.at, cutoff) : null, status: stateAt(task, cutoff), times };
}
export function calculate(data, sprint, asOf = Infinity) {
  validateDataset(data);
  const from = parse(sprint.start), to = Math.min(parse(sprint.end), asOf);
  const duration = to > from ? workDays(from, to) : 0;
  if (to <= from) return { sprint, duration: 0, completed: [], ages: [], throughput: 0, meanCycle: null, p85: null, averageWip: null, statusWip: {}, statusMean: {}, daily: [], little: null };
  // Count by completion interval, including carry-over; sprint tags do not hide work.
  const rows = data.tasks.map(t => taskMetrics(t, to));
  const completed = rows.filter(r => r.done && parse(r.done) >= from && parse(r.done) < to);
  const statusArea = Object.fromEntries(ACTIVE.map(s => [s, 0]));
  for (const task of data.tasks) task.history.forEach((e, i) => {
    if (!(e.status in statusArea)) return;
    const a = Math.max(from, parse(e.at)), b = Math.min(to, parse(task.history[i+1]?.at) || to);
    if (a < b) statusArea[e.status] += workDays(a, b);
  });
  const statusWip = Object.fromEntries(ACTIVE.map(s => [s, duration ? statusArea[s] / duration : null]));
  const statusMean = Object.fromEntries(ACTIVE.map(s => [s, mean(completed.map(r => r.times[s]))]));
  const daily = [];
  let day = parse(new Date(from + 5 * 3600000).toISOString().slice(0,10) + 'T00:00:00+05:00');
  while (day < to) {
    const dayEnd = Math.min(to, day + 17 * 3600000);
    const weekday = new Date(day + 5 * 3600000).getUTCDay();
    if (![0,6].includes(weekday) && dayEnd > from) {
      const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
      for (const task of data.tasks) { const status = stateAt(task, dayEnd - 1); if (status) counts[status]++; }
      daily.push({ date: new Date(day + 5 * 3600000).toISOString().slice(0,10), ...counts });
    }
    day += DAY;
  }
  const averageWip = duration ? Object.values(statusArea).reduce((a,b) => a+b,0) / duration : null;
  const meanCycle = mean(completed.map(r => r.cycle));
  const little = duration && meanCycle !== null ? { observed: averageWip, expected: completed.length / duration * meanCycle, residual: averageWip - completed.length / duration * meanCycle } : null;
  return { sprint, duration, throughput: completed.length, meanCycle, p85: percentile(completed.map(r=>r.cycle)), averageWip, statusWip, statusMean, completed,
    ages: rows.filter(r => r.age !== null).sort((a,b)=>b.age-a.age), daily, little };
}
export function moveTask(data, id, status, at = new Date().toISOString(), evidence = {}) {
  validateDataset(data);
  const task = data.tasks.find(t => t.id === id);
  if (!task || !STATUSES.includes(status)) throw new Error('Карточка или статус не найдены.');
  const current = task.history.at(-1).status;
  if (current === 'done' || current === status || Math.abs(STATUSES.indexOf(current)-STATUSES.indexOf(status)) !== 1) throw new Error('Переводите карточку в соседний столбец; Done окончателен.');
  if (current === 'doing' && status === 'ready') throw new Error('Начатая задача остаётся в активном потоке до Done.');
  if (!validTime(at) || parse(at) < parse(task.history.at(-1).at)) throw new Error('Дата перехода раньше предыдущей.');
  const rest = data.tasks.filter(t => t.id !== id);
  const inStatus = rest.filter(t => stateAt(t) === status);
  const cap = { doing: 4, review: 3, testing: 2 }[status];
  if (cap && inStatus.length >= cap) throw new Error(`WIP-лимит «${LABELS[status]}»: ${cap}. Помогите завершить начатое.`);
  if (status === 'doing' && inStatus.filter(t => t.owner === task.owner).length >= 2) throw new Error('Лимит: две задачи в работе на человека.');
  if (ACTIVE.includes(status) && task.serviceClass === 'expedite' && rest.some(t=>t.serviceClass==='expedite' && ACTIVE.includes(stateAt(t)))) throw new Error('Лимит: одна срочная задача на всю команду.');
  if (status === 'ready' && !task.acceptance?.trim()) throw new Error('Добавьте проверяемые критерии приёмки.');
  if (status === 'done' && (!evidence.tests || !evidence.docs || !evidence.deployed || !evidence.merged || !evidence.reviewer?.trim() || evidence.reviewer.trim() === task.owner || !evidence.link?.trim())) throw new Error('Для Done нужны тесты, документация, основная ветка, стенд, ревью другим человеком и ссылка на результат.');
  const next = structuredClone(data);
  next.tasks.find(t=>t.id===id).history.push({ status, at, ...(status==='done'?{evidence}:{}) });
  return validateDataset(next);
}
const cell = value => { const s = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"','""') + '"'; };
export function exportCsv(data) {
  validateDataset(data);
  const header = ['kind','id','title','owner','sprint','class','status','at','acceptance'];
  return '\uFEFF' + [header, ...data.tasks.flatMap(t=>t.history.map(e=>[data.kind,t.id,t.title,t.owner,t.sprint,t.serviceClass,e.status,e.at,t.acceptance||'']))].map(r=>r.map(cell).join(',')).join('\r\n');
}
export const fmt = n => n === null || n === undefined ? '—' : (Math.abs(n) < .005 ? 0 : Number(n)).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cfdSvg(points) {
  if (!points.length) return '<p>Нет данных для диаграммы.</p>';
  const width=800, height=260, left=42, top=12, plotW=730, plotH=205;
  const order=['done','testing','review','doing','ready','backlog'];
  const colors=['#426c52','#91b99a','#edbd68','#d66948','#a7b3cb','#e2e5ea'];
  const max=Math.max(1,...points.map(p=>STATUSES.reduce((a,s)=>a+p[s],0)));
  const x=i=>left+i*plotW/Math.max(1,points.length-1), y=n=>top+plotH-n/max*plotH;
  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="CFD: число карточек по состояниям на конец рабочего дня"><title>Кумулятивная диаграмма потока</title>`;
  let sums=points.map(()=>0);
  order.forEach((s,k)=>{const upper=points.map((p,i)=>sums[i]+p[s]); const coords=upper.map((n,i)=>`${x(i)},${y(n)}`).concat([...sums].reverse().map((n,i)=>`${x(points.length-1-i)},${y(n)}`)); svg+=`<polygon fill="${colors[k]}" points="${coords.join(' ')}"/>`; sums=upper;});
  svg+=`<path d="M${left},${top}V${top+plotH}H${left+plotW}" fill="none" stroke="#59616b"/>`;
  for(let i=0;i<=4;i++) {const n=max*i/4; svg+=`<text x="${left-8}" y="${y(n)+4}" text-anchor="end" font-size="11">${fmt(n)}</text>`;}
  points.forEach((p,i)=>{if(i%Math.max(1,Math.ceil(points.length/8))===0||i===points.length-1) svg+=`<text x="${x(i)}" y="239" text-anchor="middle" font-size="11">${escapeHtml(p.date.slice(5))}</text>`;});
  return svg+'</svg><p class="legend">'+order.map((s,i)=>`<span><i style="background:${colors[i]}"></i>${LABELS[s]}</span>`).join(' ')+'</p>';
}
