import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function setupCollege(db,dataDirectory){
 const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
 if(!schema.includes("'coordinator'")){
  mkdirSync(path.join(dataDirectory,'backups'),{recursive:true});
  const backup=path.join(dataDirectory,'backups',`before-college-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try{
   db.exec(`CREATE TABLE users_new(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('student','organization','coordinator')),name TEXT NOT NULL,profile TEXT NOT NULL);
   INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT;`);
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('College migration: foreign key check failed');
 }
 db.exec(`CREATE TABLE IF NOT EXISTS colleges(id TEXT PRIMARY KEY,coordinator_id TEXT UNIQUE NOT NULL REFERENCES users(id),name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS college_groups(id TEXT PRIMARY KEY,college_id TEXT NOT NULL REFERENCES colleges(id),name TEXT NOT NULL,specialty TEXT NOT NULL,course TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',invite_code TEXT UNIQUE NOT NULL,archived INTEGER NOT NULL DEFAULT 0,UNIQUE(college_id,name));
 CREATE TABLE IF NOT EXISTS group_members(student_id TEXT PRIMARY KEY REFERENCES users(id),group_id TEXT NOT NULL REFERENCES college_groups(id),joined_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS college_approvals(application_id TEXT PRIMARY KEY REFERENCES applications(id),college_id TEXT NOT NULL REFERENCES colleges(id),group_id TEXT NOT NULL REFERENCES college_groups(id),state TEXT NOT NULL CHECK(state IN ('approved','changes_requested')),comment TEXT NOT NULL,snapshot TEXT NOT NULL,updated_at TEXT NOT NULL,history TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_college_groups ON college_groups(college_id);
 CREATE INDEX IF NOT EXISTS idx_group_members ON group_members(group_id);`);
}
export function studentGroup(db,studentId){return db.prepare(`SELECT g.*,c.name as college_name,c.coordinator_id,u.name as coordinator_name FROM group_members m JOIN college_groups g ON g.id=m.group_id JOIN colleges c ON c.id=g.college_id JOIN users u ON u.id=c.coordinator_id WHERE m.student_id=?`).get(studentId)||null;}
export function canCoordinateStudent(db,coordinatorId,studentId){return !!db.prepare('SELECT m.student_id FROM group_members m JOIN college_groups g ON g.id=m.group_id JOIN colleges c ON c.id=g.college_id WHERE m.student_id=? AND c.coordinator_id=?').get(studentId,coordinatorId);}
const overlaps=(p,g)=>p.end_date>=g.start_date&&p.start_date<=g.end_date;
const signature=(p,g)=>createHash('sha256').update(JSON.stringify([p.organization_id,p.title,p.category,p.city,p.format,p.start_date,p.end_date,p.tasks,p.outcomes,p.mentor,p.skills,p.description,p.payment,g.id,g.specialty,g.course,g.start_date,g.end_date,g.notes])).digest('hex');
export function approvalFor(db,application,internship){
 const group=studentGroup(db,application.student_id);if(!group||!['accepted','completed'].includes(application.status)||!overlaps(internship,group))return null;
 const record=db.prepare('SELECT * FROM college_approvals WHERE application_id=?').get(application.id);
 const current=record&&record.college_id===group.college_id&&record.group_id===group.id&&record.snapshot===signature(internship,group);
 return {state:current?record.state:'pending',comment:current?record.comment:'',updated_at:current?record.updated_at:null,college_name:group.college_name,group_name:group.name,group_id:group.id,version:signature(internship,group),reason:record&&!current?'Группа или условия практики изменились — нужно повторное согласование.':'',history:record?.college_id===group.college_id?JSON.parse(record.history):[]};
}
export function registerCollegeRoutes(app,{db,auth,fail,text,practice,appView,self}){
 const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const college=u=>{const c=get('SELECT * FROM colleges WHERE coordinator_id=?',u.id);if(!c)fail(404,'Учебное заведение не найдено');return c;};
 const ownedGroup=(id,u)=>{const c=college(u),g=get('SELECT * FROM college_groups WHERE id=? AND college_id=?',id,c.id);if(!g)fail(404,'Группа не найдена в вашем учебном заведении');return g;};
 function groupData(body){
  const name=text(body.name,'Название группы',60,true),specialty=text(body.specialty,'Специальность',200,true),course=text(body.course,'Курс',60,true),start=text(body.start_date,'Начало',10,true),end=text(body.end_date,'Окончание',10,true),notes=text(body.notes??'','Примечания',2000);
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!valid(start)||!valid(end)||end<start)fail(400,'Проверьте период практики группы');return [name,specialty,course,start,end,notes];
 }
 function roster(u){
  const c=college(u);const groups=all('SELECT * FROM college_groups WHERE college_id=? AND archived=0 ORDER BY name',c.id);
  const students=all('SELECT u.id,u.name,u.email,u.profile,m.group_id,m.joined_at FROM group_members m JOIN users u ON u.id=m.student_id JOIN college_groups g ON g.id=m.group_id WHERE g.college_id=? AND g.archived=0 ORDER BY u.name',c.id).map(s=>{
   const group=groups.find(g=>g.id===s.group_id);const applications=all('SELECT * FROM applications WHERE student_id=? ORDER BY updated_at DESC',s.id).map(appView).filter(a=>overlaps(a.internship,group));
   const placements=applications.filter(a=>['accepted','completed'].includes(a.status));
   const approved=placements.some(a=>a.approval?.state==='approved');
   const state=approved?'approved':placements.length?'found':applications.some(a=>['sent','reviewing'].includes(a.status))?'searching':'no_place';
   return {...s,profile:JSON.parse(s.profile),files:all('SELECT id,name,size,mime FROM files WHERE user_id=?',s.id),group_name:group.name,applications,placements,state};
  });
  return {college:c,groups:groups.map(g=>({...g,student_count:students.filter(s=>s.group_id===g.id).length})),archived_groups:all('SELECT * FROM college_groups WHERE college_id=? AND archived=1 ORDER BY name',c.id),students,stats:{total:students.length,no_place:students.filter(s=>s.state==='no_place').length,searching:students.filter(s=>s.state==='searching').length,found:students.filter(s=>['found','approved'].includes(s.state)).length,approved:students.filter(s=>s.state==='approved').length,pending:students.flatMap(s=>s.placements).filter(a=>a.approval?.state==='pending').length}};
 }
 app.get('/api/coordinator/dashboard',auth('coordinator'),(req,res)=>res.json(roster(req.user)));
 app.post('/api/coordinator/groups',auth('coordinator'),(req,res)=>{
  const c=college(req.user),values=groupData(req.body);if(get('SELECT id FROM college_groups WHERE college_id=? AND name=?',c.id,values[0]))fail(409,'Группа с таким названием уже существует');
  const id=randomUUID(),code=randomBytes(5).toString('hex').toUpperCase();run('INSERT INTO college_groups(id,college_id,name,specialty,course,start_date,end_date,notes,invite_code) VALUES(?,?,?,?,?,?,?,?,?)',id,c.id,...values,code);res.status(201).json(get('SELECT * FROM college_groups WHERE id=?',id));
 });
 app.patch('/api/coordinator/groups/:id',auth('coordinator'),(req,res)=>{
  const g=ownedGroup(req.params.id,req.user);if(g.archived)fail(400,'Группа находится в архиве');
  const values=groupData(req.body);if(get('SELECT id FROM college_groups WHERE college_id=? AND name=? AND id<>?',g.college_id,values[0],g.id))fail(409,'Группа с таким названием уже существует');
  run('UPDATE college_groups SET name=?,specialty=?,course=?,start_date=?,end_date=?,notes=? WHERE id=?',...values,g.id);res.json(get('SELECT * FROM college_groups WHERE id=?',g.id));
 });
 app.delete('/api/coordinator/groups/:id',auth('coordinator'),(req,res)=>{const g=ownedGroup(req.params.id,req.user);if(get('SELECT COUNT(*) as count FROM group_members WHERE group_id=?',g.id).count)fail(409,'Сначала переведите или исключите студентов из группы');run('UPDATE college_groups SET archived=1 WHERE id=?',g.id);res.json({ok:true});});
 app.post('/api/coordinator/groups/:id/restore',auth('coordinator'),(req,res)=>{const g=ownedGroup(req.params.id,req.user);run('UPDATE college_groups SET archived=0 WHERE id=?',g.id);res.json(get('SELECT * FROM college_groups WHERE id=?',g.id));});
 app.post('/api/coordinator/groups/:id/code',auth('coordinator'),(req,res)=>{const g=ownedGroup(req.params.id,req.user);if(g.archived)fail(400,'Группа находится в архиве');const code=randomBytes(5).toString('hex').toUpperCase();run('UPDATE college_groups SET invite_code=? WHERE id=?',code,g.id);res.json({invite_code:code});});
 app.patch('/api/coordinator/students/:id',auth('coordinator'),(req,res)=>{
  if(!canCoordinateStudent(db,req.user.id,req.params.id))fail(404,'Студент не состоит в вашем колледже');const g=ownedGroup(req.body.group_id,req.user);if(g.archived)fail(400,'Группа находится в архиве');run('UPDATE group_members SET group_id=? WHERE student_id=?',g.id,req.params.id);res.json({ok:true});
 });
 app.delete('/api/coordinator/students/:id',auth('coordinator'),(req,res)=>{if(!canCoordinateStudent(db,req.user.id,req.params.id))fail(404,'Студент не состоит в вашем колледже');run('DELETE FROM group_members WHERE student_id=?',req.params.id);res.json({ok:true});});
 app.post('/api/me/group',auth('student'),(req,res)=>{
  if(studentGroup(db,req.user.id))fail(409,'Вы уже состоите в группе. Координатор может перевести вас в другую группу колледжа.');
  const code=text(req.body.code,'Код группы',40,true).toUpperCase();const g=get('SELECT * FROM college_groups WHERE invite_code=? AND archived=0',code);if(!g)fail(404,'Код группы не найден. Уточните его у координатора.');
  run('INSERT INTO group_members VALUES(?,?,?)',req.user.id,g.id,new Date().toISOString());res.json(self(req.user));
 });
 app.delete('/api/me/group',auth('student'),(req,res)=>{run('DELETE FROM group_members WHERE student_id=?',req.user.id);res.json(self(req.user));});
 app.patch('/api/coordinator/approvals/:id',auth('coordinator'),(req,res)=>{
  const a=get('SELECT * FROM applications WHERE id=?',req.params.id);if(!a||!canCoordinateStudent(db,req.user.id,a.student_id))fail(404,'Практика не найдена в вашем учебном заведении');
  const p=practice(a.internship_id),g=studentGroup(db,a.student_id);if(!['accepted','completed'].includes(a.status))fail(400,'Сначала организация должна принять студента');if(!overlaps(p,g))fail(400,'Практика не попадает в период группы');
  const state=req.body.state;if(!['approved','changes_requested'].includes(state))fail(400,'Выберите решение');
  const comment=text(req.body.comment??'','Комментарий',2000,state==='changes_requested');const now=new Date().toISOString();
  if(req.body.version!==signature(p,g))fail(409,'Условия практики или группы изменились. Откройте карточку заново и проверьте их перед решением.');
  const old=get('SELECT * FROM college_approvals WHERE application_id=?',a.id),history=old?.college_id===g.college_id?JSON.parse(old.history):[];
  history.push({state,comment,at:now,coordinator_name:req.user.name,group_name:g.name});
  run('INSERT INTO college_approvals VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(application_id) DO UPDATE SET college_id=excluded.college_id,group_id=excluded.group_id,state=excluded.state,comment=excluded.comment,snapshot=excluded.snapshot,updated_at=excluded.updated_at,history=excluded.history',a.id,g.college_id,g.id,state,comment,signature(p,g),now,JSON.stringify(history));res.json(appView(a));
 });
 app.get('/api/coordinator/export',auth('coordinator'),(req,res)=>{
  const data=roster(req.user),cell=s=>{const value=String(s??'');return '"'+(/^[=+@\-\t\r]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';};
  const labels={approved:'Согласовано',found:'Место найдено, не согласовано',searching:'Есть отклики, места пока нет',no_place:'Без места'};
  const rows=[['Группа','Студент','Email','Статус','Практика','Организация','Начало','Окончание','Согласование'],...data.students.map(s=>{const p=s.placements.find(a=>a.approval?.state==='approved')||s.placements[0];return [s.group_name,s.name,s.email,labels[s.state],p?.internship.title||'',p?.internship.organization_name||'',p?.internship.start_date||'',p?.internship.end_date||'',p?({approved:'Согласовано',pending:'Ожидает решения',changes_requested:'Нужны уточнения'}[p.approval?.state||'pending']):''];})];
  res.setHeader('Content-Disposition','attachment; filename="college-placement.csv"');res.type('text/csv; charset=utf-8').send('\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n'));
 });
}
