import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { hashPassword } from './password.js';
import catalog from '../shared/catalog.json' with {type:'json'};
import { setupCollege,studentGroup,canCoordinateStudent,approvalFor,registerCollegeRoutes } from './college.js';
import { setupDiary,registerDiaryRoutes } from './diary.js';
import { registerDaDataRoutes,validInn,setupCompanyProfiles } from './dadata.js';
import { registerGithubRoutes } from './github.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(path.join(root,'.env')))loadEnvFile(path.join(root,'.env'));
const data=process.env.DATA_DIR || path.join(root,'data');
mkdirSync(path.join(data,'uploads'),{recursive:true});
const db=new DatabaseSync(path.join(data,'praktika.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('student','organization','coordinator')),name TEXT NOT NULL,profile TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS internships(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,category TEXT NOT NULL,format TEXT NOT NULL,city TEXT NOT NULL,skills TEXT NOT NULL,payment INTEGER NOT NULL,places INTEGER NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,description TEXT NOT NULL,tasks TEXT NOT NULL,outcomes TEXT NOT NULL,mentor TEXT NOT NULL,created_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,internship_id TEXT NOT NULL REFERENCES internships(id),student_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,history TEXT NOT NULL,UNIQUE(internship_id,student_id));
CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id),internship_id TEXT NOT NULL REFERENCES internships(id),PRIMARY KEY(user_id,internship_id));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,stored_name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,application_id TEXT UNIQUE NOT NULL REFERENCES applications(id),rating INTEGER NOT NULL,text TEXT NOT NULL,results TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_apps_student ON applications(student_id);
CREATE INDEX IF NOT EXISTS idx_internships_org ON internships(organization_id);
`);
setupCollege(db,data);
setupDiary(db);

setupCompanyProfiles(db);
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
app.use('/api',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3080','http://127.0.0.1:3080'].includes(req.headers.origin)) return res.status(403).json({error:'Источник запроса не разрешён'});
  next();
});
app.use(express.json({limit:'200kb'}));
const get=(sql,...params)=>db.prepare(sql).get(...params);
const all=(sql,...params)=>db.prepare(sql).all(...params);
const run=(sql,...params)=>db.prepare(sql).run(...params);
const fail=(code,message)=>{const e=new Error(message);e.status=code;throw e;};
const text=(value,label,max=3000,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim())) fail(400,`Проверьте поле «${label}»`);return value.trim();};
const list=(value,label)=>{if(!Array.isArray(value)||value.length>20) fail(400,`Проверьте поле «${label}»`);return value.map(v=>text(v,label,200,true));};
const url=(value)=>{if(!value)return '';try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw Error();return u.toString();}catch{fail(400,'Ссылка должна начинаться с https:// или http://');}};
const hashToken=t=>createHash('sha256').update(t).digest('hex');
const publicUser=u=>({id:u.id,name:u.name,role:u.role,profile:JSON.parse(u.profile)});
const self=u=>({...publicUser(u),email:u.email,files:all('SELECT id,name,size,mime FROM files WHERE user_id=?',u.id),group:u.role==='student'?studentGroup(db,u.id):null,college:u.role==='coordinator'?get('SELECT * FROM colleges WHERE coordinator_id=?',u.id):null});
const parsePractice=p=>({...p,skills:JSON.parse(p.skills),tasks:JSON.parse(p.tasks),outcomes:JSON.parse(p.outcomes)});
const practice=id=>{const p=get(`SELECT i.*,u.name as organization_name,u.profile as organization_profile FROM internships i JOIN users u ON u.id=i.organization_id WHERE i.id=?`,id);if(!p)fail(404,'Практика не найдена');return {...parsePractice(p),organization_profile:JSON.parse(p.organization_profile)};};
app.use('/api',(req,res,next)=>{
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('praktika_session='))?.split('=')[1];
  if(token){const s=get('SELECT * FROM sessions WHERE token=? AND expires>?',hashToken(token),Date.now());if(s)req.user=get('SELECT * FROM users WHERE id=?',s.user_id);}
  next();
});
const auth=(role)=>(req,res,next)=>{if(!req.user)return res.status(401).json({error:'Войдите в аккаунт'});if(role&&req.user.role!==role)return res.status(403).json({error:'Действие недоступно для вашей роли'});next();};
const session=(res,user)=>{const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',hashToken(token),user.id,Date.now()+7*86400000);res.cookie('praktika_session',token,{httpOnly:true,sameSite:'strict',maxAge:7*86400000,path:'/'});return self(user);};
const attempts=new Map();
app.post('/api/auth/login',(req,res)=>{
  const key=req.ip;const rate=attempts.get(key)||{count:0,start:Date.now()};if(Date.now()-rate.start>60000){rate.count=0;rate.start=Date.now();}if(++rate.count>30)fail(429,'Слишком много попыток. Попробуйте через минуту');attempts.set(key,rate);
  const email=text(req.body.email,'Email',254,true).toLowerCase();const password=text(req.body.password,'Пароль',128,true);
  const user=get('SELECT * FROM users WHERE email=?',email);
  const [salt,hash]=(user?.password||hashPassword('dummy-password')).split(':');
  if(!timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64))||!user)fail(401,'Неверная почта или пароль');
  res.json(session(res,user));
});
app.post('/api/auth/register',(req,res)=>{
  const name=text(req.body.name,'Имя / название',100,true);const email=text(req.body.email,'Email',254,true).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Введите корректный email');
  const password=text(req.body.password,'Пароль',128,true);if(password.length<8)fail(400,'Пароль должен содержать минимум 8 символов');
  const role=req.body.role;if(!['student','organization','coordinator'].includes(role))fail(400,'Выберите роль');
  const school=role==='coordinator'?text(req.body.college_name,'Учебное заведение',200,true):'';
  if(get('SELECT id FROM users WHERE email=?',email))fail(409,'Этот email уже зарегистрирован');
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');
  try{run('INSERT INTO users VALUES(?,?,?,?,?,?)',id,email,hashPassword(password),role,name,JSON.stringify({skills:[],city:'',about:'',headline:'',...(school?{school}: {})}));if(role==='coordinator')run('INSERT INTO colleges VALUES(?,?,?)',randomUUID(),id,school);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  res.status(201).json(session(res,get('SELECT * FROM users WHERE id=?',id)));
});
app.post('/api/auth/logout',auth(),(req,res)=>{const token=req.headers.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('praktika_session='))?.split('=')[1];if(token)run('DELETE FROM sessions WHERE token=?',hashToken(token));res.clearCookie('praktika_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',(req,res)=>res.json(req.user?self(req.user):null));
app.patch('/api/me',auth(),(req,res)=>{
  const name=text(req.body.name,'Имя / название',100,true);const old=JSON.parse(req.user.profile);const p={...old};
  const labels={headline:'Специализация',city:'Город',about:'Описание',school:'Учебное заведение',course:'Курс и группа',availability:'Дата начала',industry:'Отрасль',size:'Размер команды',mentor:'Наставник'};
  for(const key of Object.keys(labels))if(key in req.body)p[key]=text(req.body[key],labels[key],key==='about'?3000:200);
  if('skills' in req.body)p.skills=list(req.body.skills,'Навыки');
  if('portfolio' in req.body)p.portfolio=url(req.body.portfolio);
  if('website' in req.body)p.website=url(req.body.website);
  if('inn' in req.body&&req.user.role!=='organization')fail(403,'ИНН доступен только организациям');
  if(req.user.role==='organization'){
   if('inn' in req.body){const inn=text(req.body.inn,'ИНН',12);if(inn&&!validInn(inn))fail(400,'Введите корректный ИНН из 10 или 12 цифр.');p.inn=inn;}
  }
  if(req.user.role==='coordinator'&&'school' in req.body){if(!p.school)fail(400,'Укажите учебное заведение');run('UPDATE colleges SET name=? WHERE coordinator_id=?',p.school,req.user.id);}
  run('UPDATE users SET name=?,profile=? WHERE id=?',name,JSON.stringify(p),req.user.id);res.json(self(get('SELECT * FROM users WHERE id=?',req.user.id)));
});
app.get('/api/internships',(req,res)=>{
  const rows=all(`SELECT i.*,u.name as organization_name FROM internships i JOIN users u ON u.id=i.organization_id WHERE i.archived=0 OR i.organization_id=? ORDER BY i.created_at DESC`,req.user?.role==='organization'?req.user.id:'');
  res.json(rows.map(p=>({...parsePractice(p),application_count:get('SELECT COUNT(*) as count FROM applications WHERE internship_id=?',p.id).count,occupied:get("SELECT COUNT(*) as count FROM applications WHERE internship_id=? AND status IN ('accepted','completed')",p.id).count})));
});
app.get('/api/internships/:id',(req,res)=>res.json(practice(req.params.id)));
app.get('/api/organizations/:id',(req,res)=>{const u=get("SELECT * FROM users WHERE id=? AND role='organization'",req.params.id);if(!u)fail(404,'Организация не найдена');res.json(publicUser(u));});
function practiceData(body){
 const title=text(body.title,'Название',150,true),category=text(body.category,'Направление',80,true),format=text(body.format,'Формат',50,true),city=text(body.city,'Город',100,true);
 if(!catalog.categories.includes(category)||!catalog.formats.includes(format))fail(400,'Выберите направление и формат');
 const start=text(body.start_date,'Начало',10,true),end=text(body.end_date,'Окончание',10,true);
 const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!validDate(start)||!validDate(end)||end<start)fail(400,'Проверьте даты практики');
 const payment=Number(body.payment),places=Number(body.places);if(!Number.isInteger(payment)||payment<0||payment>1000000||!Number.isInteger(places)||places<1||places>1000)fail(400,'Проверьте оплату и количество мест');
 const tasks=list(body.tasks,'Задачи'),outcomes=list(body.outcomes,'Результаты');if(!tasks.length||!outcomes.length)fail(400,'Добавьте хотя бы одну задачу и результат обучения');
 return [title,category,format,city,JSON.stringify(list(body.skills,'Навыки')),payment,places,start,end,text(body.description,'Описание',5000,true),JSON.stringify(tasks),JSON.stringify(outcomes),text(body.mentor,'Наставник',100,true)];
}
app.post('/api/internships',auth('organization'),(req,res)=>{const values=practiceData(req.body);const id=randomUUID();run('INSERT INTO internships(id,organization_id,title,category,format,city,skills,payment,places,start_date,end_date,description,tasks,outcomes,mentor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,req.user.id,...values,new Date().toISOString());res.status(201).json(practice(id));});
app.patch('/api/internships/:id',auth('organization'),(req,res)=>{
 const p=practice(req.params.id);if(p.organization_id!==req.user.id)fail(403,'Нет доступа к этой практике');
 if('archived' in req.body){run('UPDATE internships SET archived=? WHERE id=?',req.body.archived?1:0,p.id);}else{
 const v=practiceData(req.body);const occupied=get("SELECT COUNT(*) as count FROM applications WHERE internship_id=? AND status IN ('accepted','completed')",p.id).count;if(v[6]<occupied)fail(400,'Количество мест меньше числа принятых студентов');
 run('UPDATE internships SET title=?,category=?,format=?,city=?,skills=?,payment=?,places=?,start_date=?,end_date=?,description=?,tasks=?,outcomes=?,mentor=? WHERE id=?',...v,p.id);
 }res.json(practice(p.id));
});
app.get('/api/favorites',auth('student'),(req,res)=>res.json(all('SELECT internship_id FROM favorites WHERE user_id=?',req.user.id).map(x=>x.internship_id)));
app.put('/api/favorites/:id',auth('student'),(req,res)=>{practice(req.params.id);run('INSERT OR IGNORE INTO favorites VALUES(?,?)',req.user.id,req.params.id);res.json({ok:true});});
app.delete('/api/favorites/:id',auth('student'),(req,res)=>{run('DELETE FROM favorites WHERE user_id=? AND internship_id=?',req.user.id,req.params.id);res.json({ok:true});});
function appView(a){const s=get('SELECT * FROM users WHERE id=?',a.student_id),p=practice(a.internship_id);return {...a,history:JSON.parse(a.history),internship:p,student:{...publicUser(s),files:all('SELECT id,name,size FROM files WHERE user_id=?',s.id)},review:get('SELECT * FROM reviews WHERE application_id=?',a.id)||null,approval:approvalFor(db,a,p)};}
function ownApp(id,u){const a=get('SELECT * FROM applications WHERE id=?',id);if(!a)fail(404,'Заявка не найдена');const p=practice(a.internship_id);if(a.student_id!==u.id&&p.organization_id!==u.id&&!(u.role==='coordinator'&&canCoordinateStudent(db,u.id,a.student_id)))fail(403,'Нет доступа к этой заявке');return a;}
app.get('/api/applications',auth(),(req,res)=>{const rows=req.user.role==='student'?all('SELECT * FROM applications WHERE student_id=? ORDER BY updated_at DESC',req.user.id):req.user.role==='coordinator'?all('SELECT a.* FROM applications a JOIN group_members m ON m.student_id=a.student_id JOIN college_groups g ON g.id=m.group_id JOIN colleges c ON c.id=g.college_id WHERE c.coordinator_id=? ORDER BY a.updated_at DESC',req.user.id):all('SELECT a.* FROM applications a JOIN internships i ON i.id=a.internship_id WHERE i.organization_id=? ORDER BY a.updated_at DESC',req.user.id);res.json(rows.map(appView));});
app.post('/api/applications',auth('student'),(req,res)=>{
 const p=practice(req.body.internship_id);if(p.archived||p.end_date<new Date().toISOString().slice(0,10))fail(400,'Приём заявок завершён');
 if(get('SELECT id FROM applications WHERE student_id=? AND internship_id=?',req.user.id,p.id))fail(409,'Вы уже откликнулись на эту практику');
 const occupied=get("SELECT COUNT(*) as count FROM applications WHERE internship_id=? AND status IN ('accepted','completed')",p.id).count;if(occupied>=p.places)fail(409,'Все места уже заняты');
 const message=text(req.body.message,'Сопроводительное письмо',3000,true),now=new Date().toISOString(),id=randomUUID();
 run('INSERT INTO applications VALUES(?,?,?,?,?,?,?,?)',id,p.id,req.user.id,'sent',message,now,now,JSON.stringify([{status:'sent',at:now}]));res.status(201).json(appView(get('SELECT * FROM applications WHERE id=?',id)));
});
app.patch('/api/applications/:id',auth(),(req,res)=>{
 if(req.user.role==='coordinator')fail(403,'Решение по заявке принимает организация. Согласование колледжа доступно отдельно.');
 const a=ownApp(req.params.id,req.user),p=practice(a.internship_id),status=req.body.status;
 const transitions={sent:['reviewing','accepted','rejected'],reviewing:['accepted','rejected'],accepted:['completed']};
 if(req.user.role==='student'){if(status!=='withdrawn'||!['sent','reviewing'].includes(a.status))fail(400,'Эту заявку уже нельзя отозвать');}
 else if(!(transitions[a.status]||[]).includes(status))fail(400,'Недопустимая смена статуса');
 if(status==='accepted'){const count=get("SELECT COUNT(*) as count FROM applications WHERE internship_id=? AND status IN ('accepted','completed')",p.id).count;if(count>=p.places)fail(409,'Все места уже заняты');}
 const now=new Date().toISOString();
 if(status==='completed'){
  const rating=Number(req.body.rating);if(!Number.isInteger(rating)||rating<1||rating>5)fail(400,'Выберите оценку от 1 до 5');
  const review=text(req.body.text,'Отзыв',3000,true),results=text(req.body.results,'Результаты практики',5000,true);
  run('INSERT INTO reviews VALUES(?,?,?,?,?,?)',randomUUID(),a.id,rating,review,results,now);
 }
 const history=JSON.parse(a.history);history.push({status,at:now});run('UPDATE applications SET status=?,updated_at=?,history=? WHERE id=?',status,now,JSON.stringify(history),a.id);res.json(appView(get('SELECT * FROM applications WHERE id=?',a.id)));
});
const upload=multer({storage:multer.diskStorage({destination:path.join(data,'uploads'),filename:(req,file,cb)=>cb(null,randomUUID())}),limits:{fileSize:10*1024*1024,files:1},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();if(!['.pdf','.png','.jpg','.jpeg','.webp','.zip'].includes(ext))return cb(Object.assign(new Error('Можно загрузить PDF, изображение или ZIP'),{status:400}));cb(null,true);}});
app.post('/api/files',auth('student'),(req,res,next)=>{if(get('SELECT COUNT(*) as count FROM files WHERE user_id=?',req.user.id).count>=5)return res.status(400).json({error:'Можно прикрепить до 5 файлов'});next();},upload.single('file'),(req,res)=>{if(!req.file)fail(400,'Выберите файл');const id=randomUUID();run('INSERT INTO files VALUES(?,?,?,?,?,?)',id,req.user.id,path.basename(req.file.originalname),req.file.filename,req.file.size,req.file.mimetype);res.status(201).json({id,name:path.basename(req.file.originalname),size:req.file.size});});
const canReadFiles=(u,owner)=>u.id===owner||(u.role==='organization'&&get('SELECT a.id FROM applications a JOIN internships i ON i.id=a.internship_id WHERE a.student_id=? AND i.organization_id=?',owner,u.id))||(u.role==='coordinator'&&canCoordinateStudent(db,u.id,owner));
app.get('/api/files/:id',auth(),(req,res)=>{const f=get('SELECT * FROM files WHERE id=?',req.params.id);if(!f)fail(404,'Файл не найден');if(!canReadFiles(req.user,f.user_id))fail(403,'Нет доступа к файлу');res.download(path.join(data,'uploads',f.stored_name),f.name);});
app.delete('/api/files/:id',auth('student'),(req,res)=>{const f=get('SELECT * FROM files WHERE id=? AND user_id=?',req.params.id,req.user.id);if(!f)fail(404,'Файл не найден');run('DELETE FROM files WHERE id=?',f.id);try{unlinkSync(path.join(data,'uploads',f.stored_name));}catch{}res.json({ok:true});});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
app.get('/api/applications/:id/report',auth(),(req,res)=>{
 const a=ownApp(req.params.id,req.user),v=appView(a);if(a.status!=='completed'||!v.review)fail(400,'Отчёт появится после завершения практики');
 const p=v.internship,r=v.review;
 res.setHeader('Content-Disposition','attachment; filename="practice-report.html"');res.type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Отчёт о практике</title><style>body{font:16px/1.6 Arial;max-width:800px;margin:60px auto;color:#292524;padding:20px}h1{color:#c65326}h2{margin-top:28px}pre{white-space:pre-wrap;font:inherit}button{padding:12px 20px;background:#ed6b32;color:white;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}body{margin:0}}</style><button onclick="window.print()">Распечатать</button><h1>Отчёт о производственной практике</h1><p>Сформирован ${escape(new Date(r.created_at).toLocaleDateString('ru-RU'))}</p><p><b>Студент:</b> ${escape(v.student.name)}<br><b>Учебное заведение:</b> ${escape(v.student.profile.school)}<br><b>Организация:</b> ${escape(p.organization_name)}<br><b>Практика:</b> ${escape(p.title)}<br><b>Период:</b> ${escape(p.start_date)} — ${escape(p.end_date)}<br><b>Наставник:</b> ${escape(p.mentor)}</p><h2>Запланированные задачи</h2><ul>${p.tasks.map(t=>`<li>${escape(t)}</li>`).join('')}</ul><h2>Результаты практики</h2><pre>${escape(r.results)}</pre><h2>Отзыв наставника</h2><pre>${escape(r.text)}</pre><p><b>Оценка:</b> ${r.rating} из 5</p><p>Подпись наставника: __________________<br>Подпись студента: __________________</p><small>Практио. Отчёт подготовлен по сведениям организации.</small></html>`);
});
registerCollegeRoutes(app,{db,auth,fail,text,practice,appView,self});
registerDiaryRoutes(app,{db,auth,fail,text,practice,appView});
registerDaDataRoutes(app,{auth});
registerGithubRoutes(app,{auth,db,self});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'praktika',database:'sqlite'}));
if(existsSync(path.join(root,'dist'))){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
app.use((err,req,res,next)=>{const code=err.code==='LIMIT_FILE_SIZE'?400:(err.status||500);if(code>=500&&!err.publicMessage)console.error(err);res.status(code).json({error:err.code==='LIMIT_FILE_SIZE'?'Максимальный размер файла — 10 МБ':code>=500?(err.publicMessage||'Ошибка сервера. Попробуйте ещё раз.'):err.message});});
const port=Number(process.env.PORT||3080);
app.listen(port,'127.0.0.1',()=>console.log(`Практио API: http://localhost:${port}`));


export {db};
