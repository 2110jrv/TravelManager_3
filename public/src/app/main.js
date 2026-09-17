import {createLocalRepository} from '../db/localRepository.js';
import {createAccess} from '../auth/permissions.js';
import {audit} from '../services/audit.js';
import {appState,patchAppState,subscribeAppState} from './appState.js';
import {createAgendaController} from '../controllers/agendaController.js';
import {loadAdminDevices,handleAdminDeviceAction} from './adminDeviceController.js';
import {createActionRouter} from './actionRouter.js';
import {renderHome} from './render/renderHome.js';
import {renderAgenda} from './render/renderAgenda.js';
import {renderBudget} from './render/renderBudget.js';
import {renderDocuments} from './render/renderDocuments.js';
import {renderAdmin} from './render/renderAdmin.js';
import '../services/remoteRuntime.js';

const repo=createLocalRepository(),access=createAccess(),app=document.querySelector('#app');
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('PWA shell unavailable',error));
let view='home',menu=false,filter='',adminLoaded=false,previousState={...appState};
const label=k=>({home:'Inicio',agenda:'Agenda',map:'Mapa',photos:'Fotos',chat:'Chat',ideas:'Ideas / Tal vez',budget:'Presupuesto',documents:'Documentos',admin:'Administración',audit:'Auditoría'}[k]||k);
const nav=['home','agenda','map','photos','chat'];
function snapshot(){const d=repo.snapshot();return {...appState,...d,device:access.device,deviceState:access.deviceState};}
function render(){if(access.deviceState==='REVOKED'){app.innerHTML='<main class="revoked"><span class="brand">✦ Agenda Viajera</span><h1>Este dispositivo ya no está autorizado.</h1><p>Los datos privados fueron eliminados.</p><button class="primary" data-action="restore">Solicitar restauración</button><a href="https://loencontreenpr.com/profile/72283c1c-3d19-48e7-b49d-45df306cb8ce">Conocer al desarrollador</a></main>';return}const d=snapshot();let body=view==='home'?renderHome(d):view==='agenda'||view==='ideas'?renderAgenda(d,{ideas:view==='ideas',filter,canCreate:access.permissions.create}):view==='budget'?renderBudget(d,access.permissions.budget):view==='documents'?renderDocuments(access.permissions.docs):view==='admin'?renderAdmin(d,access):view==='audit'?`<section class="section-head"><h2>Auditoría</h2></section>${audit({items:d.items,documents:[],travelers:[]}).map(x=>`<article class="card audit"><strong>${x.rule}</strong></article>`).join('')}`:`<section class="empty"><h2>${label(view)}</h2><p>Próximamente</p></section>`;const links=`${access.permissions.budget?'<button data-view="budget">◈ Presupuesto</button>':''}${access.permissions.docs?'<button data-view="documents">▤ Documentos</button>':''}<button data-view="admin">⚙ Administración</button>`;app.innerHTML=`<header class="topbar"><div><span class="brand">✦ Agenda Viajera</span><h1>${label(view)}</h1></div><button class="avatar" data-action="menu">J</button></header><main>${body}</main><nav class="bottom-nav">${nav.map(k=>`<button class="${view===k?'active':''}" data-view="${k}"><span>${({home:'⌂',agenda:'☷',map:'⌖',photos:'▧',chat:'◌'})[k]}</span>${label(k)}</button>`).join('')}</nav>${menu?`<div class="overlay"><aside class="menu">${links}</aside></div>`:''}`;if(view==='admin'&&!adminLoaded){adminLoaded=true;loadAdminDevices().catch(()=>{})}}
function renderChangedState(next,prev){if(next.pendingOperations!==prev.pendingOperations)document.querySelectorAll('[data-pending-count]').forEach(x=>x.textContent=String(next.pendingOperations||0));render();}
const navigation={navigate(next){view=next;menu=false;if(next==='admin')adminLoaded=false;render()},toggleMenu(){menu=!menu;render()}};
const agenda=createAgendaController({repository:repo,access,onChanged:()=>render()});
const router=createActionRouter({agenda,navigation,access,render,admin:handleAdminDeviceAction,restore:async()=>{const reason=prompt('Nota explicativa obligatoria');if(reason){access.restore(reason);render()}}});
document.addEventListener('click',async event=>{const target=event.target.closest('[data-action]');if(!target)return;try{await router.route(target.dataset.action,target)}catch(error){console.error('[TM3 action]',error);alert('No se pudo completar la acción')}});
document.addEventListener('click',event=>{const target=event.target.closest('[data-view]');if(target)navigation.navigate(target.dataset.view)});
document.addEventListener('input',event=>{if(event.target.classList.contains('search')){filter=event.target.value;render()}});
let press;document.addEventListener('pointerdown',event=>{const item=event.target.closest('.item');if(item)press=setTimeout(()=>agenda.edit(item.dataset.entryId),550)});document.addEventListener('pointerup',()=>clearTimeout(press));document.addEventListener('contextmenu',event=>{const item=event.target.closest('.item');if(item){event.preventDefault();agenda.edit(item.dataset.entryId)}});
subscribeAppState(next=>{const prev=previousState;previousState={...next};renderChangedState(next,prev)});
await repo.ready;patchAppState({agenda:repo.snapshot().items,ideas:repo.snapshot().ideas});render();
