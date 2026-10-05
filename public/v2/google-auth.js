// Supabase renews its own session, not Google's access token. Re-auth uses
// existing consent; failed Google credentials never discard offline work.
export class GoogleAuthorization {
  constructor(store){this.store=store;}
  async fingerprint(token){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
  async capture(event,session){
    if(event==='SIGNED_OUT'){await this.invalidate();return;}
    if(!session?.provider_token)return;
    const invalid=await this.store.get('meta','google-reauth');
    if(event!=='SIGNED_IN'&&invalid?.value)return;
    if(invalid?.rejected_hash&&await this.fingerprint(session.provider_token)===invalid.rejected_hash)return;
    await this.store.transaction(['meta'],tx=>{
      tx.objectStore('meta').put({id:'google-access',value:session.provider_token});
      tx.objectStore('meta').put({id:'google-reauth',value:false});
    });
  }
  async token(){
    if((await this.store.get('meta','google-reauth'))?.value)throw Error('La autorización Google expiró. Conecta nuevamente para continuar; tus datos offline están conservados.');
    return (await this.store.get('meta','google-access'))?.value;
  }
  async invalidate(){const token=(await this.store.get('meta','google-access'))?.value;const rejected_hash=token?await this.fingerprint(token):(await this.store.get('meta','google-reauth'))?.rejected_hash;await this.store.transaction(['meta'],tx=>{
    tx.objectStore('meta').delete('google-access');
    tx.objectStore('meta').put({id:'google-reauth',value:true,rejected_hash});
  });}
}
