import {party} from './dadata-payload.js';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
 if(input!=='https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party')return nativeFetch(input,options);
 if(options?.headers?.Authorization!=='Token test-key')return Response.json({error:'Upstream secret must not leak'},{status:403});
 const query=JSON.parse(options.body).query;
 if(query==='7719402047')return Response.json({suggestions:[]});
 if(query==='7721581040')return Response.json({error:'test-key'},{status:429});
 return Response.json({suggestions:[party(query)]});
};
