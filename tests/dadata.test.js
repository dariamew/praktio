import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPartyLookup,validInn,setupCompanyProfiles} from '../server/dadata.js';
import {DatabaseSync} from 'node:sqlite';
import {party} from './fixtures/dadata-payload.js';

test('DaData validation, normalization, cache and safe provider errors',async()=>{
 for(const inn of ['7707083893','7719402047','7721581040','784806113663'])assert.equal(validInn(inn),true);
 for(const inn of ['7707083894','784806113664','0000000000','123','770708389a',7707083893])assert.equal(validInn(inn),false);
 let calls=0,stamp=1000;
 const lookup=createPartyLookup({apiKey:()=> 'super-secret-test-token',now:()=>stamp,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party');assert.equal(options.headers.Authorization,'Token super-secret-test-token');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  const body=JSON.parse(options.body);assert.deepEqual(body,{query:body.query,branch_type:'MAIN',count:1});return Response.json({suggestions:[party(body.query)]});
 }});
 await assert.rejects(lookup('7707083894'),e=>e.status===400);assert.equal(calls,0);
 const company=await lookup('7707083893');assert.equal(company.city,'Москва');assert.equal(company.industry,'Разработка компьютерного программного обеспечения');assert.equal(company.name,'ООО "Тестовая компания"');assert.deepEqual(Object.keys(company).sort(),['city','industry','inn','name']);assert.ok(!JSON.stringify(company).includes('super-secret'));assert.ok(!('management' in company));
 company.name='Changed cached value';assert.equal((await lookup('7707083893')).name,'ООО "Тестовая компания"');assert.equal(calls,1);
 stamp+=300001;await lookup('7707083893');assert.equal(calls,2);
 const ip=await lookup('784806113663');assert.equal(ip.city,'Тестовый посёлок');assert.equal(ip.name,'ИП Тестовый');assert.deepEqual(Object.keys(ip).sort(),['city','industry','inn','name']);
 await assert.rejects(createPartyLookup({apiKey:()=>'',fetcher:()=>{throw Error('Must not call provider');}})('7707083893'),e=>e.status===503);
 for(const status of [401,403,429,500])await assert.rejects(createPartyLookup({apiKey:()=> 'secret',fetcher:async()=>Response.json({error:'secret'},{status})})('7707083893'),e=>[502,503].includes(e.status)&&!e.message.includes('secret'));
 for(const payload of [{},{suggestions:[]},{suggestions:[party('7719402047')]},{suggestions:[{data:{inn:'7707083893'}}]}])await assert.rejects(createPartyLookup({apiKey:()=> 'secret',fetcher:async()=>Response.json(payload)})('7707083893'),e=>[404,502].includes(e.status));
 await assert.rejects(createPartyLookup({apiKey:()=> 'secret',timeoutMs:10,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(Response.json({suggestions:[]})),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});})})('7707083893'),e=>e.status===504);
});

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=mkdtempSync(path.join(tmpdir(),'praktio-dadata-test-')),base='http://127.0.0.1:3405/api';
let server,errors='';
async function request(url,method='GET',body,cookie=''){
 const response=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function start(mock=false){errors='';server=spawn(process.execPath,[...(mock?['--import','./tests/fixtures/dadata-fetch.js']:[]),'tests/fixtures/start-server.js'],{cwd:root,env:{...process.env,PORT:'3405',DATA_DIR:directory,DADATA_API_KEY:mock?'test-key':''},stdio:'pipe'});server.stderr.on('data',data=>errors+=data);for(let i=0;i<100;i++){try{if((await request('/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(errors);}
async function stop(){if(server?.exitCode===null){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill();await ended;}}
before(()=>start());
after(async()=>{await stop();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('praktio-dadata-test-'));rmSync(resolved,{recursive:true,force:true});});
test('Organization-only lookup, missing key, preview without mutation and minimal persisted profile',async()=>{
 const login=async email=>(await request('/auth/login','POST',{email,password:'Demo2026!'})).cookie;
 const organization=await login('organization1@example.test'),student=await login('student1@example.test'),coordinator=await login('coordinator1@example.test');
 const lookup='/organization/lookup-inn',query={inn:'7707083893'};
 assert.equal((await request(lookup,'POST',query)).status,401);
 for(const cookie of [student,coordinator])assert.equal((await request(lookup,'POST',query,cookie)).status,403);
 assert.equal((await request(lookup,'POST',{inn:'7707083894'},organization)).status,400);
 const missing=await request(lookup,'POST',query,organization);assert.equal(missing.status,503);assert.ok(missing.data.error.includes('недоступен'));
 await stop();await start(true);
 const beforeLookup=(await request('/me','GET',undefined,organization)).data;
 const result=await request(lookup,'POST',query,organization);assert.equal(result.status,200);assert.deepEqual(Object.keys(result.data).sort(),['city','industry','inn','name']);assert.ok(!JSON.stringify(result.data).includes('test-key'));
 const afterLookup=(await request('/me','GET',undefined,organization)).data;assert.equal(afterLookup.name,beforeLookup.name);assert.deepEqual(afterLookup.profile,beforeLookup.profile);
 assert.equal((await request(lookup,'POST',{inn:'7719402047'},organization)).status,404);
 const limited=await request(lookup,'POST',{inn:'7721581040'},organization);assert.equal(limited.status,503);assert.ok(!JSON.stringify(limited.data).includes('test-key'));
 assert.equal((await request('/me','PATCH',{name:'Анна',inn:'7707083893'},student)).status,403);
 assert.equal((await request('/me','PATCH',{name:'Елена',inn:'7707083893'},coordinator)).status,403);
 assert.equal((await request('/me','PATCH',{name:'Орбита',inn:'7707083894'},organization)).status,400);
 const obsolete={legal_name:'Старый клиент',kpp:'ABC',ogrn:'123',address:'Лишний адрес',okved:'62.01'};
 const saved=await request('/me','PATCH',{...result.data,...obsolete,about:'Ручное описание',mentor:'Наставник',size:'10–20 человек'},organization);assert.equal(saved.status,200);assert.equal(saved.data.profile.inn,'7707083893');assert.equal(saved.data.profile.city,result.data.city);assert.equal(saved.data.profile.industry,result.data.industry);assert.equal(saved.data.profile.about,'Ручное описание');assert.ok(!('status' in saved.data.profile));for(const key of Object.keys(obsolete))assert.ok(!(key in saved.data.profile));
 const ip=await request(lookup,'POST',{inn:'784806113663'},organization);assert.equal(ip.status,200);assert.equal(ip.data.inn,'784806113663');assert.deepEqual(Object.keys(ip.data).sort(),['city','industry','inn','name']);
 for(let i=0;i<6;i++)assert.equal((await request(lookup,'POST',query,organization)).status,200);
 assert.equal((await request(lookup,'POST',query,organization)).status,429);
 await stop();await start();const persisted=(await request('/me','GET',undefined,organization)).data;assert.equal(persisted.profile.inn,'7707083893');assert.equal(persisted.profile.industry,result.data.industry);for(const key of Object.keys(obsolete))assert.ok(!(key in persisted.profile));
 assert.equal((await request('/me','PATCH',{name:'Ручная организация',inn:''},organization)).status,200);
});

test('Old legal details are removed only from company profiles; useful fields survive',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,profile TEXT)');
 const keep={inn:'7707083893',city:'Москва',industry:'Разработка',about:'Сохранить описание',mentor:'Наставник',skills:[]};
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('org','organization',JSON.stringify({...keep,legal_name:'Полное название',kpp:'770701001',ogrn:'1027700132195',address:'Старый адрес',okved:'62.01'}));
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('student','student',JSON.stringify({about:'Студент',address:'Другие данные'}));
 setupCompanyProfiles(db);assert.deepEqual(JSON.parse(db.prepare('SELECT profile FROM users WHERE id=?').get('org').profile),keep);
 assert.deepEqual(JSON.parse(db.prepare('SELECT profile FROM users WHERE id=?').get('student').profile),{about:'Студент',address:'Другие данные'});
 setupCompanyProfiles(db);assert.deepEqual(JSON.parse(db.prepare('SELECT profile FROM users WHERE id=?').get('org').profile),keep);db.close();
});
