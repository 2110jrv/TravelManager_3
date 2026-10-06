// Supabase renews its own session, not Google's access token. Re-auth uses
// existing consent; failed Google credentials never discard offline work.
export class GoogleAuthorization {
  constructor(store,backend=null,state=()=>{}){this.store=store;this.backend=backend;this.state=state;}
  async fingerprint(token){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
  async capture(event,session){
    const refresh=session?.provider_refresh_token;if(session)delete session.provider_refresh_token;
    if(event==='SIGNED_OUT'){this.pendingRefresh=null;await this.invalidate();return;}
    if(refresh&&this.backend){this.pendingRefresh=refresh;try{await this.renew({action:'import',refresh_token:refresh});return;}catch{/* Keep only in memory until enrollment/network permits transfer. */}}
    if(!session?.provider_token)return;
    const hash=await this.fingerprint(session.provider_token),seen=await this.store.get('meta','google-session-provider');
    await this.store.transaction(['meta'],tx=>tx.objectStore('meta').put({id:'google-session-provider',value:hash}));
    // Supabase emits SIGNED_IN on visibility/session recovery too. Its original
    // provider token must not overwrite the access token renewed by our backend.
    if((await this.store.get('meta','google-access'))?.value&&(event!=='SIGNED_IN'||seen?.value===hash))return;
    const invalid=await this.store.get('meta','google-reauth');
    if(event!=='SIGNED_IN'&&invalid?.value)return;
    if(invalid?.rejected_hash&&await this.fingerprint(session.provider_token)===invalid.rejected_hash)return;
    await this.store.transaction(['meta'],tx=>{
      tx.objectStore('meta').put({id:'google-access',value:session.provider_token});
      tx.objectStore('meta').put({id:'google-reauth',value:false});
    });
  }
  async token(){
    if(this.pendingRefresh)return this.renew({action:'import',refresh_token:this.pendingRefresh});
    const access=await this.store.get('meta','google-access');
    if(this.backend&&!access?.value)return this.renew();
    if(this.backend&&Number.isFinite(access.expires_at)&&access.expires_at<=Date.now()+90000)return this.renew({force:true,rejected_token:access.value});
    if((await this.store.get('meta','google-reauth'))?.value)throw Error('La autorización Google expiró. Conecta nuevamente para continuar; tus datos offline están conservados.');
    return access?.value;
  }
  async renew(options={}){
    if(this.renewing)return this.renewing;
    this.renewing=(async()=>{
      this.state('refreshing');
      try{const data=await this.backend.call(options.action||'access',options);if(!data?.access_token||!Number.isFinite(data.expires_at))throw Error('GOOGLE_BACKEND_UNAVAILABLE');
        await this.store.transaction(['meta'],tx=>{const meta=tx.objectStore('meta');meta.put({id:'google-access',value:data.access_token,expires_at:data.expires_at});meta.put({id:'google-backend',value:true});meta.put({id:'google-reauth',value:false});});if(options.action==='import')this.pendingRefresh=null;this.state('connected');return data.access_token;
      }catch(error){if(error.code==='GOOGLE_REAUTH_REQUIRED'||error.message==='GOOGLE_REAUTH_REQUIRED'){this.pendingRefresh=null;await this.invalidate();this.state('reauth');throw Error('La autorización Google expiró. Conecta nuevamente para continuar; tus datos offline están conservados.');}this.state('unavailable');throw Error('No se pudo renovar la conexión Google. Tus datos guardados están conservados; vuelve a intentar al recuperar conexión.');}
    })().finally(()=>{this.renewing=null;});return this.renewing;
  }
  async recover(token){if(!this.backend){await this.invalidate();return false;}await this.renew({force:true,rejected_token:token});return true;}
  async oauthQuery(){
    let configured=false;
    if(this.backend){try{configured=(await this.backend.call('status')).configured;}catch(error){if(error.code!=='SESSION_REQUIRED'&&error.code!=='AV2_DEVICE_NOT_AUTHORIZED')return{access_type:'offline'};}}
    return{access_type:'offline',...(configured?{}:{prompt:'consent'})};
  }
  async invalidate(){const token=(await this.store.get('meta','google-access'))?.value;const rejected_hash=token?await this.fingerprint(token):(await this.store.get('meta','google-reauth'))?.rejected_hash;await this.store.transaction(['meta'],tx=>{
    tx.objectStore('meta').delete('google-access');
    tx.objectStore('meta').put({id:'google-reauth',value:true,rejected_hash});
  });}
}
