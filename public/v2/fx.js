import {validCurrency} from './domain.js';
export class ReferenceRates {
  constructor(provider=null){this.provider=provider;}
  async get(currency,base='USD'){
    if(!validCurrency(currency)||!validCurrency(base))throw Error('Moneda ISO inválida');
    if(currency===base)return{rate:1,source:'identity',captured_at:new Date().toISOString()};
    return this.provider?this.provider.get(currency,base):null;
  }
}
export function expenseSnapshots(data,previous={}){
  const amount=Number(data.amount),currency=data.currency;
  if(!Number.isFinite(amount)||amount<0||!validCurrency(currency))throw Error('Importe o moneda inválidos.');
  const unchanged=previous.cost_status==='PAID'&&data.cost_status==='PAID'&&Number(previous.amount_original??previous.amount)===amount&&(previous.currency_original??previous.currency)===currency;
  const rate=currency==='USD'?1:data.exchange_rate?Number(data.exchange_rate):null;
  if(rate!==null&&(!Number.isFinite(rate)||rate<=0))throw Error('Tasa de cambio inválida.');
  const snapshot=unchanged?{fx_rate_to_base:previous.fx_rate_to_base??previous.exchange_rate??null,amount_base:previous.amount_base??previous.base_amount??null,rate_source:previous.rate_source??null,rate_captured_at:previous.rate_captured_at??null}:{fx_rate_to_base:rate,amount_base:rate===null?null:amount*rate,rate_source:currency==='USD'?'identity':rate===null?null:'manual',rate_captured_at:rate===null?null:new Date().toISOString()};
  return {...data,amount,amount_original:amount,currency_original:currency,...snapshot,exchange_rate:snapshot.fx_rate_to_base,base_amount:snapshot.amount_base,actual_base_amount:previous.actual_base_amount??null};
}
