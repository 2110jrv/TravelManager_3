// Calendar freshness is independent of the Supabase outbox timestamp.
export class CalendarRefresh {
 constructor({refresh,lastSync,available,visible=()=>document.visibilityState==='visible',now=()=>Date.now(),setTimer=(callback,delay)=>setInterval(callback,delay),clearTimer=id=>clearInterval(id)}){Object.assign(this,{refresh,lastSync,available,visible,now,setTimer,clearTimer});}
 request({force=false,maxAge=60000}={}){
  if(this.running)return this.running;
  this.running=(async()=>{if(!await this.available())return false;const last=Date.parse(await this.lastSync());if(!force&&Number.isFinite(last)&&this.now()-last<=maxAge)return false;await this.refresh();return true;})().finally(()=>{this.running=null;});return this.running;
 }
 start(windowTarget=window,documentTarget=document){
  const silent=options=>this.request(options).catch(()=>{});
  const arm=()=>{if(this.timer!=null){this.clearTimer(this.timer);this.timer=null;}if(this.visible())this.timer=this.setTimer(()=>{if(this.visible())silent({maxAge:300000});},300000);};
  const foreground=()=>{arm();if(this.visible())silent({maxAge:60000});};
  const reconnect=()=>silent({force:true});
  documentTarget.addEventListener('visibilitychange',foreground);windowTarget.addEventListener('pageshow',foreground);windowTarget.addEventListener('online',reconnect);arm();
  this.stop=()=>{if(this.timer!=null)this.clearTimer(this.timer);documentTarget.removeEventListener('visibilitychange',foreground);windowTarget.removeEventListener('pageshow',foreground);windowTarget.removeEventListener('online',reconnect);};
 }
}
