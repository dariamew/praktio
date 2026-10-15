import { useState } from 'react';
import { ArrowRight,GraduationCap,Building2,LoaderCircle,ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from './shared';
import { api } from '@/lib/api';
import type { User,Role } from '@/types';
export default function AuthForm({open,onClose,onSuccess}:{open:boolean;onClose:()=>void;onSuccess:(u:User)=>void}){
 const [register,setRegister]=useState(false),[role,setRole]=useState<Role>('student'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function login(email:string,password:string){setBusy(true);setError('');try{const u=await api<User>('/auth/login','POST',{email,password});onSuccess(u);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));if(!register)return login(String(values.email),String(values.password));setBusy(true);setError('');try{const u=await api<User>('/auth/register','POST',{...values,role});onSuccess(u);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Modal open={open} onClose={onClose} title={register?'Регистрация':'Вход'} >
 <div className="auth-tabs"><button className={!register?'active':''} onClick={()=>{setRegister(false);setError('');}}>Вход</button><button className={register?'active':''} onClick={()=>{setRegister(true);setError('');}}>Регистрация</button></div>
 {register&&<div className="role-picker role-picker-three">{([{id:'student',icon:GraduationCap,label:'Студент'},{id:'organization',icon:Building2,label:'Организация'},{id:'coordinator',icon:ClipboardCheck,label:'Координатор'}] as const).map(r=><button key={r.id} type="button" className={role===r.id?'active':''} onClick={()=>setRole(r.id)}><b>{r.label}</b></button>)}</div>}
 <form onSubmit={submit} className="form-stack">{register&&<div className="field"><Label htmlFor="auth-name">{role==='organization'?'Название организации':'Имя и фамилия'}</Label><Input id="auth-name" name="name" required maxLength={100} autoComplete="name" placeholder={role==='organization'?'Укажите название':'Укажите имя и фамилию'}/></div>}{register&&role==='coordinator'&&<div className="field"><Label htmlFor="auth-college">Учебное заведение</Label><Input id="auth-college" name="college_name" required maxLength={200} placeholder="Название учебного заведения"/></div>}<div className="field"><Label htmlFor="auth-email">Электронная почта</Label><Input id="auth-email" name="email" type="email" required autoComplete="email" placeholder="Ваша электронная почта"/></div><div className="field"><Label htmlFor="auth-password">Пароль</Label><Input id="auth-password" name="password" type="password" required minLength={register?8:1} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder={register?'Не менее 8 символов':'Ваш пароль'}/></div>{error&&<p className="form-error" role="alert">{error}</p>}<Button disabled={busy} type="submit" className="full-width">{busy?<LoaderCircle className="animate-spin" size={17}/>:<>{register?'Создать аккаунт':'Войти'}<ArrowRight size={17}/></>}</Button></form>

 </Modal>;
}


