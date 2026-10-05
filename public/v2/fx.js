import {validCurrency} from './domain.js';
const day=()=>new Date().toISOString().slice(0,10);
export class FrankfurterProvider {
  constructor(request=fetch){this.request=(...args)=>request(...args);}
  async get(currency,base='USD',date=null){
    const response=await this.request(`https://api.frankfurter.dev/v2/rate/${currency}/${base}${date?'?date='+encodeURIComponent(date):''}`,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error('FX_UNAVAILABLE');const row=await response.json();
    if(row.base!==currency||row.quote!==base||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(row.rate)||row.rate<=0)throw Error('FX_INVALID_RESPONSE');
    return{rate:row.rate,rate_date:row.date,source:'Frankfurter · fuentes oficiales',captured_at:new Date().toISOString()};
  }
}
export class ReferenceRates {
  constructor(provider=null,store=null,online=()=>navigator.onLine){this.provider=provider;this.store=store;this.online=online;this.pending=new Map();}
  async get(currency,base='USD',force=false){
    if(!validCurrency(currency)||!validCurrency(base))throw Error('Moneda ISO inválida');
    if(currency===base)return{rate:1,rate_date:day(),source:'identity',captured_at:new Date().toISOString(),cached:false,stale:false};
    const key=`fx-latest:${base}:${currency}`,saved=(await this.store?.get('meta',key))?.value;
    if(!this.provider)return saved?{...saved,cached:true,stale:saved.rate_date<day()}:null;
    if(this.store&&!this.online())return saved?{...saved,cached:true,stale:saved.rate_date<day()}:null;
    if(!force&&saved?.captured_at?.slice(0,10)===day())return{...saved,cached:true,stale:saved.rate_date<day()};
    if(this.pending.has(key))return this.pending.get(key);
    const pending=(async()=>{try{const rate=await this.provider.get(currency,base);if(this.store)await this.store.transaction(['meta'],tx=>{tx.objectStore('meta').put({id:`fx:${base}:${currency}:${rate.rate_date}`,value:rate});tx.objectStore('meta').put({id:key,value:rate});});return{...rate,cached:false,stale:rate.rate_date<day()};}catch{return saved?{...saved,cached:true,stale:true,unavailable:true}:null;}finally{this.pending.delete(key);}})();
    this.pending.set(key,pending);return pending;
  }
}
export function expenseSnapshots(data,previous={},reference=null){
  const amount=Number(data.amount),currency=data.currency;
  if(!Number.isFinite(amount)||amount<0||!validCurrency(currency))throw Error('Importe o moneda inválidos.');
  const unchanged=previous.cost_status==='PAID'&&data.cost_status==='PAID'&&Number(previous.amount_original??previous.amount)===amount&&(previous.currency_original??previous.currency)===currency;
  const rate=currency==='USD'?1:reference?.rate??(data.exchange_rate?Number(data.exchange_rate):null);
  if(rate!==null&&(!Number.isFinite(rate)||rate<=0))throw Error('Tasa de cambio inválida.');
  const snapshot=unchanged?{fx_rate_to_base:previous.fx_rate_to_base??previous.exchange_rate??null,amount_base:previous.amount_base??previous.base_amount??null,rate_date:previous.rate_date??previous.rate_captured_at?.slice(0,10)??null,rate_source:previous.rate_source??null,rate_captured_at:previous.rate_captured_at??null}:{fx_rate_to_base:rate,amount_base:rate===null?null:amount*rate,rate_date:rate===null?null:reference?.rate_date??day(),rate_source:currency==='USD'?'identity':rate===null?null:reference?.source??'manual',rate_captured_at:rate===null?null:reference?.captured_at??new Date().toISOString()};
  const actual=Object.hasOwn(data,'actual_base_amount')?(data.actual_base_amount===''||data.actual_base_amount===null?null:Number(data.actual_base_amount)):previous.actual_base_amount??null;
  if(actual!==null&&(!Number.isFinite(actual)||actual<0))throw Error('Cargo real USD inválido.');
  return {...data,amount,amount_original:amount,currency_original:currency,...snapshot,exchange_rate:snapshot.fx_rate_to_base,base_amount:snapshot.amount_base,actual_base_amount:actual};
}
export async function calendarFxId(trip,event){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${trip}:calendar-fx:${event.id}:${event.cost}:${event.currency}`))).slice(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
