import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportCsv, calculate, validateDataset } from '../public/flow-core.mjs';
import { reportHtml, reportCss } from '../public/flow-report.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const at=(date,time='09:00')=>`${date}T${time}:00+05:00`;
const tasks=[
  ['S1-01','Клиент находит свободную локацию','Арсен','S1','2026-10-12','09:00','2026-10-12','17:00','2026-10-15','09:00','2026-10-15','13:00'],
  ['S1-02','Клиент оформляет заявку без двойного бронирования','Адильжан','S1','2026-10-12','09:00','2026-10-13','09:00','2026-10-15','13:00','2026-10-16','09:00'],
  ['S1-03','Клиент проверяет статус по личной ссылке','Арсен','S1','2026-10-13','09:00','2026-10-13','17:00','2026-10-16','09:00','2026-10-16','13:00'],
  ['S1-04','Администратор подтверждает заявку','Адильжан','S1','2026-10-14','09:00','2026-10-15','09:00','2026-10-16','13:00','2026-10-16','16:00'],
  ['S2-01','Клиент видит свои заявки в кабинете','Арсен','S2','2026-10-19','09:00','2026-10-20','09:00','2026-10-20','13:00','2026-10-21','09:00'],
  ['S2-02','Клиент видит понятный режим регистрации','Адильжан','S2','2026-10-19','09:00','2026-10-20','09:00','2026-10-20','13:00','2026-10-21','09:00'],
  ['S2-03','Администратор освобождает отменённый интервал','Адильжан','S2','2026-10-20','09:00','2026-10-21','09:00','2026-10-21','13:00','2026-10-22','09:00'],
  ['S2-04','Команда воспроизводит демонстрацию по инструкции','Арсен','S2','2026-10-20','09:00','2026-10-21','09:00','2026-10-21','13:00','2026-10-21','16:00']
].map(([id,title,owner,sprint,sd,st,rd,rt,td,tt,dd,dt])=>({ id,title,owner,sprint,serviceClass:'standard',acceptance:'Сквозной сценарий продемонстрирован; негативный сценарий проверен; результат связан с карточкой.',history:[{status:'backlog',at:at(sprint==='S1'?'2026-10-12':'2026-10-19')},{status:'ready',at:at(sprint==='S1'?'2026-10-12':'2026-10-19')},{status:'doing',at:at(sd,st)},{status:'review',at:at(rd,rt)},{status:'testing',at:at(td,tt)},{status:'done',at:at(dd,dt),evidence:{tests:true,docs:true,deployed:true,merged:true,reviewer:owner==='Арсен'?'Адильжан':'Арсен',link:'Учебное событие — фактической ссылки нет'}}]}));
const simulation={version:1,kind:'simulation',sprints:[
  {id:'S1',start:at('2026-10-12'),end:at('2026-10-16','17:00'),goal:'Клиент выбирает свободное время, создаёт заявку и проверяет её статус; администратор подтверждает её.'},
  {id:'S2',start:at('2026-10-19'),end:at('2026-10-23','17:00'),goal:'Клиент видит свои заявки и понятные ограничения входа, а отменённое время снова доступно.'}
],tasks};
const actual={version:1,kind:'actual',sprints:[
  {id:'S1',start:at('2026-11-02'),end:at('2026-11-06','17:00'),goal:'Клиент проходит локальный сценарий регистрации, входа и просмотра своих заявок.'},
  {id:'S2',start:at('2026-11-09'),end:at('2026-11-13','17:00'),goal:'Команда воспроизводит бронирование и обработку заявки на согласованном стенде и проверяет эффект правила ревью.'}
],tasks:[
  ['ACT-01','Клиент видит собственные заявки в кабинете','Арсен','S1','Две учётные записи видят только свои заявки; гость сохраняет бронирование по ссылке.'],
  ['ACT-02','Регистрация объясняет режим без SMS','Адильжан','S1','На хостинге без SMS нет недоступного шага; локальный код явно отмечен как демонстрационный.'],
  ['ACT-03','Команда проверяет вход и бронирование','Адильжан','S1','Автотесты и сборка проходят; результат второго человека и ссылка на стенд приложены.'],
  ['ACT-04','Команда ведёт даты и выгружает метрики','Арсен','S1','Переходы записываются в тот же день; JSON и CSV сохранены, рассчитаны метрики и CFD.'],
  ['RETRO-01','Ревью перед новой стандартной задачей','Арсен','S2','Предложение к ретро: проверить среднее время ревью ≤ 1 дня при throughput не ниже S1; принятие фиксируется отдельно.'],
  ['ACT-05','Клиент и администратор проходят демонстрацию','Арсен','S2','Есть независимая проверка сквозного сценария и ссылка на стенд; ограничения записаны.'],
  ['ACT-06','Команда сравнивает два реальных спринта','Адильжан','S2','В отчёте есть исходная выгрузка, среднее, p85, WIP, CFD, закон Литтла и объяснение результата.']
].map(([id,title,owner,sprint,acceptance])=>({id,title,owner,sprint,acceptance,serviceClass:id==='RETRO-01'?'fixed':'standard',history:[{status:'backlog',at:new Date().toISOString()}]}))};
const folder=resolve(root,'docs/labs/lz9');
await mkdir(folder,{recursive:true});
await mkdir(resolve(root,'public/lz9'),{recursive:true});
await writeFile(resolve(root,'public/flow-style.css'),reportCss+'\n');
if(process.argv[2]){
  const data=validateDataset(JSON.parse(await readFile(resolve(process.argv[2]),'utf8')));
  const output=resolve(process.argv[3]||resolve(folder,'actual-report.html'));
  await writeFile(output,reportHtml(data));
  console.log(`Report: ${output}`);
}else{
  for(const [name,data] of [['simulation',simulation],['board-template',actual]]){
    validateDataset(data);
    await writeFile(resolve(folder,`${name}.json`),JSON.stringify(data,null,2)+'\n');
    await writeFile(resolve(root,'public/lz9',`${name}.json`),JSON.stringify(data,null,2)+'\n');
  }
  await writeFile(resolve(folder,'simulation-transitions.csv'),exportCsv(simulation));
  await writeFile(resolve(folder,'simulation-report.html'),reportHtml(simulation,Date.parse('2026-10-30T12:00:00+05:00')));
  await writeFile(resolve(folder,'actual-transitions-template.csv'),exportCsv(actual));
  await writeFile(resolve(folder,'actual-metrics.json'),JSON.stringify({kind:'actual',status:'not_observed',note:'Фактические два спринта не подтверждены. Даты шаблона предложены, работа ещё не наблюдалась.'},null,2)+'\n');
  console.log(JSON.stringify(simulation.sprints.map(s=>{const m=calculate(simulation,s);return {sprint:s.id,throughput:m.throughput,mean:m.meanCycle,p85:m.p85,wip:m.averageWip,review:m.statusMean.review}}),null,2));
}
