export class FrankfurterProvider {
  constructor(request=fetch){this.request=(...args)=>request(...args);}
  async get(currency,base='USD',date=null){
    const response=await this.request(`https://api.frankfurter.dev/v2/rate/${currency}/${base}${date?'?date='+encodeURIComponent(date):''}`,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error('FX_UNAVAILABLE');const row=await response.json();
    if(row.base!==currency||row.quote!==base||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(row.rate)||row.rate<=0)throw Error('FX_INVALID_RESPONSE');
    return{rate:row.rate,rate_date:row.date,source:'Frankfurter · fuentes oficiales',captured_at:new Date().toISOString()};
  }
}
