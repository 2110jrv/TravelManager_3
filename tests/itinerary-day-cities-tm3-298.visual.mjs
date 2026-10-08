import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve('public','.'+(path.endsWith('/')?path+'index.html':path));if(!file.startsWith(resolve('public')))throw Error('path');const body=await readFile(file);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const realFixture=process.env.TM3_REAL_FIXTURE?JSON.parse(await readFile(process.env.TM3_REAL_FIXTURE,'utf8')):null;
const browser=await chromium.launch({headless:true});
await mkdir('tmp/tm3-298',{recursive:true});
try {
 for(const width of [390,412,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto(base+'/v2/');
  await page.evaluate(async(realFixture)=>{
   const {dayCityCards}=await import('./day-cities.js');
   const dates=['2026-10-22','2026-10-23','2026-10-24'];
   const items=Array.from({length:12},(_,i)=>({id:String(i),title:'Visit',start:`2026-10-22T${String(i+8).padStart(2,'0')}:00:00+02:00`,end:`2026-10-22T${String(i+8).padStart(2,'0')}:30:00+02:00`,city:`Ciudad ${i+1} con nombre extenso`,gps:{lat:45,lng:12,city:`Ciudad ${i+1} con nombre extenso`}}));
   items.push({id:'single',title:'Visit',start:'2026-10-23T09:00:00+02:00',end:'2026-10-23T10:00:00+02:00',city:'Florencia',gps:{lat:43,lng:11,city:'Florencia'}});
   if(realFixture){const{days,TRIP}=await import('./config.js').then(async c=>({...c,days:(await import('./domain.js')).days}));document.querySelector('main').innerHTML='<h1>Itinerario</h1><div class=\"day-strip\">'+dayCityCards(realFixture.events,realFixture.records,days(),'2026-10-24',realFixture.locations)+'</div>';return;}
   document.querySelector('main').innerHTML=`<h1>Itinerario</h1><div class="day-strip">${dayCityCards(items,[],dates,dates[0])}</div>`;
  },realFixture);
  const metrics=await page.locator('.day-strip button').evaluateAll(buttons=>buttons.map(button=>({width:button.clientWidth,scrollWidth:button.scrollWidth,height:button.clientHeight,scrollHeight:button.scrollHeight,lines:button.querySelectorAll('.day-cities span').length,rect:button.getBoundingClientRect().toJSON()})));
  if(realFixture){assert.equal(metrics.length,17);assert.equal(metrics[4].lines,2);}else{assert.equal(metrics[0].lines,12);assert.equal(metrics[1].lines,1);assert.equal(metrics[2].lines,0);}
  for(const m of metrics){assert.ok(m.scrollHeight<=m.height);assert.ok(m.scrollWidth<=m.width);}
  assert.ok(metrics[0].rect.right<=metrics[1].rect.left);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`tmp/tm3-298/${realFixture?'real-':'cards-'}${width}.png`,fullPage:true});
  console.log(`viewport ${width}: PASS; ${realFixture?'17 real day cards':'12-city stress test'}, no clipping or overlap`);
  await page.close();
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
