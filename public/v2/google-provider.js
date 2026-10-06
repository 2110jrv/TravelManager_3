// Supabase must never persist Google's refresh credential in browser storage.
export function googleSafeStorage(storage){
 const clean=value=>{if(!value)return value;try{const session=JSON.parse(value);delete session.provider_refresh_token;return JSON.stringify(session);}catch{return value;}};
 return{getItem(key){const value=storage.getItem(key),safe=clean(value);if(safe!==value)storage.setItem(key,safe);return safe;},setItem(key,value){storage.setItem(key,clean(value));},removeItem(key){storage.removeItem(key);}};
}
export class GoogleProviderBackend {
 constructor(client,credentials){this.client=client;this.credentials=credentials;}
 async call(action,extra={}){
  for(let attempt=0;attempt<5;attempt++){
   const{data,error}=await this.client.functions.invoke('av2-google-token',{body:{action,...this.credentials(),...extra}});
   if(!error)return data;
   let code;try{code=(await error.context.json()).error;}catch{/* Network errors never imply revoked consent. */}
   if(code==='GOOGLE_REFRESH_BUSY'&&attempt<4){await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));continue;}
   const failure=Error(code||'GOOGLE_BACKEND_UNAVAILABLE');failure.code=code;throw failure;
  }
 }
}
