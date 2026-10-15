import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGithubLookup,githubUsername} from '../server/github.js';
const repo=(id=1)=>({id,name:'demo-app',owner:{login:'Student-Dev'},private:false,description:'Project',language:'TypeScript',fork:false,html_url:'https://evil.example',extra:'ignored'});
test('GitHub public import validates destination, normalizes fields, pages, caches and handles provider errors',async()=>{
 assert.equal(githubUsername(' https://github.com/Student-Dev/ '),'student-dev');
 for(const name of ['https://evil.example/user','https://github.com/user/repo','https://github.com/user?q=x','user/../../x','-user','a--b','http://github.com/user','https://name:pass@github.com/user'])assert.throws(()=>githubUsername(name),e=>e.status===400);
 let calls=0,stamp=0;
 const lookup=createGithubLookup({now:()=>stamp,fetcher:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.github.com');assert.equal(options.redirect,'error');assert.ok(!options.headers.Authorization);return Response.json([repo(),{...repo(2),private:true},{...repo(3),owner:{login:'other'}}]);}});
 const data=await lookup('Student-Dev');assert.equal(data.repositories.length,1);assert.deepEqual(Object.keys(data.repositories[0]).sort(),['description','fork','id','language','name','url']);assert.equal(data.repositories[0].url,'https://github.com/student-dev/demo-app');assert.equal(data.has_more,false);
 data.repositories[0].name='Mutated';assert.equal((await lookup('student-dev')).repositories[0].name,'demo-app');assert.equal(calls,1);await lookup('student-dev',2);assert.equal(calls,2);stamp=300001;await lookup('student-dev');assert.equal(calls,3);
 await assert.rejects(lookup('student-dev',0),e=>e.status===400);
 const paginated=createGithubLookup({fetcher:async()=>Response.json(Array.from({length:30},(_,i)=>repo(i+1)))});assert.equal((await paginated('student-dev')).has_more,true);
 for(const [status,expected] of [[404,404],[429,429],[403,429],[500,502]]){let requests=0;const fail=createGithubLookup({fetcher:async()=>{requests++;return Response.json({message:'private provider details'},{status});}});await assert.rejects(fail('student-dev'),e=>e.status===expected&&!e.message.includes('private'));if(status===429){await assert.rejects(fail('other'),e=>e.status===429);assert.equal(requests,1);}}
 await assert.rejects(createGithubLookup({fetcher:async()=>Response.json({wrong:true})})('student-dev'),e=>e.status===502);
 await assert.rejects(createGithubLookup({fetcher:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}})('student-dev'),e=>e.status===504);
});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=mkdtempSync(path.join(tmpdir(),'praktio-github-test-')),base='http://127.0.0.1:3407/api';
let server,errors='';
async function request(url,method='GET',body,cookie=''){
 const response=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{server=spawn(process.execPath,['--import','./tests/fixtures/github-fetch.js','tests/fixtures/start-server.js'],{cwd:root,env:{...process.env,PORT:'3407',DATA_DIR:directory,DADATA_API_KEY:''},stdio:'pipe'});server.stderr.on('data',d=>errors+=d);for(let i=0;i<100;i++){try{if((await request('/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(errors);});
after(async()=>{if(server?.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('praktio-github-test-'));rmSync(directory,{recursive:true,force:true});});
test('Students select trusted public projects; other roles cannot import, previews do not save and viewers see saved projects',async()=>{
 const login=async email=>(await request('/auth/login','POST',{email,password:'Demo2026!'})).cookie;
 const student=await login('student1@example.test'),other=await login('student2@example.test'),org=await login('organization1@example.test'),curator=await login('coordinator1@example.test');
 const endpoint='/student/github/repositories',body={username:'student-dev'};
 assert.equal((await request(endpoint,'POST',body)).status,401);for(const c of [org,curator])for(const [url,method]of [[endpoint,'POST'],['/student/github','PUT'],['/student/github','DELETE']])assert.equal((await request(url,method,body,c)).status,403);
 const initial=(await request('/me','GET',undefined,student)).data;
 const preview=await request(endpoint,'POST',body,student);assert.equal(preview.status,200);assert.equal(preview.data.repositories.length,30);assert.deepEqual((await request('/me','GET',undefined,student)).data.profile,initial.profile);
 const token=preview.data.import_token,save=ids=>request('/student/github','PUT',{import_token:token,repository_ids:ids,url:'https://evil.example'},student);
 assert.equal((await request('/student/github','PUT',{import_token:token,repository_ids:[1]},other)).status,409);
 for(const ids of [[999],[1,1],[1,2,3,4,5,6],['1']])assert.equal((await save(ids)).status,400);
 const second=await request(endpoint,'POST',{username:'student-dev',page:2,import_token:token},student);assert.equal(second.status,200);assert.equal(second.data.repositories[0].id,31);
 const saved=await save([1,31]);assert.equal(saved.status,200);assert.equal(saved.data.profile.github_username,'student-dev');assert.equal(saved.data.profile.github_projects.length,2);assert.deepEqual(saved.data.profile.skills,initial.profile.skills);assert.equal(saved.data.profile.github_projects[0].url,'https://github.com/student-dev/project-1');
 for(const cookie of [org,curator]){const apps=(await request('/applications','GET',undefined,cookie)).data;assert.ok(apps.some(a=>a.student.id===initial.id&&a.student.profile.github_projects?.length===2));}
 const forged=await request('/me','PATCH',{name:initial.name,github_projects:[{url:'https://evil.example'}],github_username:'forged'},student);assert.equal(forged.data.profile.github_username,'student-dev');
 const next=await request(endpoint,'POST',body,student);assert.equal((await save([1])).status,409);assert.notEqual(next.data.import_token,token);
 assert.equal((await request('/student/github','DELETE',undefined,student)).status,200);const final=(await request('/me','GET',undefined,student)).data;assert.ok(!('github_projects'in final.profile));assert.equal(final.profile.portfolio,initial.profile.portfolio);
});
