import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHome} from '../public/src/app/render/renderHome.js';

const trip={name:'Italia 2026',start_date:'2026-10-20',end_date:'2026-11-05',timezone:'Europe/Rome'};
const items=[
  {date:'2026-10-20',startTime:'08:00',endTime:'09:00',type:'FLIGHT',title:'Salida',from:'Puerto Rico',to:'Roma',payment:'CONFIRMED'},
  {date:'2026-10-21',startTime:'10:00',endTime:'12:00',type:'RAIL',title:'Frecciarossa',from:'Roma',to:'Venezia',payment:'CONFIRMED'},
  {date:'2026-11-05',type:'LODGING',title:'Última noche',place:'Roma',payment:'CONFIRMED'},
  {title:'Sin fecha válida',date:'not-a-date',type:'NOTE'}
];

test('home renders the complete trip range, empty days and corrections',()=>{
  const html=renderHome({trip,items,now:'2026-10-20T06:30:00.000Z'});
  assert.equal((html.match(/data-home-day=/g)||[]).length,17);
  assert.match(html,/Martes 20 de octubre/);
  assert.match(html,/Jueves 5 de noviembre/);
  assert.match(html,/Sin actividades registradas/);
  assert.match(html,/ITEMS POR CORREGIR/);
  assert.match(html,/Sin fecha válida/);
  assert.match(html,/outline-item confirmed current/);
});

test('home phase highlight uses the trip timezone rather than viewer timezone',()=>{
  const pre=renderHome({trip,items,now:'2026-10-20T05:00:00.000Z'});
  const post=renderHome({trip,items,now:'2026-11-05T23:00:00.000Z'});
  assert.match(pre,/trip-phase current[^>]*>PRE-VIAJE/);
  assert.match(post,/trip-phase current[^>]*>VIAJE FINALIZADO/);
  assert.match(pre,/data-trip-timezone="Europe\/Rome"/);
});
