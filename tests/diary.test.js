import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=mkdtempSync(path.join(tmpdir(),'praktika-diary-test-')),base='http://127.0.0.1:3403/api';
let server,errors='';
async function request(url,method='GET',body,cookie='') {
 const r=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const result={status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 assert.ok(result.status<500,`${url}: ${errors}`);return result;
}
async function start(){errors='';server=spawn(process.execPath,['tests/fixtures/start-server.js'],{cwd:root,env:{...process.env,PORT:'3403',DATA_DIR:directory},stdio:'pipe'});server.stderr.on('data',s=>errors+=s);for(let i=0;i<100;i++){try{if((await request('/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(errors);}
async function stop(){if(server?.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill();await ended;}}
const login=async email=>(await request('/auth/login','POST',{email,password:'Demo2026!'})).cookie;
before(start);
after(async()=>{await stop();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('praktika-diary-test-'));rmSync(resolved,{recursive:true,force:true});});
test('Diary: draft, review, revisions, hours, isolation, completed exports and restart',async()=>{
 const student=await login('student5@example.test'),coordinator=await login('coordinator1@example.test'),organization=await login('organization1@example.test'),stranger=await login('student1@example.test');
 const foreign=(await request('/auth/register','POST',{name:'Другой куратор',email:'diary-foreign@example.test',password:'Password2026!',role:'coordinator',college_name:'Другой колледж'})).cookie;
 const a=(await request('/applications','GET',undefined,student)).data.find(a=>a.status==='accepted'),url='/applications/'+a.id+'/diary';
 assert.equal((await request(url)).status,401);
 for(const cookie of [organization,stranger,foreign])assert.equal((await request(url,'GET',undefined,cookie)).status,404);
 assert.equal((await request('/diaries','GET',undefined,organization)).status,403);
 assert.deepEqual((await request('/diaries','GET',undefined,foreign)).data,[]);
 const body={date:a.internship.start_date,tasks:'Разработка <script>alert(1)</script>',hours:8,results:'Готов API\nПроверены запросы'};
 for(const invalid of [{hours:0},{hours:25},{hours:1.1},{hours:'8'},{date:'2026-02-31'},{date:'2020-01-01'},{tasks:''}])assert.equal((await request(url,'POST',{...body,...invalid},student)).status,400);
 assert.equal((await request(url,'POST',body,coordinator)).status,403);
 let e=(await request(url,'POST',body,student)).data;
 const change=async(entry,action,cookie=student,extra={})=>request(url+'/'+entry.id,'PATCH',{action,revision:entry.revision,...extra},cookie);
 assert.equal((await change(e,'submit')).status,409);
 await request('/coordinator/approvals/'+a.id,'PATCH',{state:'approved',version:a.approval.version},coordinator);
 e=(await change(e,'submit')).data;assert.equal(e.status,'submitted');
 assert.equal((await change(e,'save',student,body)).status,409);
 assert.equal((await request(url+'/'+e.id,'DELETE',{revision:e.revision},student)).status,409);
 assert.equal((await change(e,'approve',foreign)).status,404);
 assert.equal((await change(e,'approve',student)).status,400);
 assert.equal((await change(e,'return',coordinator,{comment:''})).status,400);
 const beforeReview=e;
 e=(await change(e,'return',coordinator,{comment:'Уточните, какие методы API реализованы'})).data;
 assert.equal(e.status,'changes_requested');assert.equal(e.comment,'Уточните, какие методы API реализованы');
 assert.equal((await change(beforeReview,'approve',coordinator)).status,409);
 e=(await change(e,'save',student,{...body,hours:7.5,results:'Реализованы GET /tasks и POST /tasks'})).data;
 e=(await change(e,'submit')).data;e=(await change(e,'approve',coordinator,{comment:'Принято'})).data;
 assert.equal(e.status,'approved');assert.equal(e.history.length,4);assert.equal(e.history[0].results,body.results);assert.equal(e.history[2].results,'Реализованы GET /tasks и POST /tasks');
 assert.equal((await change(e,'save',student,body)).status,409);
 const second=(await request(url,'POST',{...body,hours:16.5,results:'Дополнительная задача'},student)).data;
 assert.equal((await request(url,'POST',{...body,hours:0.25},student)).status,400);
 const s=(await request(url,'GET',undefined,student)).data.summary;assert.equal(s.total_hours,24);assert.equal(s.approved_hours,7.5);
 const html=(await request(url+'/export','GET',undefined,coordinator)).data;assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('Черновик'));assert.ok(html.includes('24'));
 assert.equal((await request(url+'/export?kind=report','GET',undefined,student)).status,409);
 // The actual owner of p-5 completes the placement.
 const orgUser=(await request('/internships/'+a.internship_id)).data.organization_id;
 const owner=await login(orgUser==='org-demo'?'organization1@example.test':'organization2@example.test');
 assert.equal((await request('/applications/'+a.id,'PATCH',{status:'completed',rating:5,text:'Работа выполнена',results:'API реализован'},owner)).status,200);
 assert.equal((await request(url+'/export?kind=report','GET',undefined,student)).status,409);
 let next=(await change(second,'submit')).data;
 next=(await change(next,'recall')).data;assert.equal(next.status,'draft');
 next=(await change(next,'submit')).data;await change(next,'approve',coordinator);
 const report=await request(url+'/export?kind=report','GET',undefined,student);assert.equal(report.status,200);assert.ok(report.data.includes('GET /tasks'));assert.ok(report.data.includes('Работа выполнена'));assert.ok(report.data.includes('Все записи приняты'));
 await stop();await start();assert.equal((await request(url,'GET',undefined,student)).data.summary.approved_hours,24);
 // Changed group requirements invalidate previously reviewed entries.
 const group=(await request('/coordinator/dashboard','GET',undefined,coordinator)).data.groups.find(g=>g.id===a.approval.group_id);
 await request('/coordinator/groups/'+group.id,'PATCH',{...group,notes:'Новые требования'},coordinator);
 let detail=(await request(url,'GET',undefined,student)).data;assert.equal(detail.summary.approved_hours,0);assert.equal(detail.summary.returned,2);
 assert.equal((await request(url+'/export?kind=report','GET',undefined,student)).status,409);
 assert.equal((await change(detail.entries[0],'submit')).status,409);
 const current=(await request('/applications','GET',undefined,student)).data.find(x=>x.id===a.id);
 await request('/coordinator/approvals/'+a.id,'PATCH',{state:'approved',version:current.approval.version},coordinator);
 const resent=await change(detail.entries[0],'submit');assert.equal(resent.status,200);
 // Leaving a group revokes the former coordinator's access immediately.
 await request('/me/group','DELETE',undefined,student);
 assert.equal((await request(url,'GET',undefined,coordinator)).status,404);
 assert.equal((await request(url+'/export','GET',undefined,coordinator)).status,404);
 assert.equal((await request(url,'GET',undefined,student)).status,200);
});
