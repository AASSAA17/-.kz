import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workDays,percentile,calculate,validateDataset,moveTask,exportCsv } from '../public/flow-core.mjs';
import { reportHtml } from '../public/flow-report.mjs';
const at=(date,time='09:00')=>`${date}T${time}:00+05:00`;
const sprint={id:'S1',start:at('2026-10-12'),end:at('2026-10-16','17:00'),goal:'Клиент создаёт заявку'};
const task=(id='T1',owner='Арсен',history=[{status:'backlog',at:sprint.start}])=>({id,title:'Учебная задача',owner,sprint:'S1',serviceClass:'standard',acceptance:'Сквозной сценарий',history});
const dataset=tasks=>({version:1,kind:'actual',sprints:[sprint],tasks});
test('working calendar excludes nights and weekends; p85 matches inclusive interpolation',()=>{
  assert.equal(workDays(at('2026-10-16','13:00'),at('2026-10-19','13:00')),1);
  assert.equal(workDays(at('2026-10-12'),at('2026-10-16','17:00')),5);
  assert.equal(workDays(at('2026-10-17'),at('2026-10-18','17:00')),0);
  assert.equal(percentile([1,2,3,4]),3.55);assert.equal(percentile([]),null);
});
test('WIP is time-weighted and includes carry-over; completion cohort crosses sprint tags',()=>{
  const data=dataset([
    task('carry','Арсен',[{status:'backlog',at:at('2026-10-09')},{status:'doing',at:at('2026-10-09')},{status:'done',at:at('2026-10-12','17:00')}]),
    task('open','Адильжан',[{status:'backlog',at:sprint.start},{status:'doing',at:at('2026-10-16')}]),
  ]);
  const m=calculate(data,sprint);assert.equal(m.throughput,1);assert.equal(m.meanCycle,2);assert.equal(m.averageWip,.4);
  assert.equal(m.ages[0].age,1);assert.equal(m.little.observed,m.little.expected);
  assert.equal(m.daily.length,5);
});
test('empty and not-yet-started sprints have no invented cycle values',()=>{
  const m=calculate(dataset([]),sprint,Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(m.throughput,0);assert.equal(m.p85,null);assert.equal(m.averageWip,null);
});
test('board rejects per-person WIP overflow and missing Done evidence',()=>{
  const data=dataset([task('a'),task('b'),task('c')]);
  let moved=data;
  for(const id of ['a','b']){moved=moveTask(moved,id,'ready',sprint.start);moved=moveTask(moved,id,'doing',sprint.start);}
  moved=moveTask(moved,'c','ready',sprint.start);
  assert.throws(()=>moveTask(moved,'c','doing',sprint.start),/две задачи/);
  moved=moveTask(moved,'a','review',sprint.start);moved=moveTask(moved,'a','testing',sprint.start);
  assert.throws(()=>moveTask(moved,'a','done',sprint.start),/Для Done/);
  const done=moveTask(moved,'a','done',sprint.start,{tests:true,docs:true,merged:true,deployed:true,reviewer:'Адильжан',link:'https://example.test/review'});
  assert.throws(()=>moveTask(done,'a','testing',sprint.start),/Done окончателен/);
});
test('invalid imports fail and embedded text is escaped in the report',()=>{
  const bad=dataset([task()]);bad.tasks[0].history.push({status:'doing',at:'yesterday'});assert.throws(()=>validateDataset(bad));
  const data=dataset([task()]);data.sprints[0]={...sprint,goal:'<script>alert(1)</script>'};
  assert.ok(!reportHtml(data).includes('<script>'));assert.ok(reportHtml(data).includes('&lt;script&gt;'));
  assert.match(exportCsv(data),/"kind","id"/);
  data.tasks[0].title='=HYPERLINK("https://example.test")';
  assert.ok(exportCsv(data).includes("'=HYPERLINK"),'spreadsheet formulas in user text are neutralized');
});
test('review, testing and expedite limits reject new work at capacity',()=>{
  const withStatus=(id,status)=>task(id,'Арсен',[{status:'backlog',at:sprint.start},{status:'doing',at:sprint.start},...(status==='doing'?[]:[{status,at:sprint.start}])]);
  const review=dataset([withStatus('r1','review'),withStatus('r2','review'),withStatus('r3','review'),withStatus('new','doing')]);
  assert.throws(()=>moveTask(review,'new','review',sprint.start),/WIP-лимит/);
  const testing=dataset([withStatus('t1','testing'),withStatus('t2','testing'),withStatus('new','review')]);
  assert.throws(()=>moveTask(testing,'new','testing',sprint.start),/WIP-лимит/);
  const urgent=dataset([withStatus('u1','review'),task('u2','Адильжан',[{status:'backlog',at:sprint.start},{status:'ready',at:sprint.start}])]);
  urgent.tasks.forEach(t=>t.serviceClass='expedite');
  assert.throws(()=>moveTask(urgent,'u2','doing',sprint.start),/одна срочная/);
});
test('published simulation is reproducible and has the intended bottleneck',async()=>{
  const data=JSON.parse(await readFile(new URL('../public/lz9/simulation.json',import.meta.url),'utf8'));
  const [a,b]=data.sprints.map(s=>calculate(data,s));assert.equal(data.kind,'simulation');
  assert.equal(a.throughput,4);assert.equal(b.throughput,4);assert.equal(a.meanCycle,3.46875);assert.equal(a.p85,3.775);
  assert.equal(a.statusMean.review,2);assert.equal(b.statusMean.review,.5);
  assert.equal(a.averageWip,2.775);assert.equal(b.averageWip,1.575);
  assert.equal(a.statusMean.doing,b.statusMean.doing);assert.equal(a.statusMean.testing,b.statusMean.testing);
  assert.equal(a.meanCycle-b.meanCycle,a.statusMean.review-b.statusMean.review);
});
