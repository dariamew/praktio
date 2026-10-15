// Isolated test process only. Never imported by the production server.
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.github.com/users/')){
  const parsed=new URL(url),page=Number(parsed.searchParams.get('page'));
  const repositories=Array.from({length:page===1?30:1},(_,i)=>({id:page===1?i+1:31,name:'project-'+(page===1?i+1:31),owner:{login:'student-dev'},private:false,description:'Учебный проект',language:'TypeScript',fork:false,html_url:'https://evil.example/ignored'}));
  return Response.json(repositories);
 }
 return realFetch(url,options);
};
