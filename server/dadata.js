const PARTY_URL='https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const error=(status,message)=>Object.assign(new Error(message),{status,publicMessage:message});

export function validInn(value){
 if(typeof value!=='string'||! /^(?:\d{10}|\d{12})$/.test(value)||/^0+$/.test(value))return false;
 const digits=[...value].map(Number),check=weights=>weights.reduce((sum,w,i)=>sum+w*digits[i],0)%11%10;
 return digits.length===10?check([2,4,10,3,5,9,4,6,8])===digits[9]:check([7,2,4,10,3,5,9,4,6,8])===digits[10]&&check([3,7,2,4,10,3,5,9,4,6,8])===digits[11];
}
const string=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function setupCompanyProfiles(db){
 db.exec("UPDATE users SET profile=json_remove(profile,'$.legal_name','$.kpp','$.ogrn','$.address','$.okved') WHERE role='organization' AND (json_type(profile,'$.legal_name') IS NOT NULL OR json_type(profile,'$.kpp') IS NOT NULL OR json_type(profile,'$.ogrn') IS NOT NULL OR json_type(profile,'$.address') IS NOT NULL OR json_type(profile,'$.okved') IS NOT NULL)");
}
function normalizeParty(suggestion,inn){
 const d=suggestion.data,address=d.address?.data||{},name=string(d.name?.short_with_opf||d.name?.full_with_opf||suggestion.value,100);
 if(!name)throw error(502,'Не удалось найти полные сведения. Заполните профиль вручную.');
 const main=Array.isArray(d.okveds)?d.okveds.find(item=>item?.main):null;
 return {inn,name,city:string(address.city||address.settlement||address.region,200),industry:string(main?.name,200)};
}
export function createPartyLookup({apiKey=()=>process.env.DADATA_API_KEY||'',fetcher=fetch,timeoutMs=8000,now=Date.now}={}){
 const cache=new Map();
 return async inn=>{
  if(!validInn(inn))throw error(400,'Введите корректный ИНН из 10 или 12 цифр.');
  const token=apiKey().trim();
  if(!token)throw error(503,'Поиск сейчас недоступен. Заполните профиль вручную.');
  const saved=cache.get(inn);if(saved&&saved.expires>now())return {...saved.data};
  let response,payload;
  try{
   response=await fetcher(PARTY_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Token '+token},body:JSON.stringify({query:inn,branch_type:'MAIN',count:1}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  }catch(e){
   if(['TimeoutError','AbortError'].includes(e?.name))throw error(504,'Поиск занял слишком много времени. Попробуйте ещё раз.');
   throw error(503,'Поиск организации недоступен. Попробуйте позже или заполните профиль вручную.');
  }
  if(response.status===429)throw error(503,'Поиск временно недоступен. Попробуйте позже или заполните профиль вручную.');
  if([401,403].includes(response.status))throw error(503,'Автозаполнение недоступно. Заполните данные вручную.');
  if(!response.ok)throw error(502,'Поиск организации временно недоступен. Попробуйте позже.');
  try{payload=await response.json();}catch{throw error(502,'Не удалось получить сведения об организации. Попробуйте позже.');}
  if(!Array.isArray(payload?.suggestions))throw error(502,'Не удалось получить сведения об организации. Попробуйте позже.');
  const match=payload.suggestions.find(s=>s?.data?.inn===inn&&s.data.branch_type!=='BRANCH');
  if(!match)throw error(404,'Организация с таким ИНН не найдена.');
  const result=normalizeParty(match,inn);
  for(const [key,value] of cache)if(value.expires<=now())cache.delete(key);
  if(cache.size>=100)cache.delete(cache.keys().next().value);
  cache.set(inn,{data:result,expires:now()+5*60000});return {...result};
 };
}
export function registerDaDataRoutes(app,{auth,lookup=createPartyLookup(),now=Date.now}){
 const attempts=new Map();
 app.post('/api/organization/lookup-inn',auth('organization'),async(req,res)=>{
  const inn=typeof req.body.inn==='string'?req.body.inn.trim():'';
  if(!validInn(inn))throw error(400,'Введите корректный ИНН из 10 или 12 цифр.');
  for(const [key,value] of attempts)if(value.expires<=now())attempts.delete(key);
  const rate=attempts.get(req.user.id)||{count:0,expires:now()+60000};
  if(rate.count>=10){res.setHeader('Retry-After',Math.max(1,Math.ceil((rate.expires-now())/1000)));throw error(429,'Слишком много запросов. Попробуйте через минуту.');}
  rate.count++;attempts.set(req.user.id,rate);
  res.json(await lookup(inn));
 });
}
