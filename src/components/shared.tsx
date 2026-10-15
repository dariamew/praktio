import { quantity } from '@/lib/format';
import type { ReactNode } from 'react';
import { ArrowUpRight, MapPin, CalendarDays, Users, Bookmark, Check, ArrowRight, Sparkles, BriefcaseBusiness,ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog,DialogContent,DialogTitle,DialogDescription,DialogHeader } from '@/components/ui/dialog';
import type { Practice,User,Status,ApprovalState } from '@/types';
import { date,money,match,STATUS,APPROVAL } from '@/types';
export function ApprovalBadge({state}:{state:ApprovalState}){return <Badge className={`approval-badge approval-${state}`}>{APPROVAL[state]}</Badge>;}
export function Modal({open,onClose,title,description,children,wide=false}:{open:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;wide?:boolean}){
 return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className={wide?'modal-wide':'modal-standard'} {...(!description?{'aria-describedby':undefined}:{})}><DialogHeader><DialogTitle>{title}</DialogTitle>{description&&<DialogDescription>{description}</DialogDescription>}</DialogHeader>{children}</DialogContent></Dialog>;
}
export function Brand({name,large=false}:{name:string;id:string;large?:boolean}){return <div className={`brand-tile ${large?'large':''}`} aria-hidden="true">{name.slice(0,1)}</div>;}
export function StatusBadge({status}:{status:Status}){return <Badge className={`status-badge status-${status}`}>{STATUS[status]}</Badge>;}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}){return <div className="empty-state"><h2>{title}</h2>{description&&<p>{description}</p>}{action}</div>;}
export function PracticeCard({p,user,saved,applied,onOpen,onSave}:{p:Practice;user:User|null;saved:boolean;applied:boolean;onOpen:()=>void;onSave:()=>void}){
 const fit=match(p,user);return <article className="practice-card">
 <div className="card-top"><div className="company-line"><Brand name={p.organization_name} id={p.organization_id}/><div><span className="company-name">{p.organization_name}</span><span className="company-industry">{p.category}</span></div></div><button className={`icon-button bookmark ${saved?'saved':''}`} onClick={onSave} aria-label={saved?'Убрать из избранного':'Сохранить практику'}><Bookmark size={19} fill={saved?'currentColor':'none'}/></button></div>
 <div className="card-title-line"><h2 className="card-title-heading"><button className="card-title" onClick={onOpen}>{p.title}</button></h2></div>
 <div className="card-meta"><span><MapPin size={14}/>{p.city}</span><span>{p.format}</span></div>
 
 <div className="skill-row">{p.skills.slice(0,3).map(s=><Badge variant="secondary" key={s}>{s}</Badge>)}{p.skills.length>3&&<span className="more-skills">+{p.skills.length-3}</span>}</div>
 <div className="period"><CalendarDays size={15}/><span>{date(p.start_date)} — {date(p.end_date)}</span><span className="place-count"><Users size={14}/>{quantity(Math.max(0,p.places-p.occupied),'место','места','мест')}</span></div>
 <div className="card-bottom"><div className="payment">{money(p.payment)}{p.payment>0&&<small> / месяц</small>}</div><Button variant="outline" size="sm" onClick={onOpen}>{applied?<><Check size={15}/>Вы откликнулись</>:<>Подробнее<ArrowUpRight size={15}/></>}</Button></div>
 {user?.role==='student'&&fit.found.length>0&&<div className="fit-line">{fit.percent}% навыков совпадают</div>}
 </article>;
}
export function Step({number,title,description,done=false}:{number:string;title:string;description:string;done?:boolean}){return <div className="guide-step"><span className={done?'step-number done':'step-number'}>{done?<Check size={14}/>:number}</span><div><b>{title}</b><p>{description}</p></div></div>;}
export function ArrowLink({children,onClick}:{children:ReactNode;onClick:()=>void}){return <button className="arrow-link" onClick={onClick}>{children}<ArrowRight size={16}/></button>;}
