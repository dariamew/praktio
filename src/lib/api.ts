export class ApiError extends Error { constructor(message:string,public status:number){super(message);} }
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}
 catch{throw new ApiError('Не удалось подключиться. Проверьте соединение и попробуйте ещё раз.',0);}
 let data;
 try{data=await response.json();}catch{throw new ApiError('Не удалось получить ответ. Попробуйте ещё раз.',response.status);}
 if(!response.ok)throw new ApiError(data.error||'Не удалось выполнить действие. Попробуйте ещё раз.',response.status);
 return data;
}
