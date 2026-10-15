import { randomUUID } from 'node:crypto';
import { approvalFor, canCoordinateStudent, studentGroup } from './college.js';

const labels = { draft:'Черновик', submitted:'На проверке', changes_requested:'На доработке', approved:'Принято' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupDiary(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS diary_entries(
 id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES applications(id),date TEXT NOT NULL,
 tasks TEXT NOT NULL,hours REAL NOT NULL CHECK(hours>0 AND hours<=24),results TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','submitted','changes_requested','approved')),
 comment TEXT NOT NULL DEFAULT '',context TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
 history TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_diary_application ON diary_entries(application_id,date);`);
}

export function registerDiaryRoutes(app, { db, auth, fail, text, practice, appView }) {
 const get = (sql,...args) => db.prepare(sql).get(...args);
 const run = (sql,...args) => db.prepare(sql).run(...args);
 function access(id,user) {
  const a=get('SELECT * FROM applications WHERE id=?',id);
  if (!a || !(user.role==='student'&&a.student_id===user.id || user.role==='coordinator'&&canCoordinateStudent(db,user.id,a.student_id))) fail(404,'Дневник не найден');
  if (!['accepted','completed'].includes(a.status)) fail(400,'Дневник доступен после принятия студента');
  return a;
 }
 function context(a) { const p=practice(a.internship_id), approval=approvalFor(db,a,p); return {p,approval}; }
 function entryView(e,a) {
  const {approval}=context(a);
  const stale=e.status!=='draft'&&(!approval || e.context!==approval.version);
  return {...e,history:JSON.parse(e.history),status:stale?'changes_requested':e.status,
   comment:stale?'Группа или условия практики изменились. Отправьте запись повторно после согласования.':e.comment};
 }
 function entries(a) {return db.prepare('SELECT * FROM diary_entries WHERE application_id=? ORDER BY date,id').all(a.id).map(e=>entryView(e,a));}
 function summary(rows) {
  return {count:rows.length,total_hours:rows.reduce((sum,e)=>sum+e.hours,0),approved_hours:rows.filter(e=>e.status==='approved').reduce((sum,e)=>sum+e.hours,0),pending:rows.filter(e=>e.status==='submitted').length,returned:rows.filter(e=>e.status==='changes_requested').length};
 }
 function checked(a) {
  const c=context(a);if(c.approval?.state!=='approved') fail(409,'Сначала координатор должен согласовать место и условия практики');return c;
 }
 function version(e,body) {if(body.revision!==e.revision) fail(409,'Запись уже изменена. Обновите дневник перед действием');}
 function entryData(body,a,id='') {
  const date=text(body.date,'Дата',10,true),{p}=context(a);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<p.start_date||date>p.end_date) fail(400,'Дата записи должна попадать в период практики');
  const hours=body.hours;
  if(typeof hours!=='number'||!Number.isFinite(hours)||hours<0.25||hours>24||!Number.isInteger(hours*4)) fail(400,'Укажите часы от 0,25 до 24 с шагом 0,25');
  const total=get('SELECT COALESCE(SUM(hours),0) AS hours FROM diary_entries WHERE application_id=? AND date=? AND id<>?',a.id,date,id).hours;
  if(total+hours>24) fail(400,'За один день нельзя записать больше 24 часов');
  return [date,text(body.tasks,'Задачи',5000,true),hours,text(body.results,'Результаты',5000,true)];
 }
 app.get('/api/diaries',auth(),(req,res)=>{
  if(!['student','coordinator'].includes(req.user.role)) fail(403,'Дневники доступны студентам и координаторам');
  const rows=req.user.role==='student'?db.prepare("SELECT * FROM applications WHERE student_id=? AND status IN ('accepted','completed') ORDER BY updated_at DESC").all(req.user.id):db.prepare("SELECT a.* FROM applications a JOIN group_members m ON m.student_id=a.student_id JOIN college_groups g ON g.id=m.group_id JOIN colleges c ON c.id=g.college_id WHERE c.coordinator_id=? AND a.status IN ('accepted','completed') ORDER BY a.updated_at DESC").all(req.user.id);
  res.json(rows.map(a=>({application:appView(a),summary:summary(entries(a))})));
 });
 app.get('/api/applications/:id/diary',auth(),(req,res)=>{
  const a=access(req.params.id,req.user),rows=entries(a);res.json({application:appView(a),entries:rows,summary:summary(rows)});
 });
 app.post('/api/applications/:id/diary',auth('student'),(req,res)=>{
  const a=access(req.params.id,req.user),values=entryData(req.body,a),now=new Date().toISOString(),id=randomUUID();
  run("INSERT INTO diary_entries(id,application_id,date,tasks,hours,results,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?)",id,a.id,...values,now,now);
  res.status(201).json(entryView(get('SELECT * FROM diary_entries WHERE id=?',id),a));
 });
 app.patch('/api/applications/:id/diary/:entryId',auth(),(req,res)=>{
  const a=access(req.params.id,req.user),e=get('SELECT * FROM diary_entries WHERE id=? AND application_id=?',req.params.entryId,a.id);
  if(!e) fail(404,'Запись не найдена');version(e,req.body);
  const current=entryView(e,a),action=req.body.action,now=new Date().toISOString();let state=current.status,comment=e.comment,entryContext=e.context;
  const history=JSON.parse(e.history);
  if(req.user.role==='student') {
   if(action==='save') {
    if(!['draft','changes_requested'].includes(current.status)) fail(409,'Можно редактировать только черновик или возвращённую запись');
    const values=entryData(req.body,a,e.id);
    run('UPDATE diary_entries SET date=?,tasks=?,hours=?,results=?,revision=revision+1,updated_at=? WHERE id=?',...values,now,e.id);
    res.json(entryView(get('SELECT * FROM diary_entries WHERE id=?',e.id),a));return;
   }
   if(action==='submit') {
    if(!['draft','changes_requested'].includes(current.status)) fail(409,'Запись уже отправлена или принята');
    const {approval}=checked(a);entryData(e,a,e.id);state='submitted';comment='';entryContext=approval.version;
    history.push({state,at:now,actor:req.user.name,comment:'',date:e.date,tasks:e.tasks,hours:e.hours,results:e.results});
   } else if(action==='recall') {
    if(current.status!=='submitted') fail(409,'Снять с проверки можно только отправленную запись');
    state='draft';comment='';history.push({state,at:now,actor:req.user.name,comment:'Снято с проверки'});
   } else fail(400,'Выберите действие');
  } else {
   checked(a);
   if(current.status!=='submitted') fail(409,'Запись уже проверена или требует повторной отправки');
   if(!['approve','return'].includes(action)) fail(400,'Выберите решение');
   state=action==='approve'?'approved':'changes_requested';comment=text(req.body.comment??'','Комментарий',2000,action==='return');
   history.push({state,at:now,actor:req.user.name,comment});
  }
  run('UPDATE diary_entries SET status=?,comment=?,context=?,revision=revision+1,history=?,updated_at=? WHERE id=?',state,comment,entryContext,JSON.stringify(history),now,e.id);
  res.json(entryView(get('SELECT * FROM diary_entries WHERE id=?',e.id),a));
 });
 app.delete('/api/applications/:id/diary/:entryId',auth('student'),(req,res)=>{
  const a=access(req.params.id,req.user),e=get('SELECT * FROM diary_entries WHERE id=? AND application_id=?',req.params.entryId,a.id);
  if(!e) fail(404,'Запись не найдена');version(e,req.body);
  if(!['draft','changes_requested'].includes(entryView(e,a).status)) fail(409,'Можно удалить только черновик или возвращённую запись');
  run('DELETE FROM diary_entries WHERE id=?',e.id);res.json({ok:true});
 });
 app.get('/api/applications/:id/diary/export',auth(),(req,res)=>{
  const a=access(req.params.id,req.user),v=appView(a),p=v.internship,rows=entries(a),s=summary(rows),report=req.query.kind==='report';
  if(!rows.length) fail(400,'Сначала добавьте записи в дневник');
  if(report) {
   checked(a);
   if(a.status!=='completed') fail(409,'Итоговый отчёт доступен после завершения практики организацией');
   if(rows.some(e=>e.status!=='approved')) fail(409,'Для итогового отчёта куратор должен принять все записи дневника');
  }
  const group=studentGroup(db,a.student_id),title=report?'Отчёт о производственной практике':'Дневник практики';
  const table=`<table><thead><tr><th>Дата</th><th>Задачи</th><th>Часы</th><th>Результаты</th>${report?'':'<th>Проверка</th>'}</tr></thead><tbody>${rows.map(e=>`<tr><td>${escape(e.date)}</td><td class="text">${escape(e.tasks)}</td><td>${e.hours}</td><td class="text">${escape(e.results)}</td>${report?'':`<td>${labels[e.status]}${e.comment?`<br>${escape(e.comment)}`:''}</td>`}</tr>`).join('')}</tbody></table>`;
  const conclusions=report?`<h2>Выполненная работа</h2>${rows.map(e=>`<h3>${escape(e.date)} — ${e.hours} ч</h3><p class="text">${escape(e.results)}</p>`).join('')}${v.review?`<h2>Отзыв наставника</h2><p class="text">${escape(v.review.text)}</p><h2>Результаты по оценке организации</h2><p class="text">${escape(v.review.results)}</p><p>Оценка: ${v.review.rating} из 5</p>`:''}`:'';
  res.setHeader('Content-Disposition',`attachment; filename="practice-${report?'report':'diary'}.html"`);
  res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px/1.5 Arial;color:#292524;max-width:1000px;margin:36px auto;padding:20px}h1{color:#bc542a}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{border:1px solid #d6d3d1;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}.text{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px 16px;cursor:pointer}@media print{button{display:none}body{margin:0;padding:0}tr{break-inside:avoid}@page{size:A4 landscape;margin:15mm}}</style></head><body><button onclick="window.print()">Распечатать</button><h1>${title}</h1><p><b>Студент:</b> ${escape(v.student.name)}<br><b>Учебное заведение:</b> ${escape(group?.college_name||v.student.profile.school)}<br><b>Группа:</b> ${escape(group?.name)}<br><b>Организация:</b> ${escape(p.organization_name)}<br><b>Практика:</b> ${escape(p.title)}<br><b>Период:</b> ${escape(p.start_date)} — ${escape(p.end_date)}<br><b>Наставник:</b> ${escape(p.mentor)}<br><b>Куратор:</b> ${escape(group?.coordinator_name)}</p>${report?`<h2>Задание на практику</h2><ul>${p.tasks.map(t=>`<li>${escape(t)}</li>`).join('')}</ul>`:''}${table}<p><b>Всего часов:</b> ${s.total_hours}. <b>Принято:</b> ${s.approved_hours} ч.</p>${conclusions}<p>Подпись студента: __________________<br>Подпись куратора: __________________</p><small>Сформировано ${escape(new Date().toLocaleDateString('ru-RU'))}. ${report?'Все записи приняты куратором.':'Статусы записей указаны на момент выгрузки.'}</small></body></html>`);
 });
}
