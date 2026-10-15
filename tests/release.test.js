import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=mkdtempSync(path.join(tmpdir(),'praktio-release-test-')),base='http://127.0.0.1:3409/api';
let server,errors='';
async function request(url,method='GET',body,cookie=''){
 const response=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function start(){errors='';server=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:'3409',DATA_DIR:directory,DADATA_API_KEY:''},stdio:'pipe'});server.stderr.on('data',d=>errors+=d);for(let i=0;i<100;i++){try{if((await request('/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(errors);}
async function stop(){if(server?.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}}
before(start);
after(async()=>{await stop();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('praktio-release-test-'));rmSync(directory,{recursive:true,force:true});});
test('Production starts empty, creates only registered accounts and preserves them after restart',async()=>{
 assert.deepEqual((await request('/internships')).data,[]);
 const database=new DatabaseSync(path.join(directory,'praktika.sqlite'),{readOnly:true});
 for(const table of ['users','internships','applications','colleges','college_groups','group_members','diary_entries'])assert.equal(database.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 database.close();
 assert.equal((await request('/auth/login','POST',{email:'student1@example.test',password:'Demo2026!'})).status,401);
 const signup=await request('/auth/register','POST',{name:'Зарегистрированный студент',email:'release-student@example.test',password:'Password2026!',role:'student'});assert.equal(signup.status,201);
 const student=signup.cookie;
 assert.deepEqual((await request('/applications','GET',undefined,student)).data,[]);
 assert.deepEqual((await request('/diaries','GET',undefined,student)).data,[]);
 const error=await request('/me','PATCH',{name:'Студент',city:42},student);assert.equal(error.status,400);assert.ok(error.data.error.includes('Город'));assert.ok(!error.data.error.includes('city'));
 const coordinator=await request('/auth/register','POST',{name:'Координатор',email:'release-coordinator@example.test',password:'Password2026!',role:'coordinator',college_name:'Учебное заведение'});assert.equal(coordinator.status,201);
 const dashboard=(await request('/coordinator/dashboard','GET',undefined,coordinator.cookie)).data;
 assert.equal(dashboard.college.name,'Учебное заведение');assert.deepEqual(dashboard.groups,[]);assert.deepEqual(dashboard.students,[]);
 await stop();await start();assert.equal((await request('/me','GET',undefined,student)).data.id,signup.data.id);assert.deepEqual((await request('/internships')).data,[]);
 const persisted=new DatabaseSync(path.join(directory,'praktika.sqlite'),{readOnly:true});assert.equal(persisted.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);assert.equal(persisted.prepare('SELECT COUNT(*) AS n FROM colleges').get().n,1);persisted.close();
});
