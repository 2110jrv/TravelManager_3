import test from 'node:test';
import assert from 'node:assert/strict';
import {qrSvg} from '../public/src/services/qrCapture.js';
import {qrPatch,normalizeQr} from '../public/src/models/ticketQr.js';
import {segmentTicketMapping,flightPassengerMapping,mapFlightPassengers} from '../public/src/services/segmentTicketMapping.js';
import {renderAgenda} from '../public/src/app/render/renderAgenda.js';
import {readFile} from 'node:fs/promises';

test('segment ticket mapping keeps ticket identity and changes seats per flight',()=>{
  assert.deepEqual(flightPassengerMapping('UA2024').jennifer,{passengerId:'jennifer',sourcePassengerId:'PAX_JENNIFER',ticketNumber:'0162368493945',ticket:'0162368493945',seat:'38E'});
  assert.equal(flightPassengerMapping('UA126').jennifer.seat,'50K');
  assert.equal(flightPassengerMapping('UA885').jonathan.seat,'49L');
  assert.equal(mapFlightPassengers('UA2025',[{passengerId:'PAX_JONATHAN'}])[0].seat,'38A');
  assert.equal(segmentTicketMapping.TICKETS.jennifer,'0162368493945');
});

test('synthetic QR encodes exact payload into offline SVG',()=>{
  const payload='TM3-SYNTHETIC-QR-EXACT-PAYLOAD-123';
  const svg=qrSvg(payload);
  assert.match(svg,/^<svg/);assert.match(svg,/<path/);assert.ok(svg.length>500);
  assert.deepEqual(qrPatch(payload,'CAMERA').qrPayload,payload);
  assert.equal(normalizeQr({qrIsDynamic:'DYNAMIC'}).qrIsDynamic,'DYNAMIC');
});

test('agenda exposes private QR controls without exposing payload',()=>{
  const html=renderAgenda({items:[{id:'flight',date:'2026-10-20',title:'UA2024',type:'FLIGHT',passengers:[{passengerId:'jennifer',ticketNumber:'0162368493945',seat:'38E',qrPayload:'PRIVATE'}]}],ideas:[]},{expandedId:'flight',canCreate:false,canEdit:true});
  assert.match(html,/Boleto \/ acceso/);assert.match(html,/Mostrar QR/);assert.doesNotMatch(html,/PRIVATE/);
});

test('QR camera has manual fallback and no payload logging',async()=>{
  const [source,main]=await Promise.all([readFile(new URL('../public/src/services/qrCapture.js',import.meta.url),'utf8'),readFile(new URL('../public/src/app/main.js',import.meta.url),'utf8')]);
  assert.match(source,/BarcodeDetector/);assert.match(source,/Pegar contenido QR/);assert.doesNotMatch(source,/console\.(log|info|debug)/);assert.match(main,/qrScan/);assert.match(main,/showQr/);
});
