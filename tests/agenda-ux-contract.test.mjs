import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAgenda} from '../public/src/app/render/renderAgenda.js';

const data={items:[{id:'a',date:'2026-10-20',startTime:'16:35',title:'Frecciarossa 9428',type:'RAIL',from:'Roma Termini',to:'Venezia',bookingReference:'A37WSN',passengers:[{name:'Jennifer',coach:'7',seat:'6A'}]},{id:'b',date:'2026-10-20',startTime:'20:34',title:'Venice lodging',type:'LODGING'}],ideas:[]};

test('agenda renders one expanded item with real detail fields',()=>{const html=renderAgenda(data,{expandedId:'a'});assert.equal((html.match(/agenda-card-expanded/g)||[]).length,1);assert.match(html,/aria-expanded="true"/);assert.match(html,/Frecciarossa 9428/);assert.match(html,/A37WSN/);assert.match(html,/Jennifer/);assert.match(html,/agenda-days/)});
test('agenda cards expose accessible toggle and edit actions',()=>{const html=renderAgenda(data,{expandedId:'a'});assert.match(html,/data-action="agenda-toggle"/);assert.match(html,/aria-expanded="false"/);assert.match(html,/data-action="edit"/);});
