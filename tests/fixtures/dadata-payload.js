// Synthetic records used only in tests. These are not live DaData results.
export function party(inn='7707083893'){
 const individual=inn.length===12;
 return {value:individual?'ИП Тестовый':'ООО "Тестовая компания"',data:{inn,kpp:individual?null:'770701001',ogrn:individual?'315784700000001':'1027700132195',branch_type:'MAIN',name:{short_with_opf:individual?'ИП Тестовый':'ООО "Тестовая компания"',full_with_opf:individual?'Индивидуальный предприниматель Тестовый':'Общество с ограниченной ответственностью "Тестовая компания"'},address:{value:'г Москва, ул Тестовая, д 1',unrestricted_value:'123456, г Москва, ул Тестовая, д 1',data:{city:individual?null:'Москва',settlement:individual?'Тестовый посёлок':null,region:'Москва'}},okved:'62.01',okveds:[{main:true,name:'Разработка компьютерного программного обеспечения'}],state:{status:'ACTIVE'},management:{name:'Лишние данные не передавать в приложение'}}};
}
