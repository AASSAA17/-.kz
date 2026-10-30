import { STATUSES,LABELS,ACTIVE,stateAt,moveTask,exportCsv,escapeHtml as e,validateDataset } from './flow-core.mjs';
import { reportBody,reportHtml } from './flow-report.mjs';
const $=id=>document.getElementById(id), key=kind=>`semka-flow-v1-${kind}`;
let data, kind='actual', stale=false;
const tell=message=>{$('feedback').textContent=message;};
const save=()=>{localStorage.setItem(key(kind),JSON.stringify(data));};
function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function render(){
  $('mode').textContent=kind==='simulation'?'УЧЕБНЫЙ ПРИМЕР — смоделированные даты, не факт работы команды':'РАБОЧАЯ ДОСКА — фактические переходы с текущим временем';
  $('mode').parentElement.classList.toggle('simulation',kind==='simulation');
  const now=Date.now();
  $('board').innerHTML=STATUSES.map(status=>{
    const tasks=data.tasks.filter(t=>stateAt(t)===status), limit={doing:4,review:3,testing:2}[status];
    return `<section class="column" aria-label="${LABELS[status]}"><h3>${LABELS[status]} · ${tasks.length}${limit?` / ${limit}`:''}</h3>${tasks.map(t=>`<article class="task"><div class="task-meta">${e(t.id)} · ${e(t.sprint)}</div><p class="task-title">${e(t.title)}</p><p class="task-meta">${e(t.owner)} · ${{standard:'Стандартный',fixed:'Фиксированная дата',expedite:'Срочный',minor:'Незначительный'}[t.serviceClass]}</p><details><summary>Приёмка и история</summary><p>${e(t.acceptance)}</p>${t.history.map(h=>`<p>${LABELS[h.status]}<br>${e(h.at)}${h.evidence?.link?'<br>'+e(h.evidence.link):''}</p>`).join('')}</details>${status!=='done'&&kind==='actual'?`<label class="task-meta">Перевести<select data-move="${e(t.id)}"><option value="">Выберите этап</option>${STATUSES.filter(s=>Math.abs(STATUSES.indexOf(s)-STATUSES.indexOf(status))===1).map(s=>`<option value="${s}">${LABELS[s]}</option>`).join('')}</select></label>`:''}</article>`).join('')||'<p class="task-meta">Пока нет карточек</p>'}</section>`;
  }).join('');
  $('metrics').innerHTML=reportBody(data,now);
  $('task-sprint').innerHTML=data.sprints.map(s=>`<option>${e(s.id)}</option>`).join('');
  $('sprint-form').innerHTML='<h3>Периоды и цели (UTC+05)</h3>'+data.sprints.map((s,i)=>`<label>${e(s.id)} начало<input name="start-${i}" type="datetime-local" value="${new Date(Date.parse(s.start)+5*3600000).toISOString().slice(0,16)}" required></label><label>${e(s.id)} конец<input name="end-${i}" type="datetime-local" value="${new Date(Date.parse(s.end)+5*3600000).toISOString().slice(0,16)}" required></label><label>${e(s.id)} цель<textarea name="goal-${i}" required maxlength="1000">${e(s.goal)}</textarea></label>`).join('')+'<button>Сохранить периоды и цели</button>';
  for(const form of [$('task-form'),$('sprint-form')]) for(const el of form.elements) el.disabled=kind==='simulation';
}
async function open(next){
  const stored=next==='simulation'?null:localStorage.getItem(key(next));
  const loaded=stored?JSON.parse(stored):await fetch(`/lz9/${next==='actual'?'board-template':'simulation'}.json`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Не удалось загрузить доску.');return r.json();});
  validateDataset(loaded); if(loaded.kind!==next)throw new Error('Тип сохранённых данных не совпадает.');
  // Initial backlog creation is recorded on first use of this browser, not backdated.
  if(!stored&&next==='actual') loaded.tasks.forEach(t=>t.history=[{status:'backlog',at:new Date().toISOString()}]);
  data=loaded;kind=next;stale=false;save();render();tell(next==='simulation'?'Пример доступен для просмотра и выгрузки. Рабочая доска сохранена отдельно.':'Доска открыта. Сохраняйте ежедневную выгрузку.');
}
function run(fn){return async event=>{try{await fn(event);}catch(err){tell(err.message);}};}
function requireFresh(){if(stale||localStorage.getItem(key(kind))!==JSON.stringify(data))throw new Error('Доска изменена в другой вкладке. Откройте её заново перед изменениями.');}
$('actual').onclick=run(()=>open('actual'));
$('demo').onclick=run(()=>open('simulation'));
$('export-json').onclick=()=>download(`semka-${kind}.json`,JSON.stringify(data,null,2),'application/json');
$('export-csv').onclick=()=>download(`semka-${kind}-transitions.csv`,exportCsv(data),'text/csv;charset=utf-8');
$('export-report').onclick=()=>download(`semka-${kind}-report.html`,reportHtml(data),'text/html;charset=utf-8');
$('import').onchange=run(async event=>{
  const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('Файл должен быть меньше 2 МБ.');
  const imported=validateDataset(JSON.parse(await file.text()));
  if(localStorage.getItem(key(imported.kind))) download(`semka-${imported.kind}-backup.json`,localStorage.getItem(key(imported.kind)),'application/json');
  const previous=data, previousKind=kind;
  try{data=imported;kind=data.kind;save();render();tell('История импортирована; прежняя версия выгружена резервной копией.');}
  catch(error){data=previous;kind=previousKind;throw error;}
  event.target.value='';
});
$('board').onchange=run(event=>{
  requireFresh();
  const id=event.target.dataset.move,status=event.target.value;if(!id||!status)return;
  let evidence={};
  if(status==='done'){
    const task=data.tasks.find(t=>t.id===id);
    const reviewer=prompt(`Кто проверил результат ${task.id}? Укажите имя второго участника.`);
    if(reviewer===null){render();return;}
    const link=prompt('Ссылка на результат: PR, коммит или протокол со ссылкой на проверенный стенд.');
    if(link===null){render();return;}
    if(!confirm('Подтверждаете: тесты пройдены, ревью выполнено другим человеком, код в основной ветке, документация обновлена, развёртывание на стенде проверено?')){render();return;}
    evidence={reviewer,link,tests:true,docs:true,deployed:true,merged:true};
  }
  const next=moveTask(data,id,status,new Date().toISOString(),evidence);
  localStorage.setItem(key(kind),JSON.stringify(next));data=next;render();tell(`${id}: ${LABELS[status]}. Время перехода записано.`);
});
$('task-form').onsubmit=run(event=>{
  event.preventDefault();if(kind!=='actual')return;requireFresh();
  const f=new FormData(event.target),title=f.get('title').trim(),acceptance=f.get('acceptance').trim();
  if(!title||!acceptance)throw new Error('Заполните название и приёмку.');
  const next=structuredClone(data);next.tasks.push({id:'TASK-'+crypto.randomUUID().slice(0,8),title,acceptance,owner:f.get('owner'),sprint:f.get('sprint'),serviceClass:f.get('serviceClass'),history:[{status:'backlog',at:new Date().toISOString()}]});
  validateDataset(next);localStorage.setItem(key(kind),JSON.stringify(next));data=next;event.target.reset();render();tell('Карточка добавлена в бэклог.');
});
$('sprint-form').onsubmit=run(event=>{
  event.preventDefault();if(kind!=='actual')return;requireFresh();
  const f=new FormData(event.target),next=structuredClone(data);
  next.sprints=next.sprints.map((s,i)=>({...s,start:f.get(`start-${i}`)+':00+05:00',end:f.get(`end-${i}`)+':00+05:00',goal:f.get(`goal-${i}`).trim()}));
  validateDataset(next);
  const sorted=[...next.sprints].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  if(sorted.some((s,i)=>i&&Date.parse(s.start)<Date.parse(sorted[i-1].end)))throw new Error('Спринты не должны пересекаться.');
  localStorage.setItem(key(kind),JSON.stringify(next));data=next;render();tell('Периоды и цели сохранены.');
});
window.addEventListener('storage',event=>{if(event.key===key(kind)){stale=true;$('board').innerHTML='';tell('Доска изменена в другой вкладке. Откройте рабочую доску заново перед изменениями.');}});
open('actual').catch(err=>tell(`Доска недоступна: ${err.message}. Проверьте разрешение на локальное хранение.`));
