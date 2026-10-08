export function cityList(value){
 const seen=new Set();
 return (Array.isArray(value)?value:typeof value==='string'?value.split('|'):[]).filter(v=>typeof v==='string').map(v=>v.trim().normalize('NFC')).filter(v=>{const key=v.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ');if(!v||seen.has(key))return false;seen.add(key);return true;});
}
export function cityMetadata(rows){
 const result=new Map();
 if(!Array.isArray(rows))throw Error('EVENT_CITIES_INVALID');
 for(const row of rows){if(typeof row.event_id!=='string'||!row.event_id||result.has(row.event_id))throw Error('EVENT_CITIES_DUPLICATE_OR_INVALID_ID');result.set(row.event_id,cityList(row.cities));}
 return result;
}
export function withCities(event,metadata){return {...event,cities:metadata.get(event.id)||[],cities_source:metadata.has(event.id)?'EVENT_CITIES':null};}
