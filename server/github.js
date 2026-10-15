import { randomUUID } from 'node:crypto';
const error=(status,message)=>Object.assign(new Error(message),{status,publicMessage:message});
export function githubUsername(value){
 if(typeof value!=='string')throw error(400,'Введите имя пользователя или ссылку на профиль GitHub.');
 let name=value.trim();
 if(/^https?:\/\//i.test(name)){try{const url=new URL(name);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/[\w-]+\/?$/.test(url.pathname))throw Error();name=url.pathname.split('/')[1];}catch{throw error(400,'Нужна ссылка вида https://github.com/username.');}}
 if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(name)||name.includes('--'))throw error(400,'Проверьте имя пользователя GitHub.');
 return name.toLowerCase();
}
export function createGithubLookup({fetcher=fetch,now=Date.now,timeoutMs=8000}={}){
 const cache=new Map();let blockedUntil=0;
 return async(value,page=1)=>{
  const username=githubUsername(value);
  if(!Number.isInteger(page)||page<1||page>20)throw error(400,'Некорректная страница репозиториев.');
  const key=username+':'+page,saved=cache.get(key);
  if(saved?.expires>now())return structuredClone(saved.data);
  if(blockedUntil>now())throw error(429,'Лимит GitHub исчерпан. Попробуйте позже.');
  let response,payload;
  try{response=await fetcher(`https://api.github.com/users/${username}/repos?type=owner&sort=updated&direction=desc&per_page=30&page=${page}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Praktio','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
   if(response.status===404)throw error(404,'Профиль GitHub не найден.');
   if([403,429].includes(response.status)){const reset=Number(response.headers.get('x-ratelimit-reset'))*1000,retry=Number(response.headers.get('retry-after'))*1000;blockedUntil=now()+Math.max(60000,Math.min(3600000,reset>now()?reset-now():retry));throw error(429,'Лимит GitHub исчерпан. Попробуйте позже.');}
   if(!response.ok)throw error(502,'GitHub временно недоступен. Попробуйте позже.');
   payload=await response.json();
  }catch(e){if(e.publicMessage)throw e;if(['TimeoutError','AbortError'].includes(e.name))throw error(504,'GitHub не ответил вовремя. Попробуйте ещё раз.');throw error(503,'Не удалось связаться с GitHub. Попробуйте позже.');}
  if(!Array.isArray(payload))throw error(502,'Не удалось прочитать список проектов GitHub.');
  const repositories=payload.filter(r=>r?.private===false&&Number.isSafeInteger(r.id)&&r.id>0&&typeof r.owner?.login==='string'&&r.owner.login.toLowerCase()===username&&typeof r.name==='string'&&/^[\w.-]{1,100}$/.test(r.name)).map(r=>({id:r.id,name:r.name,description:typeof r.description==='string'?r.description.slice(0,500):'',language:typeof r.language==='string'?r.language.slice(0,80):'',url:`https://github.com/${username}/${r.name}`,fork:r.fork===true}));
  const result={username,repositories,page,has_more:payload.length===30&&page<20};
  for(const [k,v]of cache)if(v.expires<=now())cache.delete(k);
  if(cache.size>=100)cache.delete(cache.keys().next().value);
  cache.set(key,{expires:now()+300000,data:result});return structuredClone(result);
 };
}
export function registerGithubRoutes(app,{auth,db,self,lookup=createGithubLookup(),now=Date.now}){
 const imports=new Map(),attempts=new Map();
 const prune=()=>{for(const map of [imports,attempts])for(const [k,v]of map)if(v.expires<=now())map.delete(k);};
 app.post('/api/student/github/repositories',auth('student'),async(req,res)=>{
  const username=githubUsername(req.body.username),page=req.body.page??1;prune();
  const rate=attempts.get(req.user.id)||{count:0,expires:now()+60000};if(rate.count>=10)throw error(429,'Слишком много запросов. Попробуйте через минуту.');rate.count++;attempts.set(req.user.id,rate);
  const result=await lookup(username,page);
  let snapshot=imports.get(req.user.id);
  if(page===1)snapshot={token:randomUUID(),username,repositories:new Map(),expires:now()+900000};
  if(!snapshot||snapshot.username!==username||page>1&&req.body.import_token!==snapshot.token)throw error(409,'Загрузите список проектов заново.');
  for(const repo of result.repositories)snapshot.repositories.set(repo.id,repo);
  imports.set(req.user.id,snapshot);res.json({...result,import_token:snapshot.token});
 });
 app.put('/api/student/github',auth('student'),(req,res)=>{
  prune();const snapshot=imports.get(req.user.id),ids=req.body.repository_ids;
  if(!snapshot||snapshot.token!==req.body.import_token)throw error(409,'Список устарел. Загрузите проекты заново.');
  if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||!snapshot.repositories.has(id)))throw error(400,'Выберите до пяти проектов из загруженного списка.');
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id),profile=JSON.parse(user.profile);
  profile.github_username=snapshot.username;profile.github_projects=ids.map(id=>snapshot.repositories.get(id));
  db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify(profile),user.id);res.json(self({...user,profile:JSON.stringify(profile)}));
 });
 app.delete('/api/student/github',auth('student'),(req,res)=>{
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id),profile=JSON.parse(user.profile);delete profile.github_username;delete profile.github_projects;
  db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify(profile),user.id);imports.delete(user.id);res.json(self({...user,profile:JSON.stringify(profile)}));
 });
}
