import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHome} from '../public/src/app/render/renderHome.js';

const base={trip:{name:'Italia 2026',nights:'16/16 noches cubiertas'},syncStatus:'SYNCED',items:[
  {id:'flight',date:'2026-10-21',startTime:'13:15',type:'FLIGHT',title:'Llegada FCO',place:'Roma · Fiumicino',from:'SJU',to:'Roma'},
  {id:'train',date:'2026-10-21',startTime:'15:38',endTime:'16:10',type:'TRANSPORT',title:'Leonardo Express',place:'FCO → Roma Termini'},
  {id:'rail',date:'2026-10-21',startTime:'16:35',endTime:'20:34',type:'RAIL',title:'Frecciarossa',trainNumber:'9428',from:'Roma Termini',to:'Venezia'},
  {id:'hotel',date:'2026-10-21',type:'LODGING',title:'Residenza Ca’ Matta Venezia',place:'Venezia'}]};

test('home creates a chronological textual summary from the selected day',()=>{
  const html=renderHome({...base,selectedDate:'2026-10-21'});
  assert.match(html,/Miércoles 21 de octubre/);
  assert.match(html,/Roma → Venezia/);
  assert.match(html,/Llegada FCO/);
  assert.match(html,/Frecciarossa 9428/);
  assert.match(html,/Conexión de solo 25 min/);
  assert.match(html,/Residenza Ca’ Matta Venezia/);
  assert.doesNotMatch(html,/bookingReference|ticketNumber|seat/);
  assert.ok(html.indexOf('Llegada FCO')<html.indexOf('Frecciarossa 9428'));
});

test('home marks a logical gap as pending without inventing a booking',()=>{
  const html=renderHome({trip:{name:'Italia 2026'},items:[{date:'2026-10-21',startTime:'09:00',endTime:'10:00',type:'TRANSPORT',title:'Llegada a Pisa',place:'Pisa'},{date:'2026-10-21',startTime:'12:00',type:'TRANSPORT',title:'Traslado a Lucca',place:'Pisa → Lucca'}]});
  assert.match(html,/Falta definir el alojamiento o transporte de llegada/);
  assert.match(html,/data-home-daily-summary/);
});
