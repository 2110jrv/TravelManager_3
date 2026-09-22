import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderAgenda} from '../public/src/app/render/renderAgenda.js';

const data={items:[{id:'a',date:'2026-10-20',startTime:'16:35',title:'Frecciarossa 9428',type:'RAIL',from:'Roma Termini',to:'Venezia',bookingReference:'A37WSN',passengers:[{name:'Jennifer',coach:'7',seat:'6A'}]},{id:'b',date:'2026-10-20',startTime:'20:34',title:'Venice lodging',type:'LODGING'}],ideas:[]};

test('agenda renders one expanded item with real detail fields',()=>{const html=renderAgenda(data,{expandedId:'a'});assert.equal((html.match(/agenda-card-expanded/g)||[]).length,1);assert.match(html,/aria-expanded="true"/);assert.match(html,/Frecciarossa 9428/);assert.match(html,/A37WSN/);assert.match(html,/Jennifer/);assert.match(html,/agenda-days/)});
test('agenda cards expose accessible toggle and edit actions',()=>{const html=renderAgenda(data,{expandedId:'a'});assert.match(html,/data-action="agenda-toggle"/);assert.match(html,/aria-expanded="false"/);assert.match(html,/data-action="edit"/);});
test('edit context contract captures day, anchor, scroll and expanded state',()=>{const source=fs.readFileSync(new URL('../public/src/app/main.js',import.meta.url),'utf8');for(const token of ['dayKey','dayIndex','scrollY','anchor','expandedId'])assert.match(source,new RegExp(token));assert.match(source,/requestAnimationFrame\(\(\)=>requestAnimationFrame/)});
test('same-day time changes remain chronologically ordered',()=>{const html=renderAgenda({items:[{id:'late',date:'2026-10-20',startTime:'18:10',title:'Late'},{id:'early',date:'2026-10-20',startTime:'08:10',title:'Early'}],ideas:[]},{ });assert.ok(html.indexOf('Early')<html.indexOf('Late'));assert.match(html,/data-day-key="2026-10-20"/)});
test('changed-day data moves into a new day group without navigation state',()=>{const html=renderAgenda({items:[{id:'moved',date:'2026-10-21',startTime:'08:10',title:'Moved'}],ideas:[]},{ });assert.match(html,/data-day-key="2026-10-21"/);assert.doesNotMatch(html,/data-view="2026-10-21"/)});
test('cancel and close use the same finally restoration path',()=>{const source=fs.readFileSync(new URL('../public/src/app/main.js',import.meta.url),'utf8');assert.match(source,/try\{return await agenda\.edit\(id\)\}finally\{restoreAgendaContext\(context\)\}/)});
test('expanded item state is retained through edit restoration',()=>{const source=fs.readFileSync(new URL('../public/src/app/main.js',import.meta.url),'utf8');assert.match(source,/expandedAgendaId=context\.expandedId/);assert.match(source,/expandedId:expandedAgendaId/)});
test('long press and right click still route to edit',()=>{const source=fs.readFileSync(new URL('../public/src/app/main.js',import.meta.url),'utf8');assert.match(source,/setTimeout\(\(\)=>router\.route\('edit'/);assert.match(source,/contextmenu/);assert.match(source,/router\.route\('edit',item\)/)});
