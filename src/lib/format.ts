const rules=new Intl.PluralRules('ru');
export function quantity(value:number,one:string,few:string,many:string){
 const form=rules.select(value);
 return `${value.toLocaleString('ru-RU')} ${form==='one'?one:form==='few'?few:many}`;
}
