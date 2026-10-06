import {occursOn,categoryFor} from './domain.js';
export const chronological=(a,b)=>Date.parse(a.start)-Date.parse(b.start)||String(a.id).localeCompare(String(b.id));
export function isContext(event){
 const title=event.title||'',multiday=Date.parse(event.end)-Date.parse(event.start)>=86400000;
 const pass=/\b(?:pase|pass|abono)\b/i.test(title)&&categoryFor(event)==='Transportation';
 return !!event.allDay||/^\s*(?:ciudad|city|base)\s*:/i.test(title)||pass||multiday&&categoryFor(event)==='ABB';
}
export function effectiveEnd(event){
 const start=Date.parse(event.start),end=Date.parse(event.end),title=event.title||'';
 const marker=/salida|llegada|departure|arrival/i.test(title)&&/✈|vuelo|flight|united|\bUA\s*\d/i.test(title)&&end-start<=900000&&end>=start;
 return marker?start:end;
}
export function gapLabel(minutes){const hours=Math.floor(minutes/60),rest=minutes%60;return`${hours?hours+' h'+(rest?' ':''):''}${rest?rest+' min':''} ${minutes<30?'de margen':'disponibles'}`;}
export function agendaForDay(events,day){
 const list=events.filter(e=>occursOn(e,day)).sort(chronological),context=list.filter(isContext),agenda=list.filter(e=>!isContext(e)),gaps=new Map();let occupied=-Infinity;
 for(let i=0;i<agenda.length-1;i++){occupied=Math.max(occupied,effectiveEnd(agenda[i]));const minutes=Math.floor((Date.parse(agenda[i+1].start)-occupied)/60000);if(minutes>0)gaps.set(agenda[i].id,{minutes,label:gapLabel(minutes),tone:minutes<30?'short':minutes>90?'wide':'normal',next_id:agenda[i+1].id});}
 return{context,agenda,gaps};
}
export function wireDayCarousel(strip){
 if(!strip)return;
 strip.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});
 let drag=null,suppress=false;
 strip.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0)return;drag={id:event.pointerId,x:event.clientX,scroll:strip.scrollLeft,moved:false};});
 strip.addEventListener('pointermove',event=>{if(!drag)return;const delta=event.clientX-drag.x;if(Math.abs(delta)>5){drag.moved=true;strip.setPointerCapture(drag.id);strip.style.scrollSnapType='none';strip.scrollLeft=drag.scroll-delta;event.preventDefault();}});
 const end=()=>{if(!drag)return;suppress=drag.moved;drag=null;strip.style.scrollSnapType='';};strip.addEventListener('pointerup',end);strip.addEventListener('pointercancel',end);
 strip.addEventListener('click',event=>{if(suppress){event.preventDefault();event.stopPropagation();suppress=false;}},true);
 strip.addEventListener('wheel',event=>{if(strip.scrollWidth<=strip.clientWidth)return;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(delta){strip.scrollLeft+=delta;event.preventDefault();}},{passive:false});
}
