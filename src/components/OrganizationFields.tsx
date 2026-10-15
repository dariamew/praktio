import {useState} from 'react';
import {toast} from 'sonner';
import {Check,LoaderCircle,Search} from 'lucide-react';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Label} from './ui/label';
import {Modal} from './shared';
import {api} from '@/lib/api';
import type {User,CompanyLookupResult} from '@/types';

function ManualField({label,name,value}:{label:string;name:string;value?:string}){
 return <div className="field"><Label htmlFor={'company-'+name}>{label}</Label><Input id={'company-'+name} name={name} defaultValue={value||''} maxLength={200}/></div>;
}
export default function OrganizationFields({user,busy,onBusy}:{user:User;busy:boolean;onBusy:(busy:boolean)=>void}){
 const p=user.profile;
 const [draft,setDraft]=useState(()=>({name:user.name,city:p.city||'',industry:p.industry||'',inn:p.inn||''}));
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[found,setFound]=useState<CompanyLookupResult|null>(null);
 function change(key:keyof typeof draft,value:string){setDraft(previous=>({...previous,[key]:value}));if(key==='inn')setError('');}
 function field(key:keyof typeof draft,label:string,max=200,required=false){return <div className="field"><Label htmlFor={'company-'+key}>{label}</Label><Input id={'company-'+key} name={key} value={draft[key]} onChange={e=>change(key,e.target.value)} maxLength={max} required={required}/></div>;}
 async function lookup(){setError('');setLoading(true);onBusy(true);try{setFound(await api<CompanyLookupResult>('/organization/lookup-inn','POST',{inn:draft.inn.trim()}));}catch(e){setError((e as Error).message);}finally{setLoading(false);onBusy(false);}}
 function apply(){if(!found)return;setDraft(previous=>({...previous,name:found.name,inn:found.inn,city:found.city||previous.city,industry:found.industry||previous.industry}));setFound(null);toast.success('Поля заполнены. Сохраните профиль.');}
 return <>
  <div className="company-lookup"><div className="field"><Label htmlFor="company-inn">ИНН</Label><div className="inn-controls"><Input id="company-inn" name="inn" inputMode="numeric" autoComplete="off" maxLength={12} pattern="[0-9]{10}([0-9]{2})?" value={draft.inn} disabled={loading} onChange={e=>change('inn',e.target.value)} placeholder="10 или 12 цифр"/><Button type="button" variant="outline" disabled={busy||loading||! /^(?:\d{10}|\d{12})$/.test(draft.inn.trim())} onClick={()=>void lookup()}>{loading?<LoaderCircle size={16} className="animate-spin"/>:<Search size={16}/>}Заполнить по ИНН</Button></div><p className="field-hint">Название, город и отрасль по ИНН</p></div>{error&&<p className="form-error" role="alert">{error}</p>}</div>
  <div className="form-grid">{field('name','Название организации',100,true)}<ManualField label="Коротко о компании" name="headline" value={p.headline}/>{field('city','Город')}{field('industry','Отрасль')}<ManualField label="Размер команды" name="size" value={p.size}/><ManualField label="Наставник" name="mentor" value={p.mentor}/></div>
  <Modal open={!!found} onClose={()=>setFound(null)} title="Данные организации" wide>{found&&<><h3 className="company-result-name">{found.name}</h3><dl className="company-result">{[['ИНН',found.inn],['Город',found.city],['Отрасль',found.industry]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="field-hint">Проверьте сведения перед заполнением профиля.</p><div className="dialog-actions"><Button type="button" variant="outline" onClick={()=>setFound(null)}>Отмена</Button><Button type="button" onClick={apply}><Check size={16}/>Заполнить форму</Button></div></>}</Modal>
 </>;
}
