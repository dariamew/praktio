import { useState } from 'react';
import { toast } from 'sonner';
import { GraduationCap,ArrowRight,Check,LoaderCircle,CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApprovalBadge } from './shared';
import { api } from '@/lib/api';
import type { User,Approval } from '@/types';
import { date } from '@/types';
export function StudentCollegeCard({user,onUpdate}:{user:User;onUpdate:(u:User)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');if(user.role!=='student')return null;
 async function join(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');try{onUpdate(await api<User>('/me/group','POST',{code:new FormData(e.currentTarget).get('code')}));toast.success('Вы вступили в группу');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function leave(){setBusy(true);try{onUpdate(await api<User>('/me/group','DELETE'));toast.success('Вы вышли из группы');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
 return <section className="surface student-college-card"><div className="student-college-heading"><span className="mini-icon"></span><div><h2>Учебное заведение</h2><p>{user.group?user.group.college_name:'Присоединитесь к своей учебной группе.'}</p></div>{user.group&&<span className="group-chip">{user.group.name}</span>}</div>{user.group?<><div className="student-group-facts"><span>Координатор: {user.group.coordinator_name}</span><span>Период группы: {date(user.group.start_date)} — {date(user.group.end_date)}</span></div><p className="field-hint">Координатор видит профиль, портфолио и отклики.</p><Button variant="ghost" size="sm" disabled={busy} onClick={leave}>Выйти из группы</Button></>:<form onSubmit={join}><Label htmlFor="join-code">Код группы</Label><div className="join-code-form"><Input id="join-code" name="code" placeholder="Введите код от координатора" required maxLength={40} autoComplete="off"/><Button disabled={busy} type="submit">{busy?<LoaderCircle size={16} className="animate-spin"/>:<ArrowRight size={16}/>}Вступить</Button></div><p className="field-hint">При вступлении координатор получит доступ к профилю, портфолио и откликам.</p>{error&&<p className="form-error" role="alert">{error}</p>}</form>}</section>;
}
export function ApprovalSummary({approval}:{approval:Approval|null|undefined}){if(!approval)return null;return <div className="student-approval-summary"><div><span>{approval.college_name} / {approval.group_name}</span><ApprovalBadge state={approval.state}/></div>{approval.comment&&<p>{approval.comment}</p>}{approval.reason&&<p className="approval-changed">{approval.reason}</p>}</div>;}
