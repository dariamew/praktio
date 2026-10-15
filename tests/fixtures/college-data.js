// Integration-test fixtures. Never imported by the application.
import {hashPassword} from '../../server/password.js';
import {DEMO_PASSWORD} from './sample-data.js';
export function seedCollege(db){
 if(db.prepare("SELECT id FROM colleges WHERE id='college-demo'").get())return;
 db.exec('BEGIN IMMEDIATE');
 try{
  const now=new Date().toISOString();
  const insert=db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)');
  insert.run('coordinator-demo','coordinator1@example.test',hashPassword(DEMO_PASSWORD),'coordinator','Елена Соколова',JSON.stringify({school:'Колледж информационных технологий',headline:'Координатор производственной практики',city:'Москва',skills:[]}));
  insert.run('student-college-4','student4@example.test',hashPassword(DEMO_PASSWORD),'student','Илья Ковалёв',JSON.stringify({school:'Колледж информационных технологий',course:'3 курс',headline:'Начинающий разработчик',city:'Москва',about:'Изучаю JavaScript и ищу первый проект для практики.',skills:['JavaScript','HTML/CSS']}));
  insert.run('student-college-5','student5@example.test',hashPassword(DEMO_PASSWORD),'student','София Белова',JSON.stringify({school:'Колледж информационных технологий',course:'3 курс',headline:'Backend-разработчик',city:'Москва',about:'Изучаю Node.js и работу с базами данных.',skills:['Node.js','SQL','Git']}));
  db.prepare('INSERT INTO colleges VALUES(?,?,?)').run('college-demo','coordinator-demo','Колледж информационных технологий');
  const g=db.prepare('INSERT INTO college_groups(id,college_id,name,specialty,course,start_date,end_date,notes,invite_code) VALUES(?,?,?,?,?,?,?,?,?)');
  g.run('group-demo-1','college-demo','ИС-31','Информационные системы и программирование','3 курс','2026-11-01','2027-01-15','Учебные задачи согласовываем с наставниками предприятий.','IS31DEMO');
  g.run('group-demo-2','college-demo','ДИ-41','Дизайн цифровых продуктов','4 курс','2026-11-01','2027-01-15','Важно получить кейс для портфолио по окончании практики.','DI41DEMO');
  const member=db.prepare('INSERT OR IGNORE INTO group_members VALUES(?,?,?)');
  for(const id of ['student-demo','student-2','student-college-4','student-college-5'])if(db.prepare('SELECT id FROM users WHERE id=?').get(id))member.run(id,'group-demo-1',now);
  if(db.prepare("SELECT id FROM users WHERE id='student-3'").get())member.run('student-3','group-demo-2',now);
  if(db.prepare("SELECT id FROM internships WHERE id='p-5'").get())db.prepare('INSERT OR IGNORE INTO applications VALUES(?,?,?,?,?,?,?,?)').run('a-college-demo','p-5','student-college-5','accepted','Хочу развиваться в backend-разработке и применить навыки SQL на реальном проекте.',now,now,JSON.stringify([{status:'sent',at:now},{status:'accepted',at:now}]));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
