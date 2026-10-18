import {TRIP} from './config.js';
export const currencyPrefix=currency=>new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'narrowSymbol'}).formatToParts(0).find(p=>p.type==='currency').value;
export function formatMoney(amount,currency=TRIP.currency,{iso=false,digits}={}){
 if(amount==null||!Number.isFinite(Number(amount)))return '—';
 const parts=new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'narrowSymbol',...(digits==null?{}:{minimumFractionDigits:digits,maximumFractionDigits:digits})}).formatToParts(Math.abs(Number(amount)));
 const prefix=currencyPrefix(currency);
 const number=parts.filter(p=>['integer','group','decimal','fraction'].includes(p.type)).map(p=>p.value).join('');
 return `${Number(amount)<0?'-':''}${prefix}${/^[A-Z]+$/.test(prefix)?' ':''}${number}${iso&&prefix!==currency?' '+currency:''}`;
}
export function formatTime(value,timezone=null){
 if(!value)return '—';let hour,minute;
 if(timezone){const p=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));hour=Number(p.find(x=>x.type==='hour').value);minute=p.find(x=>x.type==='minute').value;}
 else{const match=/T(\d{2}):(\d{2})/.exec(value);if(!match)return '—';hour=Number(match[1]);minute=match[2];}
 return `${hour%12||12}:${minute} ${hour<12?'AM':'PM'} (${String(hour).padStart(2,'0')}:${minute})`;
}
export const formatEventTime=event=>event.allDay?'Todo el día':formatTime(event.start,event.timezone);
export function formatDateTime(value,timezone=Intl.DateTimeFormat().resolvedOptions().timeZone){return value?`${new Intl.DateTimeFormat('es',{timeZone:timezone,dateStyle:'medium'}).format(new Date(value))} · ${formatTime(value,timezone)}`:'Todavía no realizada';}
