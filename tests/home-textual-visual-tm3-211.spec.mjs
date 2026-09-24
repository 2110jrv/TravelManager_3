import {test,expect} from '@playwright/test';

const sizes=[['390',390,844],['412',412,915],['desktop',1440,900]];
const base={trip:{name:'Italia 2026',nights:'16/16 noches cubiertas'},syncStatus:'SYNCED',selectedDate:'2026-10-21',items:[
  {date:'2026-10-21',startTime:'13:15',type:'FLIGHT',title:'Llegada FCO',place:'Roma · Fiumicino',from:'SJU',to:'Roma',payment:'PAID'},
  {date:'2026-10-21',startTime:'15:38',endTime:'16:10',type:'TRANSPORT',title:'Leonardo Express',place:'FCO → Roma Termini',payment:'PAID'},
  {date:'2026-10-21',startTime:'16:35',endTime:'20:34',type:'RAIL',title:'Frecciarossa',trainNumber:'9428',from:'Roma Termini',to:'Venezia',payment:'CONFIRMED'},
  {date:'2026-10-21',type:'LODGING',title:'Residenza Ca’ Matta Venezia',place:'Venezia',payment:'PAID'}]};
const scenarios={flights:base,trains:{...base,items:base.items.slice(1)},city:{...base,items:[{date:'2026-10-21',startTime:'09:00',type:'ACTIVITY',title:'Paseo por Venecia',place:'Venecia',payment:'CONFIRMED'}]},lodging:{...base,items:[base.items[3]]},pending:{...base,items:base.items.slice(0,3)}};

test('home textual summary stays readable across representative days and viewports',async({browser})=>{
  for(const [name,width,height] of sizes){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');for(const [scenario,fixture] of Object.entries(scenarios)){await page.evaluate(async({fixture})=>{const {renderHome}=await import('/src/app/render/renderHome.js');document.querySelector('#app').innerHTML=renderHome(fixture)}, {fixture});await expect(page.locator('[data-home-daily-summary]')).toBeVisible();await page.screenshot({path:`tmp/visual-home-tm3-211/${name}-${scenario}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();}expect(errors).toEqual([]);await context.close();}
});
