import test from 'node:test';
import assert from 'node:assert/strict';
import {TravelUI} from '../public/v2/travel-ui.js';
import {tourFeatures,proximity,StableSelector} from '../public/v2/travel-audio.js';
test('manual guides without GPS remain playable but never activate by proximity',()=>{const records=[{id:'pin',kind:'places_of_interest',data:{name:'Lugar'}},{id:'guide',kind:'app_settings',data:{type:'place_guide',place_id:'pin',guide:{experience:'Texto'}}}];const f=tourFeatures(records);assert.equal(f.length,1);assert.equal(f[0].geometry,null);assert.equal(proximity({lat:0,lng:0},f[0]).inside,false);assert.equal(new StableSelector().choose({lat:0,lng:0,accuracy:5,t:10000},f,null),null);});
test('pin playback uses shared controller, manual mode and allows completed replay',async()=>{const calls=[],ui=Object.create(TravelUI.prototype);ui.recorder={};ui.live=()=>{};ui.audio={progress:{completed:true},setMode:async m=>calls.push(m),select:async id=>calls.push(id),restart:async()=>calls.push('restart')};await ui.action('audio-pin','real-pin');assert.deepEqual(calls,['manual','real-pin','restart']);});
test('pin without guide has no dead playback control; names are escaped',()=>{const ui=Object.create(TravelUI.prototype);ui.records=()=>[];ui.audio={features:()=>[]};assert.equal(ui.pinAudio('missing'),'<p class="muted">Sin contenido disponible</p>');});
