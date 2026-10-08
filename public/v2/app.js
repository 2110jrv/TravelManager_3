import{renderBudgetChart,budgetSliceDetail,budgetSlices}from'./budget-chart.js';
import{MapUX,iconButton}from'./map-ux.js';
import{OfflineDocuments}from'./offline-documents.js';
import { createClient } from '../vendor/supabase-client.mjs';
import { TRIP } from './config.js';
import { dateKey, occursOn, days, finance, normalizeEvent, financialAudit, validCurrency,categoryFor } from './domain.js';
import { LocalStore } from './store.js';
import {CalendarRefresh} from './calendar-refresh.js';
import { GoogleSource } from './google.js';
import { GoogleAuthorization } from './google-auth.js';
import {googleSafeStorage,GoogleProviderBackend} from './google-provider.js';
import { SupabaseRemote, SyncEngine } from './sync.js';
import {PinAccess} from './pin-auth.js';
import {Devices,randomToken} from './devices.js';
import {expenseSnapshots,ReferenceRates,FrankfurterProvider,calendarFxId} from './fx.js';
import qrcode from '../vendor/qrcode-generator.mjs';
import {formatMoney,formatEventTime,formatTime,formatDateTime,currencyPrefix} from './format.js';
import {icon,eventVisual,destination,destinations,multidayStage} from './visual.js';
import {agendaForDay,chronological,wireDayCarousel} from './itinerary.js';
import {mapPlaces,mapsPinUrl} from './places.js';
import {mountTripMap,closeTripMap,focusTripPin} from './map.js';
import {locationLabel} from './location.js';
import {LocationCache} from './location-cache.js';
import {dayCityCards,itemCities} from './day-cities.js';
import {renderEventDetail} from './event-detail.js';

document.querySelectorAll('nav [data-icon]').forEach(link=>link.insertAdjacentHTML('afterbegin',icon(link.dataset.icon)));
let calendarRefresh=null;let googleAuthorization=null;let googleState='saved';const pendingGoogleAuth=[];
let client,remote,devices,google,sync,remoteStartup,authSession=null,pinAccess;
const PIN_MODE=!(location.hostname==='127.0.0.1'&&document.documentElement.dataset.av2TestLegacyAuth==='true');
let refreshingTransfers=false,transferRefreshAt=0,deviceVerification="pending",verifyingDevice=false;
const store = await new LocalStore().open();store.pinMode=PIN_MODE;
if(document.documentElement.dataset.av2Staging==='true'){const config=(await store.get('meta','trip-config'))?.value;if(config&&!Object.isFrozen(TRIP))Object.assign(TRIP,config);}
const rateService=new ReferenceRates(new FrankfurterProvider(),store);
let referenceRates=(await store.get('meta','fx-view'))?.value||{},financeView=(await store.get('meta','finance-view'))?.value||'USD',financialRemoteReady=false;
const inviteMatch=/^#invite\/([0-9a-f]{64})$/.exec(location.hash);
if(inviteMatch){await store.put('meta',{id:'pending-invite',value:inviteMatch[1]});history.replaceState(null,'',`${location.pathname}#devices`);}
// Snapshot loading requires both an explicit fixture URL and a test-only server flag.
if (['127.0.0.1','localhost'].includes(location.hostname) && new URL(location.href).searchParams.get('fixture')==='1' && navigator.onLine) {
  try {
    const response = await fetch('./local-calendar', { cache: 'no-store' });
    if (response.ok) {
      const snapshot = await response.json(), saved = await store.get('meta','connector-snapshot');
      if (snapshot.calendar_id === TRIP.calendarId && saved?.value !== snapshot.captured_at && !(await store.get('meta','calendar-sync'))?.value) {
        const labels = Object.fromEntries(snapshot.labels.map(label => [label.id, label]));
        await store.transaction(['events','meta'], tx => {
          for (const event of snapshot.events) tx.objectStore('events').put(normalizeEvent(event, {}, labels));
          tx.objectStore('meta').put({ id:'connector-snapshot',value:snapshot.captured_at });
          tx.objectStore('meta').put({ id:'calendar-labels',value:labels });
          tx.objectStore('meta').put({ id:'calendar-sync',value:null,synced_at:snapshot.captured_at,source:'connected-google-calendar' });
        });
      }
    }
  } catch { /* Existing Calendar cache remains usable offline. */ }
}
const app = document.querySelector('#app');
let rootClaim=null;

let selectedDay = days().includes(dateKey()) ? dateKey() : TRIP.start;
let documents = (await store.get('meta', 'drive-files'))?.value || [];
let events = [], records = [], pending = [], conflicts = [], mapLocations = {}, now = new Date();
let installPrompt,fxDetailsOpen=false;
let mapFilter='trip',selectedPin=null;let offlineDocuments,docsProgress=null;const mapUx=new MapUX(store,()=>events,()=>records,()=>selectedDay,notice);
let calendarStatus='saved',calendarUpdatedAt=(await store.get('meta','calendar-sync'))?.synced_at,calendarFailure='';
function updateConnection(){const node=document.querySelector('#connection');node.textContent=googleState==='refreshing'?'Renovando conexión…':googleState==='reauth'?(PIN_MODE?'Conexión pendiente':'Conectar Google'):calendarStatus==='updating'?'Actualizando…':!navigator.onLine||calendarStatus==='error'?'Sin conexión · mostrando datos guardados':calendarUpdatedAt?`Actualizado hace ${Math.max(0,Math.floor((Date.now()-Date.parse(calendarUpdatedAt))/60000))} min`:'Datos guardados';node.title=calendarFailure;}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = formatMoney;
const tripDates=()=>new Intl.DateTimeFormat('es',{dateStyle:'medium',timeZone:'UTC'}).formatRange(new Date(TRIP.start+'T12:00:00Z'),new Date(TRIP.end+'T12:00:00Z'));
const localDate=(value=new Date())=>dateKey(value,Intl.DateTimeFormat().resolvedOptions().timeZone);
const formatDay = day => new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const active = kind => records.filter(x => x.kind === kind && !x.deleted_at);
const eventTime = formatEventTime;
const button = (action,text,id='',style='secondary') => {const type=({'switch-user':'user','sync':'sync','download-document':'download','load-documents':'sync','delete-expense':'delete','remove-receipt':'delete','save':'save','trash-document':'delete','unlink':'delete','update':'sync'})[action];return '<button class="'+style+(type?' mobile-icon':'')+'" data-action="'+action+'" data-id="'+escape(id)+'" aria-label="'+escape(text)+'" title="'+escape(text)+'">'+(type?icon(type):'')+'<span>'+escape(text)+'</span></button>';};
function notice(message) { if(PIN_MODE&&['PIN_CHANGED','DEVICE_REVOKED','USER_INACTIVE','AV2_DEVICE_ENROLLMENT_REQUIRED','AV2_DEVICE_REVOKED'].some(code=>message.includes(code))){pinScreen.reverify=true;message='Necesitamos verificar tu acceso.';}if(PIN_MODE&&/Conect[ae].*Google|Autoriza Google|Conecta nuevamente/.test(message))message='La conexión del viaje necesita atención. Tus datos guardados están conservados.';const friendly={AV2_POI_CHANGED:'Este lugar cambió en otro dispositivo. Sincroniza antes de editarlo nuevamente.',AV2_DEVICE_ENROLLMENT_REQUIRED:'Esta instalación requiere una invitación o activar PC Casa.',AV2_DEVICE_REVOKED:'Este dispositivo fue revocado. Se invalidaron los datos locales.',AV2_ADMIN_PROOF_INVALID:'La clave administrativa no es válida.',AV2_INVITE_ALREADY_USED:'La invitación ya fue utilizada.',AV2_INVITE_INVALID_OR_EXPIRED:'La invitación venció o no es válida.',AV2_ADMIN_KEY_NOT_CONFIGURED:'Configura la clave administrativa desde PC Casa.',AV2_ADMIN_RATE_LIMIT:'Demasiados intentos. Espera diez minutos antes de intentar otra vez.'};const node = document.querySelector('#notice'); node.textContent = Object.entries(friendly).find(([code])=>String(message).includes(code))?.[1]||message; node.hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => { node.hidden = true; }, 6500); }
let budgetPhase=null,expenseDrilldown=null;
function summary(phase=null) {const snapshots=active('app_settings').filter(r=>r.data.type==='calendar_fx');return finance(events.filter(x=>days().some(day=>occursOn(x,day))).map(e=>{const snapshot=snapshots.find(r=>r.data.event_id===e.id&&r.data.snapshot?.amount_original===e.cost&&r.data.snapshot?.currency_original===e.currency)?.data.snapshot;return snapshot&&e.cost_status==='PAID'?{...e,...snapshot}:e;}),active('expenses'),active('budgets')[0]?.data.amount??null,referenceRates,phase);}
const currencyMoney=formatMoney;
function financialWarning(f=summary()) {return f.financial_issues.length?`<aside class="integrity-warning"><span class="warning-icon">!</span><div><strong>Presupuesto incompleto</strong><p>Hay ${f.missing_costs.length} eventos pagados/pendientes sin costo registrado.${f.financial_issues.length>f.missing_costs.length?' También hay datos financieros por revisar.':''}</p><a href="#financial-review">Revisar ${icon('arrow')}</a></div></aside>`:'';}
function currencyTable(f=summary()){return `<div class="currency-table"><table><thead><tr><th>Moneda</th><th>Pagado conocido</th><th>Estimado conocido</th><th>Proyectado conocido</th></tr></thead><tbody>${[...new Set(['USD','EUR','CHF',...Object.keys(f.by_currency)])].map(currency=>{const t=f.by_currency[currency]||{paid:0,estimated:0,projected:0};return`<tr><th>${currency}</th><td>${currencyMoney(t.paid,currency)}</td><td>${currencyMoney(t.estimated,currency)}</td><td>${currencyMoney(t.projected,currency)}</td></tr>`;}).join('')}</tbody></table></div>`;}
function stats(view='USD',f=summary()) {return (view==='original'?currencyTable(f):`<div class="grid finance-grid"><div class="card stat paid-stat"><span>Pagado conocido</span><strong>${money(f.paid)}</strong><small>Pagos registrados</small></div><div class="card stat estimated-stat"><span>Estimado conocido</span><strong>${money(f.estimated)}</strong><small>Pendiente de pagar</small></div><div class="card stat highlight"><span>Total proyectado conocido</span><strong>${money(f.projected)}</strong><small>${f.partial?'Total parcial':'Costos registrados'}</small></div></div>`)+(f.missing.length?`<p class="warning">${f.missing.length} importe(s) sin equivalente USD. La proyección es parcial; se conservan las monedas originales.</p>`:'');}
function spendBar(f=summary()){return `<div class="spend-bar" aria-label="Composición del total conocido"><span style="width:${f.projected?100*f.paid/f.projected:0}%"></span></div><div class="bar-legend"><span><i class="dot mint"></i> Pagado conocido</span><span><i class="dot peach"></i> Estimado conocido</span></div>`;}
function eventCard(event,showCities=false) {
 const cities=showCities?itemCities(event,records,selectedDay,mapLocations):[];
 const visual=eventVisual(event),stage=multidayStage(event,selectedDay),past=event.end&&new Date(event.allDay?`${event.end}T00:00:00`:event.end)<now;
 const status=event.cost_status=== 'PAID'?'Pagado':event.cost_status==='ESTIMATED'?'Estimado':event.purchase_status==='PAID'?'Pagado · costo pendiente':event.purchase_status==='PENDING'?'Estimado por registrar':null;
 return `<a class="event ${past?'past':''}" href="#event/${encodeURIComponent(event.id)}"><div class="event-rail"><span class="event-time">${escape(eventTime(event))}</span><span class="event-icon ${visual.tone}">${icon(visual.icon)}</span>${cities.length?`<span class="item-cities">${escape(cities.join(" → "))}</span>`:""}</div><div class="event-body"><h3>${escape(event.title.replace(/^\s*[✅☐]\s*/,''))}</h3><p>${icon('pin')}${escape(locationLabel(event))}</p><div class="event-chips">${event.label?`<span class="badge ${visual.tone}" style="--label-color:${/^#[0-9a-f]{6}$/i.test(event.label.color||'')?event.label.color:'#9caecc'}">${escape(categoryFor(event))}</span>`:''}${status?`<span class="badge ${event.purchase_status==='PAID'||event.cost_status==='PAID'?'paid':'pending'}">${status}${event.cost_status?' · '+escape(currencyMoney(event.cost,event.currency)):''}</span>`:''}${stage?`<span class="badge">${escape(stage)}</span>`:''}${event.purchase_id?'<span class="badge">Compra conjunta</span>':''}</div></div><span class="event-chevron">›</span></a>`;
}
function eventList(list,gaps=new Map(),showCities=false) {return list.length?`<div class="events timeline">${[...list].sort(chronological).map(event=>eventCard(event,showCities)+(gaps.has(event.id)?`<div class="event-gap ${gaps.get(event.id).tone}" role="note">${escape(gaps.get(event.id).label)}</div>`:'')).join('')}</div>`:'<div class="empty">Todavía no hay eventos de Calendar para este día. Conecta Google para traer tu itinerario real.</div>';}
function home(){
 const greeting=PIN_MODE&&store.activeUser?'<p class="eyebrow">Hola, '+escape(store.activeUser.name)+'</p>':'';
 const today=localDate(now),before=today<TRIP.start,after=today>TRIP.end,f=summary(),countdown=Math.max(0,Math.ceil((Date.parse(TRIP.start)-Date.parse(today))/86400000)),day=before?TRIP.start:today,dayEvents=events.filter(e=>occursOn(e,day)),dest=destination(dayEvents);
 return greeting+`<section class="hero travel-hero"><img src="./assets/italia.jpg" alt="Costa italiana de Cinque Terre" fetchpriority="high"><div class="hero-content"><span class="eyebrow">${escape(TRIP.travelers.join(' + '))} · Un viaje para recordar</span><h1>${escape(TRIP.name)} <span aria-hidden="true" class="italy-flag"></span></h1><p>${tripDates()}</p><span class="hero-chip">${before?'PRE-VIAJE':after?'Viaje completado':'En viaje'}</span></div></section><div class="departure-card">${icon('flight')}<div><strong>${before?`Faltan ${countdown} días para tu viaje`:after?'Cada recuerdo, contigo':'Tu aventura ya comenzó'}</strong><span>${before?'La aventura todavía no comienza. Prepara lo esencial.':'Italia, un día a la vez.'}</span></div></div>
 <div class="home-columns"><section class="section balance-section"><div class="row"><div><span class="eyebrow">Tu viaje, en equilibrio</span><h2>Presupuesto actual</h2></div><a class="text-link" href="#budget">Ver detalle ${icon('arrow')}</a></div>${financialWarning(f)}${stats()}${spendBar(f)}<div class="missing-count">Costos faltantes <strong>${f.missing_costs.length}</strong></div>${after?`<p>Costo final conocido: ${money(f.paid)}${f.partial?' · incompleto':''}</p>`:''}</section>
 <section class="section next-day"><div class="row"><h2>${before?'Primer día del viaje':'Tu agenda de hoy'}</h2><a class="text-link" href="#itinerary">Itinerario ${icon('arrow')}</a></div><div class="destination-cover"><img src="./assets/${dest.key}.jpg" alt="${escape(dest.name)}" loading="lazy"><div><span>${icon('flight')} ${before?'Rumbo a Italia':escape(dest.name)}</span><strong>${escape(formatDay(day))}</strong></div></div>${eventList(dayEvents.slice(0,3))}</section></div>
 <section class="offline-banner">${icon('offline')}<div><h3>Todo a mano, incluso sin conexión</h3><p>Tu itinerario y documentos esenciales, donde estés.</p></div><a href="#offline" class="secondary">Preparar offline ${icon('arrow')}</a></section><section class="section"><div class="row"><h2>Pendientes antes de viajar</h2><a class="text-link" href="#pending">Ver todos ${icon('arrow')}</a></div>${eventList(events.filter(e=>!e.deleted_at&&(e.purchase_status==='PENDING'||e.cost_status==='ESTIMATED')).slice(0,4))}</section>`;
}
function itinerary(){const list=events.filter(e=>occursOn(e,selectedDay)),dest=destination(list),day=agendaForDay(events,selectedDay);return `<section class="page-heading"><span class="eyebrow">Explora tu viaje</span><h1>Un día a la vez.</h1><p class="subtitle">${escape(TRIP.name)} · ${tripDates()}</p></section><div class="day-strip" aria-label="Días del viaje">${dayCityCards(events,records,days(),selectedDay,mapLocations)}</div><div class="destination-cover itinerary-cover"><img src="./assets/${dest.key}.jpg" alt="${escape(dest.name)}"><div><span>${selectedDay===TRIP.start?'Comienza el viaje':escape(dest.name)}</span><strong>${escape(formatDay(selectedDay))}</strong></div></div>${day.context.length?`<section class="day-context"><h2>En curso</h2>${eventList(day.context,new Map(),true)}</section>`:''}<section class="day-agenda"><h2>Agenda del día</h2>${eventList(day.agenda,day.gaps,true)}</section>`;}
function detail(id){const event=events.find(e=>e.id===id&&!e.deleted_at);if(!event)return '<div class="empty">Este evento no está disponible offline.</div>';return renderEventDetail(event,{dayLabel:formatDay(event.start.slice(0,10)),links:active('document_links').filter(r=>r.data.calendar_event_id===id),documents});}
function budget(){const f=summary(budgetPhase);return `<div class="row page-heading"><div><span class="eyebrow">Viaja con tranquilidad · USD</span><h1>Presupuesto</h1></div><a href="#expense/new" class="primary">+ Gasto</a></div><p class="subtitle">Tus costos conocidos, en un solo lugar.</p>${financialWarning(f)}<div class="segmented" aria-label="Fase del presupuesto">${[["","Todos"],["PRE_TRIP","Pre-viaje"],["DURING_TRIP","Durante el viaje"]].map(([id,label])=>`<button data-action="budget-phase" data-id="${id}" aria-pressed="${(budgetPhase||'')===id}">${label}</button>`).join('')}</div><section class="budget-hero">${stats('USD',f)}${spendBar(f)}<div class="missing-count">Costos faltantes <strong>${f.missing_costs.length}</strong></div></section><section class="card section budget-config"><div class="row"><div><span class="eyebrow">Presupuesto configurado · USD</span><h2>${f.budget===null?'Por definir':money(f.budget)}</h2></div>${button('budget','Configurar presupuesto')}</div><p>Saldo actual: <strong>${f.balance===null?'Por definir':money(f.balance)}</strong></p><p>Disponible libre: <strong>${f.available===null?'Por definir':money(f.available)}</strong></p>${f.over_budget?`<p class="warning">Sobre presupuesto ${money(f.over_budget)}</p>`:''}${f.budget>0?`<progress max="${f.budget}" value="${Math.min(f.projected,f.budget)}"></progress>`:''}</section>${renderBudgetChart(f)}<section class="section"><div class="row"><h2>Por categoría</h2><span class="muted">USD conocido</span></div><div class="category-list">${Object.entries(f.by_category).map(([name,t])=>`<div class="category-row"><span class="event-icon ${eventVisual({title:name}).tone}">${icon(eventVisual({title:name}).icon)}</span><div><div class="row"><strong>${escape(name)}</strong><span>${money(t.projected)}</span></div><small class="category-original">${Object.entries(t.by_currency).map(([currency,original])=>escape(formatMoney(original.paid,currency,{iso:true}))+' pagados').join(' · ')}</small><progress max="${f.projected||1}" value="${t.projected}"></progress></div></div>`).join('')||'<p class="muted">Sin costos registrados todavía.</p>'}</div></section><section class="section"><h2>Monedas originales</h2><div class="segmented" aria-label="Vista del presupuesto"><button data-action="finance-view" data-id="USD" aria-pressed="${financeView==='USD'}">USD consolidado</button><button data-action="finance-view" data-id="original" aria-pressed="${financeView==='original'}">Monedas originales</button></div>${financeView==='original'?currencyTable(f):'<p class="muted">Los importes originales se conservan siempre. Puedes consultarlos por moneda.</p>'}</section><details class="card fx-details" ${fxDetailsOpen?'open':''}><summary data-action="toggle-fx">Tasas de referencia</summary><div class="row"><p class="muted">Los estimados usan la referencia vigente; los pagos conservan su tasa.</p>${button('refresh-fx','Actualizar tasas')}</div>${Object.entries(referenceRates).filter(([currency])=>currency!=='USD').map(([currency,rate])=>`<p><strong>${escape(formatMoney(1,currency,{iso:true}))} = ${rate?escape(formatMoney(rate.rate,'USD',{iso:true,digits:6})):'sin tasa disponible'}</strong>${rate?`<br><small>${escape(rate.source)} · ${escape(rate.rate_date)} · ${rate.cached?'Caché':'Referencia'}${rate.stale?' · desactualizada':''}</small>`:''}</p>`).join('')}</details><section class="section"><div class="row"><h2>Gastos manuales</h2><a href="#expenses" class="text-link">Ver todos ${icon('arrow')}</a></div>${expenseList()}</section>`;}
function expenseList(){const f=summary(budgetPhase);return (expenseDrilldown?`<p>${escape(expenseDrilldown.category)} · ${expenseDrilldown.status==='PAID'?'Pagado':'Pendiente'} ${button('clear-drilldown','Ver todos')}</p>`:'')+f.ledger.filter(x=>!expenseDrilldown||categoryFor(x)===expenseDrilldown.category&&x.cost_status===expenseDrilldown.status).map(x=>`<a class="card expense-row" href="#${x.origin==='Calendar'?'event':'expense'}/${encodeURIComponent(x.id)}"><div><h3>${escape(x.origin==='Calendar'?x.title:x.description||x.title||'Gasto')}</h3><p>${escape(categoryFor(x))} · ${x.cost_status==='PAID'?'Pagado':'Pendiente'} · ${x.phase==='PRE_TRIP'?'Pre-viaje':'Durante el viaje'}</p></div><strong>${escape(currencyMoney(x.amount_original??x.amount,x.currency_original??x.currency))}</strong></a>`).join('')||'<div class="empty">Sin gastos registrados.</div>';}

function expenseForm(id) {
  const record = active('expenses').find(x => x.id === id), d = record?.data || {};
  expenseForm.base=record?structuredClone(record):null;
  const categories=['Alojamiento','Transporte','Vuelos','Tours / Entradas','Comida','Supermercado','Compras','Equipo de viaje','Comunicaciones / SIM','Impuestos / Tasas','Farmacia / Salud','Otros'];
  return `<a class="back" href="#expenses">‹ Gastos</a><h1>${record?'Editar':'Nuevo'} gasto</h1><form id="expense-form" class="card" data-id="${escape(record?.id||'')}"><label>Descripción<input name="description" required maxlength="250" value="${escape(d.description||d.title||'')}"></label><div class="grid"><label>Monto<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${escape(d.amount)}"></label><label>Moneda<input name="currency" list="currencies" required maxlength="3" value="${escape(d.currency||'USD')}"></label><datalist id="currencies"><option>USD</option><option>EUR</option><option>CHF</option></datalist></div><label>Categoría<input name="category" list="expense-categories" required value="${escape(d.category||'Otros')}"></label><datalist id="expense-categories">${categories.map(c=>`<option value="${escape(c)}">`).join('')}</datalist><label>Estado<select name="cost_status"><option value="PAID" ${d.cost_status==='PAID'?'selected':''}>Pagado</option><option value="ESTIMATED" ${d.cost_status==='ESTIMATED'?'selected':''}>Pendiente / Estimado</option></select></label><label>Método de pago<input name="payment_method" value="${escape(d.payment_method)}"></label><label>Fecha<input name="date" type="date" required value="${escape(d.date||localDate())}"></label><details><summary>Más detalles</summary><label>Fase<select name="phase"><option value="">Automática según fecha</option><option value="PRE_TRIP" ${d.phase==='PRE_TRIP'?'selected':''}>Pre-viaje</option><option value="DURING_TRIP" ${d.phase==='DURING_TRIP'?'selected':''}>Durante el viaje</option></select></label><label>Persona<select name="person"><option value="">Sin especificar</option>${TRIP.travelers.map(person=>`<option ${d.person===person?'selected':''}>${escape(person)}</option>`).join('')}</select></label><label>Vincular evento Calendar<input name="calendar_event_id" list="expense-events" value="${escape(d.calendar_event_id)}"><datalist id="expense-events">${events.filter(e=>!e.deleted_at).map(e=>`<option value="${escape(e.id)}">${escape(e.title)}</option>`).join('')}</datalist></label><label>Purchase ID<input name="purchase_id" value="${escape(d.purchase_id)}"></label><label>Ciudad / Zona<input name="location" value="${escape(d.location)}"></label><label>Cargo real en USD<input name="actual_base_amount" type="number" min="0" step="0.01" value="${escape(d.actual_base_amount)}"></label><label>Tasa a USD por unidad<input name="exchange_rate" type="number" min="0.000001" step="any" value="${escape(d.exchange_rate)}"></label><label>Recibo existente en Drive<select name="receipt_drive_id"><option value="">Sin recibo</option>${documents.map(f=>`<option value="${escape(f.id)}" ${d.receipt_drive_id===f.id?'selected':''}>${escape(f.name)}</option>`).join('')}</select></label><label>Foto o archivo de recibo<input name="receipt" type="file" accept="image/*,application/pdf" capture="environment"></label>${d.receipt_local_id||d.receipt_drive_id?`<p>Recibo: ${escape(d.receipt_name||documents.find(f=>f.id===d.receipt_drive_id)?.name||'Archivo guardado')}${d.receipt_drive_id?` · <a href="#document/${encodeURIComponent(d.receipt_drive_id)}">Abrir recibo</a>`:' · Guardado en este dispositivo'}</p>${button('remove-receipt','Quitar recibo del gasto',record.id)}`:''}<label>Notas<textarea name="notes">${escape(d.notes)}</textarea></label></details><div class="actions"><button type="submit" class="primary">${icon('save')} Guardar gasto</button>${record?button('delete-expense','Eliminar gasto',record.id,'danger'):''}</div></form>`;
}
async function settings(){const reauth=(await store.get('meta','google-reauth'))?.value,last=(await store.get('meta','last-sync'))?.value,connected=!!(await store.get('meta','google-access'))?.value&&!reauth;return `<section class="more-header"><img src="./assets/italia.jpg" alt="Italia"><div><span class="eyebrow">Tu viaje, contigo</span><h1>Más y ajustes</h1><h2>${escape(TRIP.name)} <span class="italy-flag" aria-hidden="true"></span></h2><p>${tripDates()} · ${days().length} días</p></div></section><div class="connection-summary"><span class="${connected?'connected':''}">${icon(connected?'check':'sync')} Google ${connected?'conectado':'requiere conexión'}</span><span>${icon(last&&pending.length===0?'check':'sync')} ${pending.length?pending.length+' pendientes':last?'Sincronizado':'Sincronizar'}</span></div><div class="menu-list">${[['trip-info','Información del viaje','flight','sky'],['budget','Presupuesto','wallet','mint'],['expenses','Gastos','ticket','peach'],['pending','Pendientes','check','lavender'],['documents','Documentos','document','sky'],['map','Lugares guardados','pin','rose'],['preferences','Configuración','more','lavender'],['sync','Sincronización','sync','mint'],['offline','Modo offline','offline','sky'],['devices','Dispositivos','device','peach'],['help','Ayuda','help','rose']].map(([route,text,type,tone])=>`<a class="menu-row" href="#${route}"><span class="event-icon ${tone}">${icon(type)}</span><strong>${text}</strong><span aria-hidden="true">›</span></a>`).join('')}</div>`;}
async function syncScreen(){const connected=!!(await store.get('meta','google-access'))?.value&&!(await store.get('meta','google-reauth'))?.value,configured=(await store.get('meta','google-backend'))?.value;return `<span class="eyebrow">Tu viaje, conectado</span><h1>Sincronización</h1><section class="card"><h3>Google Calendar + Drive</h3><p class="muted">${googleState==='refreshing'?'Renovando conexión…':connected?'✓ Google conectado':(PIN_MODE?'La conexión del viaje se recupera automáticamente.':'Conecta Google para sincronizar el itinerario y tus documentos reales.')}</p><div class="actions">${PIN_MODE?'':!connected?button('google','Conectar Google','','primary'):!configured?button('google','Activar renovación automática','','primary'):''}${button('sync','Sincronizar ahora')}</div><p>${pending.length} cambios pendientes · ${conflicts.length} conflictos</p><p class="muted">Última sincronización: ${escape(formatDateTime(syncScreen.last))}</p><a class="text-link" href="#conflicts">Resolver conflictos ${icon('arrow')}</a></section><section class="card section"><h3>Integridad financiera</h3><a class="text-link" href="#financial-audit">Abrir auditoría de Calendar ${icon('arrow')}</a></section>`;}
function reviewFinance(debug=false){const audit=financialAudit(events.filter(e=>days().some(day=>occursOn(e,day)))),rows=debug?audit:audit.filter(row=>row.states.some(state=>!['OK','NON_FINANCIAL','DUPLICATE_PURCHASE'].includes(state)));return `<a class="back" href="#${debug?'sync':'budget'}">‹ ${debug?'Sincronización':'Presupuesto'}</a><h1>${debug?'Auditoría financiera':'Costos por completar'}</h1><p class="subtitle">Solo lectura. Completa los datos en Calendar; no se escriben ni se inventan precios.</p>${debug?`<div class="audit-table"><table><thead><tr>${['Evento','✅ / ☐','Label','COST','CURRENCY','COST_STATUS','PURCHASE_ID','Integridad'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td><a href="#event/${encodeURIComponent(row.id)}">${escape(row.event)}</a></td><td>${row.symbol}</td><td>${escape(row.label||'—')}</td><td>${row.cost==null?'—':escape(row.currency?currencyMoney(row.cost,row.currency):String(row.cost))}</td><td>${escape(row.currency||'—')}</td><td>${escape(row.cost_status||'—')}</td><td>${escape(row.purchase_id||'—')}</td><td>${row.states.join(' · ')}</td></tr>`).join('')}</tbody></table></div>`:rows.map(row=>`<a href="#event/${encodeURIComponent(row.id)}" class="card review-row"><span class="event-icon ${row.symbol==='✅'?'mint':'peach'}">${icon('ticket')}</span><div><h3>${escape(row.event)}</h3><p>${row.symbol==='✅'?'Pagado':row.symbol==='☐'?'Pendiente':'Revisar'} · ${escape(row.label||'Sin categoría')}</p><span class="badge pending">${row.states.includes('MISSING_COST')?'Costo por registrar':row.states.includes('MISSING_CURRENCY')?'Moneda por registrar':row.states.includes('MISSING_STATUS')?'Estado por registrar':'Símbolo y estado no coinciden'}</span></div><span>›</span></a>`).join('')||'<div class="empty">No hay costos pendientes de completar.</div>'}`;}
function mapScreen(){return mapUx.render();}
function selectMapPin(id){mapUx.select(id);focusTripPin(id);const card=document.querySelector('#pin-sheet');if(card&&card.getBoundingClientRect().top<0)card.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}

function requestValue(label,type='text',value=''){
 return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>${escape(label)}</h2><label>${escape(label)}<input type="${type}" value="${escape(value)}" autocomplete="${type==='password'?'off':'on'}" required maxlength="100" ${type==='password'?'minlength="8"':''}></label><div class="actions"><button value="cancel" formnovalidate class="secondary">Cancelar</button><button value="ok" class="primary">Continuar</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok'?dialog.querySelector('input').value:null;dialog.querySelector('input').value='';dialog.remove();resolve(result);},{once:true});});
}
function pinScreen(){return '<span class="eyebrow">Acceso privado</span><h1>Agenda Viajera</h1><section class="card"><p>'+(pinScreen.reverify?'Necesitamos verificar tu acceso.':'Ingresa tu PIN para continuar')+'</p><form id="pin-form"><label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" minlength="4" maxlength="32" required aria-label="PIN"></label><p role="status" id="pin-result"></p><button class="primary" type="submit">Entrar</button></form></section>'; }
async function deviceScreen(){
 if(PIN_MODE){const own=(await store.get('meta','device-identity'))?.value;return '<h1>Dispositivos</h1><section class="card"><h2>'+escape(own?.name||'Este dispositivo')+'</h2><p>Autorizado · '+escape(store.activeUser?.name||'')+'</p><p class="muted">Los nombres y permisos se administran en el panel privado de dispositivos.</p></section>';}
 if(Date.now()-transferRefreshAt>4000)setTimeout(()=>refreshRootTransfers(),0);
 const session=authSession,invite=await store.get('meta','pending-invite');
 const list=(await store.get('meta','device-list'))?.value||[],identity=(await store.get('meta','device-identity'))?.value;
 if(identity?.id===store.device&&!list.some(d=>d.id===identity.id))list.push(identity);
 const own=list.find(x=>x.id===store.device&&!x.deleted_at);deviceScreen.root=own?.role==='ROOT_DEVICE';
 const transfers=(await store.get('meta','root-transfer-requests'))?.value||[];
 const request=(await store.get('meta','root-transfer'))?.value;
 if(request&&!own&&location.hash!=='#devices')history.replaceState(null,'',location.pathname+'#devices');
 const transferCard=!own&&session&&deviceVerification==='unregistered'?'<section class="card"><h3>Esta es una instalación nueva de Agenda Viajera.</h3>'+(!request||request.state==='CANCELLED'?button('request-root-transfer','Transferir PC Casa a este navegador','','primary'):'<p>PC Casa actualmente está vinculada a otra instalación. La instalación anterior dejará de tener acceso.</p><p>'+ (request.approved?'Transferencia autorizada. Solo pulsa Mover PC Casa.':'Esperando autorización de PC Casa. La solicitud se actualiza automáticamente.')+'</p>'+ (request.approved?button('move-root-transfer','Mover PC Casa','','primary'):'') )+'</section>':'';
 const approvals=deviceScreen.root?(transfers.filter(r=>Date.parse(r.expires_at)>Date.now()).map(r=>'<section class="card"><h3>Solicitud para mover PC Casa</h3><p>Destino: Chrome normal'+(session?.user?.user_metadata?.given_name||session?.user?.user_metadata?.full_name?' de '+escape(session.user.user_metadata.given_name||session.user.user_metadata.full_name.split(' ')[0]):'')+'</p><p>'+escape(formatDateTime(r.created_at))+'</p><div class="actions">'+button('cancel-root-transfer','Cancelar',r.id)+(!r.approved?button('approve-root-transfer','Autorizar transferencia',r.id,'primary'):'<p>Autorizada · esperando Mover PC Casa en Chrome normal</p>')+'</div></section>').join('')+button('refresh-transfers','Actualizar solicitudes')):'';
 const upgradeCard=own?.role==='DEVICE'&&session?'<section class="card">'+button('prepare-root-upgrade','Convertir este navegador en PC Casa','','primary')+'</section>':'';
 return (session&&deviceVerification==='error'?'<section class="card" role="status"><p>No pudimos verificar este dispositivo. Reintentando conexión…</p></section>':'')+upgradeCard+transferCard+approvals+`<span class="eyebrow">Cada instalación, independiente</span><h1>Dispositivos</h1><p class="subtitle">Dispositivos vinculados · ${escape(TRIP.name)}</p>${!session&&!own?`<section class="card"><p>Conecta tu cuenta para autorizar esta instalación.</p>${PIN_MODE?'':button('google','Conectar Google','','primary')}</section>`:''}${!own&&session&&deviceVerification==='unregistered'?`<section class="card"><h3>Autorizar este dispositivo</h3><p class="muted">Usa el enlace/QR temporal generado por PC Casa.</p>${invite?button('enroll','Registrar este teléfono','','primary'):''}${!list.some(d=>d.role==='ROOT_DEVICE'&&!d.deleted_at)&&rootClaim&&new Date(rootClaim.expires_at)>new Date()?button('claim-root','Activar PC Casa','','primary'):''}</section>`:''}${own?`<div class="actions">${button('invite','Agregar dispositivo','','primary')}${button('rename-device','Nombrar esta instalación')}${deviceScreen.root?'<a class="secondary" href="#security">Seguridad</a>':button('remove-self','Quitar este dispositivo','', 'danger')}</div>`:''}<section class="section">${list.filter(d=>!d.deleted_at).map(d=>`<div class="card list-row row"><div><h3>${escape(d.name)}</h3><small>${d.role==='ROOT_DEVICE'?'ROOT · Autorizado':d.deleted_at?'Revocado':d.id===store.device?'Esta instalación':'Autorizado'}</small></div>${!d.deleted_at&&d.role!=='ROOT_DEVICE'&&d.id!==store.device?button('revoke-device','Revocar',d.id,'danger'):''}</div>`).join('')}</section>`;
}
async function securityScreen(){
  const list=(await store.get('meta','device-list'))?.value||[];const own=list.find(d=>d.id===store.device&&!d.deleted_at);
  if(own?.role!=='ROOT_DEVICE')return '<a class="back" href="#devices">‹ Dispositivos</a><h1>Seguridad</h1><section class="card"><p>La clave se solicita solo al administrar dispositivos. Ver dispositivos no requiere clave.</p><p>Para crear o cambiar la clave administrativa, usa PC Casa.</p></section>';
  if(!navigator.onLine||!authSession)return '<a class="back" href="#devices">‹ Dispositivos</a><h1>Seguridad</h1><section class="card"><p>PC Casa · ROOT · Autorizado</p><p>Conecta tu cuenta para cambiar la clave administrativa.</p></section>';
  const configured=await devices.adminConfigured();securityScreen.configured=configured;
  return `<a class="back" href="#devices">‹ Dispositivos</a><span class="eyebrow">PC Casa · ROOT protegido</span><h1>Seguridad</h1><section class="card detail"><h2>${configured?'Cambiar clave administrativa':'Crear clave administrativa'}</h2><p class="muted">Los celulares usarán esta clave únicamente para administrar dispositivos. PC Casa administra sin PIN y ningún celular puede revocarla.</p><form id="security-form">${configured?'<label>Clave actual<input name="current" type="password" autocomplete="current-password" required minlength="8" maxlength="100"></label>':''}<label>Nueva clave administrativa<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label><label>Confirmar nueva clave<input name="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label><p class="muted">Usa al menos 8 caracteres. La clave se guarda como una derivación fuerte con salt; no se guarda en este dispositivo.</p><button type="submit" class="primary">${configured?'Cambiar clave administrativa':'Crear clave administrativa'}</button><p id="security-result" role="status"></p></form></section>`;
}
async function offline() {
  const calendar = await store.get('meta', 'calendar-sync'), last = await store.get('meta', 'last-sync');
  const selected = documents.filter(x => x.offline);
  const cached = await Promise.all(selected.map(x => store.get('blobs', `drive:${x.id}`)));
  const checks = [['Itinerario real de Calendar', calendar?.source==='google-api'], ['Presupuesto y gastos sincronizados', !!last&&pending.length===0&&conflicts.length===0], ['Presupuesto configurado', active('budgets').length > 0], ['Documentos y boletos seleccionados', selected.length > 0 && cached.every(Boolean)], ['Shell offline', !!navigator.serviceWorker?.controller]];
  const ready = checks.filter(([name])=>name!=='Presupuesto configurado').every(x => x[1]);
  return `<h1>Preparar offline</h1><p class="subtitle">Lleva lo esencial contigo.</p><section class="card">${checks.map(([name, ok]) => `<div class="offline-check"><span>${name}</span><strong>${ok ? '✓' : 'Pendiente'}</strong></div>`).join('')}<div class="actions">${button('prepare-offline', 'Verificar y descargar', '', 'primary')}<a class="secondary" href="#documents">Seleccionar documentos</a></div><p class="${ready ? 'badge paid' : 'warning'}">${ready ? escape(TRIP.name)+' listo para usar offline' : 'Preparación incompleta. Sincroniza y descarga tus documentos seleccionados.'}</p></section>`;
}
async function documentList(){const available=new Set(await new OfflineDocuments(store,google).available(documents));return '<div class="row"><h1>Documentos</h1>'+iconButton('load-documents','Actualizar Drive','sync')+'</div><section class="card"><div class="actions">'+button('download-all-documents','Descargar todo para offline','','primary')+button('update-offline-documents','Actualizar documentos offline')+'</div><div id="documents-progress" role="status" aria-live="polite">'+(docsProgress?docsProgress.completed+' / '+docsProgress.total:'✓ '+available.size+' documentos disponibles offline')+'</div></section>'+documents.map(file=>'<div class="card list-row row"><a href="#document/'+encodeURIComponent(file.id)+'"><h3>'+escape(file.name)+'</h3><small>'+(available.has(file.id)?'✓ Disponible offline':'Pendiente de descarga')+'</small></a>'+iconButton('download-document','Descargar copia offline','download',file.id)+'</div>').join('');}
async function downloadDocuments(files,fullListing=false){offlineDocuments ||= new OfflineDocuments(store,google);const result=await offlineDocuments.download(files,p=>{docsProgress=p;const node=document.querySelector('#documents-progress');if(node)node.textContent=p.completed+' / '+p.total;},fullListing);docsProgress=null;if(result.failures.length)notice(result.completed+' / '+result.total+' disponibles. Algunas descargas no terminaron; puedes reintentar.');else notice('✓ '+result.completed+' documentos disponibles offline');return result;}
function conflictValue(conflict,value){if(['amount','amount_original','cost','amount_base','actual_base_amount','base_amount'].includes(conflict.field)){const record=records.find(r=>r.id===conflict.record_id);return formatMoney(value,['amount_base','actual_base_amount','base_amount'].includes(conflict.field)?'USD':record?.data.currency_original||record?.data.currency||'USD');}return JSON.stringify(value??null);}
async function render() {

  now = new Date(); [events, records, pending, conflicts] = await Promise.all(['events','records','outbox','conflicts'].map(name => store.all(name)));
  mapLocations=(await store.get('meta','map-locations'))?.value||{};
  events=events.map(e=>{const parsed=normalizeEvent({id:e.id,summary:e.title,description:e.description});return {...e,cost:parsed.cost,currency:parsed.currency,cost_status:parsed.cost_status,purchase_status:parsed.purchase_status,purchase_id:parsed.purchase_id,financial_fields:parsed.financial_fields,financial_state:parsed.financial_state,warnings:parsed.warnings};});
  const [route, rawId] = (location.hash.slice(1) || 'home').split('/'), id = decodeURIComponent(rawId || '');
  const navRoute=['home','itinerary','map','documents','settings'].includes(route)?route:route==='event'?'itinerary':route==='document'?'documents':'settings';document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash===`#${navRoute}`));
  updateConnection();
  if(PIN_MODE){const active=store.activeUser?.authorized;document.querySelector('nav').hidden=!active;let userHeader=document.querySelector('#active-user-header');if(!userHeader){userHeader=document.createElement('span');userHeader.id='active-user-header';document.querySelector('header').append(userHeader);}userHeader.innerHTML=active?escape(store.activeUser.name)+' '+button('switch-user','Cambiar usuario'):'';if(!active){app.innerHTML=pinScreen();closeTripMap();return;}}
  if(!PIN_MODE&&document.documentElement.dataset.av2Staging==='true'&&(!(await store.get('meta','authorized'))?.value||(!Object.isFrozen(TRIP)&&!(await store.get('meta','trip-config'))?.value))&&!events.length&&!records.length){
    app.innerHTML=authSession?await deviceScreen():`<span class="eyebrow">Acceso privado</span><h1>Agenda Viajera 2.0</h1><section class="card"><p>Inicia sesión para acceder a tus viajes desde un dispositivo autorizado.</p>${PIN_MODE?'':button('google','Conectar Google','','primary')}</section>`;
    closeTripMap();return;
  }
  if(route==='devices'){app.innerHTML=await deviceScreen();return;}
  if(PIN_MODE&&route==='security'){app.innerHTML=await deviceScreen();return;}
  if(route==='security'){try{app.innerHTML=await securityScreen();}catch{app.innerHTML='<a class="back" href="#devices">‹ Dispositivos</a><h1>Seguridad</h1><p class="warning">Conéctate para consultar o cambiar la configuración de seguridad.</p>';}return;}

  updateConnection();
  if (route === 'home') app.innerHTML = home(); else if (route === 'itinerary') app.innerHTML = itinerary(); else if (route === 'event') app.innerHTML = detail(id); else if (route === 'budget') {app.innerHTML = budget();} else if (route === 'expense') app.innerHTML = expenseForm(id); else if (route === 'expenses') app.innerHTML = `<div class="row"><h1>Gastos</h1><a class="primary" href="#expense/new">+ Gasto</a></div>${expenseList()}<details class="card"><summary>Gastos eliminados</summary>${records.filter(r=>r.kind==='expenses'&&r.deleted_at).map(r=>`<div class="row"><span>${escape(r.data.description||r.data.title||r.data.expense_id)}</span>${button('restore-expense','Restaurar',r.id)}</div>`).join('')}</details>`; else if (route === 'documents') app.innerHTML = await documentList(); else if (route === 'offline') app.innerHTML = await offline(); else if (route === 'sync') {syncScreen.last=(await store.get('meta','last-sync'))?.value;app.innerHTML=await syncScreen();} else if(route==='financial-review'||route==='financial-audit') app.innerHTML=reviewFinance(route==='financial-audit'); else if(route==='map') app.innerHTML=mapScreen(); else if(route==='place-edit'||(route==='place'&&id==='new'))app.innerHTML=mapUx.form(id);else if(route==='place')app.innerHTML=mapUx.detail(id); else if(route==='pending') app.innerHTML='<h1>Pendientes</h1>'+eventList(events.filter(e=>!e.deleted_at&&(e.purchase_status==='PENDING'||e.cost_status==='ESTIMATED'))); else if(route==='trip-info') app.innerHTML=`<h1>Información del viaje</h1><section class="card"><h2>${escape(TRIP.name)} <span class="italy-flag" aria-hidden="true"></span></h2><p>${tripDates()} · ${days().length} días</p><p>${escape(TRIP.travelers.join(' + '))}</p><p>Moneda base: USD · Horarios locales de cada evento</p></section>`; else if(route==='preferences') app.innerHTML='<h1>Configuración</h1><section class="card"><p>Moneda base: USD · Importes originales conservados</p><p>Horarios locales: AM/PM + formato militar</p>'+button('install','Instalar aplicación','','primary')+'<p><a class="text-link" href="#devices">Seguridad y dispositivos ›</a></p></section>'; else if(route==='help'){const credits=await(await fetch('./assets/credits.json')).json();app.innerHTML='<h1>Ayuda</h1><section class="card"><h2>Tu viaje, también offline</h2><p>Sincroniza antes de salir y descarga tus documentos. La conexión Google se renueva automáticamente. Si cambia tu autorización, la aplicación te pedirá verificar tu acceso; tus datos locales permanecen guardados.</p><a class="text-link" href="#offline">Preparar offline ›</a></section><section class="card section"><h2>Fotografías</h2>'+credits.map(c=>'<p><a href="'+escape(c.source)+'" target="_blank" rel="noopener">'+escape(c.key)+' · '+escape(c.author)+'</a> · <a href="'+escape(c.license_url)+'">'+escape(c.license)+'</a></p>').join('')+'</section>'; } else if (route === 'conflicts') app.innerHTML = `<h1>Resolver conflictos</h1>${conflicts.map(c => `<section class="card section"><h3>${escape(c.field)}</h3><p>Servidor: ${escape(conflictValue(c,c.current))}</p><p>Este dispositivo: ${escape(conflictValue(c,c.incoming))}</p>${button('resolve-current','Conservar servidor',c.id)} ${c.field !== 'deleted_at' ? button('resolve-incoming','Usar valor local',c.id) : '<p class="warning">El registro eliminado no puede resucitarse. Ambos valores se conservan para revisión.</p>'}</section>`).join('') || '<div class="empty">No hay conflictos pendientes.</div>'}`; else if (route === 'document') {
    const file = documents.find(x => x.id === id), cached = await store.get('blobs', `drive:${id}`);
    if (render.objectUrl) URL.revokeObjectURL(render.objectUrl);
    render.objectUrl = cached ? URL.createObjectURL(cached.blob) : null;
    app.innerHTML = `<a class="back" href="#documents">‹ Documentos</a><h1>${escape(file?.name || 'Documento')}</h1>${cached ? `<a class="primary" href="${render.objectUrl}" download="${escape(file?.name || 'documento')}">Abrir archivo offline</a>${['application/pdf','image/png','image/jpeg','image/webp'].includes(cached.blob.type) ? `<iframe title="Documento offline" sandbox src="${render.objectUrl}"></iframe>` : ''}` : '<p class="muted">Sin copia offline en este dispositivo.</p>'}${file ? `<div class="actions">${button('download-document','Descargar copia offline',file.id)}<a class="secondary" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view">Abrir en Google Drive ↗</a></div>` : ''}`;
  } else app.innerHTML = await settings();
  app.querySelectorAll('.back').forEach(a=>{const text=a.textContent.replace(/^‹\s*/, '').trim();a.innerHTML=icon('back')+' '+escape(text);a.setAttribute('aria-label',text);a.title=text;});app.querySelectorAll('button[type=submit]').forEach(b=>{if(/Guardar/.test(b.textContent)&&!b.querySelector('svg')){b.setAttribute('aria-label',b.textContent.trim());b.title=b.textContent.trim();b.insertAdjacentHTML('afterbegin',icon('save')+' ');}});
  if(route==='itinerary')wireDayCarousel(app.querySelector('.day-strip'));
  if(route==='map')mountTripMap(app.querySelector('#trip-map'),mapUx.visible(),selectMapPin,mapUx.mode+':'+mapUx.label+':'+selectedDay,mapUx.position,mapUx.selected);else closeTripMap();
  if(route==='event'){const warnings=events.find(x=>x.id===id)?.warnings||[];if(warnings.length)app.insertAdjacentHTML('beforeend',`<p class="warning">${warnings.map(escape).join('<br>')}</p>`);}
  if(route==='document'&&documents.some(x=>x.id===id))app.insertAdjacentHTML('beforeend',`<div class="actions">${button('trash-document','Enviar archivo a la papelera de Google Drive',id,'danger')}</div>`);
}
function syncAll(){
 if(syncAll.running)return syncAll.running;
 syncAll.running=(async()=>{
  await remoteStartup;
  if(!navigator.onLine){calendarStatus='error';updateConnection();throw Error('Sin conexión. Tus cambios siguen guardados localmente.');}
  calendarStatus='updating';calendarFailure='';updateConnection();
  try{
   let remoteError=null;try{await sync.run();financialRemoteReady=true;}catch(error){remoteError=error;}
   await remote.check();await google.syncCalendar(store);calendarUpdatedAt=(await store.get('meta','calendar-sync'))?.synced_at;
   // Every Calendar commit immediately replaces the inputs of all derived views.
   await refreshBackground();await refreshRates();await refreshBackground();await loadDocuments();if(remoteError)throw remoteError;
   calendarStatus='ready';
  }catch(error){calendarStatus='error';calendarFailure=error.message;if(PIN_MODE&&['PIN_CHANGED','DEVICE_REVOKED','USER_INACTIVE','AV2_DEVICE_REVOKED'].some(code=>error.message.includes(code))){await pinAccess.lock(false);pinScreen.reverify=true;await render();}else if(error.message.includes('AV2_DEVICE_REVOKED')){financialRemoteReady=false;await store.purge();await client.auth.signOut({scope:'local'});documents=[];await render();}throw error;}
  finally{await refreshBackground();updateConnection();}
 })().finally(()=>{syncAll.running=null;});return syncAll.running;
}
async function refreshRates(force=false){
  const currentEvents=(await store.all('events')).filter(e=>!e.deleted_at),currentRecords=(await store.all('records')).filter(r=>!r.deleted_at);
  const currencies=new Set(['USD','EUR','CHF',...currentEvents.map(e=>e.currency).filter(Boolean),...currentRecords.filter(r=>r.kind==='expenses').map(r=>r.data.currency_original||r.data.currency).filter(Boolean)]);
  await Promise.all([...currencies].map(async currency=>{try{referenceRates[currency]=await rateService.get(currency,TRIP.currency,force);}catch{referenceRates[currency]=null;}}));
  await store.put('meta',{id:'fx-view',value:referenceRates});
  // The first snapshot is a shared, immutable record; later provider updates
  // only revalue ESTIMATED costs. A whole snapshot is one conflict field.
  if(financialRemoteReady&&(await store.get('meta','authorized'))?.value){
    const hydratedRecords=await store.all('records');
    for(const event of currentEvents.filter(e=>e.cost_status==='PAID'&&e.currency!==TRIP.currency&&e.cost!==null)){
      const rate=referenceRates[event.currency];if(!rate)continue;const id=await calendarFxId(TRIP.id,event);if(hydratedRecords.some(r=>r.id===id))continue;
      await store.mutate('app_settings',id,{type:'calendar_fx',event_id:event.id,snapshot:expenseSnapshots({amount:event.cost,currency:event.currency,cost_status:'PAID'}, {},rate)});
    }
    scheduleSync();
  }
}
async function loadDocuments() {
  await remote.check(); const files = await google.listDocuments();
  documents = files.map(file => ({ ...file, offline: documents.find(x => x.id === file.id)?.offline || false }));
  await store.put('meta', { id: 'drive-files', value: documents });
}
app.addEventListener('input',event=>{if(event.target.name==='currency'){const prefix=app.querySelector('[data-money-prefix]');if(prefix)prefix.textContent=validCurrency(event.target.value)?currencyPrefix(event.target.value):'—';}});
app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault(); target.disabled = true;
  const { action, id } = target.dataset;
  try {
    if(PIN_MODE&&!store.activeUser?.authorized)return;
    if(PIN_MODE&&['google','request-root-transfer','prepare-root-upgrade','move-root-transfer','claim-root','enroll','invite','approve-root-transfer','cancel-root-transfer'].includes(action))return;
    if(await mapUx.action(action,id)){await render();scheduleSync();return;}
    if(action==='switch-user'){await pinAccess.lock();pinScreen.reverify=false;await render();return;}
    if(action==='restore-expense'){await store.restoreExpense(id);}else if(action==='clear-drilldown'){expenseDrilldown=null;}else if(action==='budget-phase'){budgetPhase=id||null;}else if(action==='budget-slice'){document.querySelector('#budget-slice-detail').innerHTML=budgetSliceDetail(summary(budgetPhase),Number(id));return;}else if(action==='budget-drilldown'){expenseDrilldown=budgetSlices(summary(budgetPhase))[Number(id)];location.hash='#expenses';}else if (action === 'day') selectedDay = id;
    else if(action==='map-filter'){mapFilter=id;selectedPin=null;}
    else if(action==='pin'){selectMapPin(id);return;}
    else if(action==='close-pin'){selectedPin=null;mapUx.selected=null;focusTripPin(null);document.querySelector('#pin-sheet').innerHTML='';return;}
    else if (action === 'google') { const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}`,queryParams:await googleAuthorization.oauthQuery(), scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendars.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly' } }); if (error) throw error; }
    else if(action==='request-root-transfer'){
      if(!navigator.onLine){notice('Conecta Internet para transferir PC Casa.');return;}
      const ticket=randomToken(),status=await devices.requestTransfer(store.installation,ticket);
      await store.put('meta',{id:'root-transfer',value:{ticket,...status,state:'PENDING'}});
      await refreshRootTransfers();
    }
    else if(action==='prepare-root-upgrade'){
      if(!navigator.onLine){notice('Conecta Internet para convertir esta instalación.');return;}
      let request=(await store.get('meta','root-transfer'))?.value;
      if(!request||request.state==='CANCELLED'||Date.parse(request.expires_at)<=Date.now())request={ticket:randomToken()};
      request={...request,...await devices.requestTransfer(store.installation,request.ticket)};
      await store.put('meta',{id:'root-transfer',value:request});
      const cachedEvents=await store.all('events'),cachedRecords=await store.all('records'),user=(await client.auth.getUser()).data.user;
      await devices.call('av2_root_upgrade_preflight',{p_request:request.id,p_data:{events:cachedEvents.length,pins:mapPlaces(cachedEvents).length,documents:((await store.get('meta','drive-files'))?.value||[]).length,records:cachedRecords.length,google_connected:!!(await store.get('meta','google-access'))?.value,google_backend:!!(await store.get('meta','google-backend'))?.value,budget_ready:(await budget()).includes('paid-stat'),session_valid:!!user&&user.id===authSession.user.id}});
      const confirmed=await new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.id='root-upgrade-confirm';dialog.innerHTML='<form method="dialog"><h2>Convertir este navegador en PC Casa</h2><p>Esta instalación reemplazará a la PC Casa anterior como dispositivo ROOT. La instalación anterior perderá privilegios ROOT.</p><p class="upgrade-status">Esperando autorización de PC Casa…</p><div class="actions"><button class="secondary" value="cancel">Cancelar</button><button class="primary" value="upgrade" disabled>Convertir en PC Casa</button></div></form>';document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='upgrade');dialog.remove();},{once:true});refreshRootTransfers();});
      if(!confirmed)return;
      request=(await store.get('meta','root-transfer'))?.value;
      const own=await devices.consumeTransfer(store.installation,request.ticket);await store.bindDevice(own);await store.transaction(['meta'],tx=>tx.objectStore('meta').delete('root-transfer'));await refreshDeviceIdentity();location.hash='#home';await syncAll();notice('Este navegador ya es PC Casa · ROOT · Autorizado.');
    }
    else if(action==='move-root-transfer'){
      const request=(await store.get('meta','root-transfer'))?.value;if(!request)return;
      try{const own=await devices.consumeTransfer(store.installation,request.ticket);await store.bindDevice(own);await store.transaction(['meta'],tx=>tx.objectStore('meta').delete('root-transfer'));await refreshDeviceIdentity();location.hash='#home';await syncAll();notice('PC Casa se movió a este navegador.');}
      catch(error){if(error.message.includes('AV2_TRANSFER_NOT_APPROVED_OR_EXPIRED')){await refreshRootTransfers();notice('La solicitud se está actualizando. Espera la autorización de PC Casa.');return;}throw error;}
    }
    else if(action==='refresh-transfers'){await refreshRootTransfers();}
    else if(action==='approve-root-transfer'){await devices.approveTransfer(id);await refreshRootTransfers();notice('Transferencia autorizada. Solo pulsa Mover PC Casa en Chrome normal.');}
    else if(action==='cancel-root-transfer'){await devices.cancelTransfer(id);await refreshRootTransfers();notice('Solicitud cancelada.');}
    else if(action==='claim-root'){await devices.claimRoot(rootClaim?.token);rootClaim=null;await refreshDeviceIdentity();await store.put('meta',{id:'authorized',value:true});await syncAll();}
    else if(action==='enroll'){const name=await requestValue('Nombre del teléfono','text','Mi teléfono');if(name){await devices.enroll((await store.get('meta','pending-invite'))?.value,name);await refreshDeviceIdentity();await store.transaction(['meta'],tx=>tx.objectStore('meta').delete('pending-invite'));await store.put('meta',{id:'authorized',value:true});location.hash='#home';await syncAll();notice('Dispositivo autorizado. Puedes instalar la PWA y preparar offline.');}}
    else if(action==='rename-device'){const name=await requestValue('Nombre de esta instalación');if(name){await devices.rename(name);await refreshDeviceIdentity();}}
    else if(action==='toggle-fx')fxDetailsOpen=!fxDetailsOpen;
    else if(action==='finance-view'){financeView=id==='original'?'original':'USD';await store.put('meta',{id:'finance-view',value:financeView});}
    else if(action==='refresh-fx'){await refreshRates(true);notice('Referencias actualizadas; los pagos conservan su snapshot.');}
    else if(action==='invite'){
      deviceScreen.root=(await devices.list()).find(d=>d.id===store.device&&!d.deleted_at)?.role==='ROOT_DEVICE';
      const password=deviceScreen.root?null:await requestValue('Clave administrativa','password');if(!deviceScreen.root&&!password)return;
      const invite=await devices.invite(password),url=`${location.origin}${location.pathname}#invite/${invite.token}`;
      const qr=qrcode(0,'M');qr.addData(url);qr.make();const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>Agregar dispositivo</h2><p>Un solo uso · válido hasta ${escape(formatDateTime(invite.expires_at))}</p>${qr.createSvgTag(4,4)}<label>Enlace temporal<input readonly value="${escape(url)}"></label><button class="primary">Cerrar</button></form>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    }
    else if(action==='revoke-device'){if(confirm('¿Revocar este teléfono? Al reconectarse perderá acceso y se invalidarán sus datos locales.')){const password=deviceScreen.root?null:await requestValue('Clave administrativa','password');if(deviceScreen.root||password){await devices.revoke(id,password);await refreshDeviceIdentity();}}}
    else if(action==='remove-self'){if(confirm('¿Quitar esta instalación y eliminar sus datos locales?')){await devices.revoke(store.device,null,true);await store.purge();await client.auth.signOut({scope:'local'});location.reload();}}
    else if (action === 'sync') { await syncAll(); notice('Sincronización completada.'); }
    else if (action === 'budget') {
      const value=await new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>Presupuesto del viaje</h2><label>Presupuesto en USD<div class="money-input"><span aria-hidden="true">${currencyPrefix('USD')}</span><input type="number" min="0" step="0.01" required value="${escape(active('budgets')[0]?.data.amount??'')}"></div></label><div class="actions"><button value="cancel" class="secondary" formnovalidate>Cancelar</button><button value="save" class="primary">Guardar presupuesto</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='save'?Number(dialog.querySelector('input').value):null);dialog.remove();},{once:true});});
      if(value!==null&&Number.isFinite(value)&&value>=0)await store.mutate('budgets',active('budgets')[0]?.id||TRIP.id,{amount:value,currency:'USD'});
    } else if (action === 'delete-expense') { if (confirm('¿Eliminar este gasto? Se sincronizará una eliminación.')) { await store.mutate('expenses', id, {}, true); location.hash = '#expenses'; } }
    else if (action === 'remove-receipt') { await store.mutate('expenses', id, { receipt_local_id: null, receipt_drive_id: null, receipt_name: null }); }
    else if (action === 'load-documents') await loadDocuments();
    else if(action==='trash-document'){if(confirm('Esta operación enviará el archivo REAL a la papelera de Google Drive. Desvincular un documento no lo elimina. ¿Continuar?')){await google.trashDocument(id);documents=documents.filter(x=>x.id!==id);await store.put('meta',{id:'drive-files',value:documents});location.hash='#documents';}}
    else if (action === 'link-document') {
      if (!documents.length) await loadDocuments();
      const dialog = document.createElement('dialog'); dialog.innerHTML = `<form method="dialog"><h2>Vincular archivo de Drive</h2><label>Documento<select name="file">${documents.map(file => `<option value="${escape(file.id)}">${escape(file.name)}</option>`).join('')}</select></label><div class="actions"><button value="cancel" class="secondary">Cancelar</button><button value="link" class="primary">Vincular</button></div></form>`;
      document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', async () => { try { if (dialog.returnValue === 'link' && documents.length) { const fileId = dialog.querySelector('select').value; if (!active('document_links').some(x => x.data.calendar_event_id === id && x.data.drive_file_id === fileId)) await store.mutate('document_links', crypto.randomUUID(), { calendar_event_id: id, drive_file_id: fileId }); await render(); } } catch (error) { notice(error.message); } finally { dialog.remove(); } }, { once: true });
    } else if (action === 'unlink') await store.mutate('document_links', id, {}, true);
    else if (action === 'offline-document') { documents = documents.map(x => x.id === id ? { ...x, offline: !x.offline } : x); await store.put('meta', { id: 'drive-files', value: documents }); }
    else if(action==='download-all-documents'||action==='update-offline-documents'){await loadDocuments();await downloadDocuments(documents,true);}
    else if(action==='download-document'){await remote.check();await downloadDocuments(documents.filter(f=>f.id===id));}else if (action === 'prepare-offline'){await syncAll();await downloadDocuments(documents);}
    else if (action.startsWith('resolve-')) {
      const c = conflicts.find(x => x.id === id); if (c.resolving) throw Error('La resolución está pendiente de sincronizar.');
      await store.resolve(c, action === 'resolve-incoming' ? 'incoming' : 'current'); notice('Resolución guardada; pendiente de sincronizar.');
    } else if (action === 'install') { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; } else notice('Usa el menú del navegador: Instalar aplicación o Añadir a pantalla de inicio.'); }
    await render();scheduleSync();
  } catch (error) { notice(error.message); await render(); }
  finally { target.disabled = false; }
});
document.querySelector('header').addEventListener('click',async event=>{if(event.target.closest('[data-action="switch-user"]')){const locking=pinAccess.lock();await render();await locking;}});
app.addEventListener('submit', async event => {
 if(event.target.id==='place-form'){event.preventDefault();const form=event.target;form.querySelector('button[type=submit]').disabled=true;try{await mapUx.submit(form);location.hash='#map';await render();scheduleSync();}catch(error){form.querySelector('#place-result').textContent=error.message;form.querySelector('button[type=submit]').disabled=false;}return;}
 if(event.target.id==='pin-form'){event.preventDefault();const form=event.target,submit=form.querySelector('button'),result=form.querySelector('#pin-result');submit.disabled=true;let pin=form.elements.pin.value;form.elements.pin.value='';try{await remoteStartup;await pinAccess.login(pin);pin='';remote.device=store.device;remote.token=store.deviceToken;authSession=(await client.auth.getSession()).data.session;{const config=await remote.rpc('av2_trip_configuration',remote.credentials());if(!Object.isFrozen(TRIP))Object.assign(TRIP,config);if(!days().includes(selectedDay))selectedDay=TRIP.start;}await store.put('meta',{id:'trip-config',value:{...TRIP}});pinScreen.reverify=false;location.hash='#home';await render();calendarRefresh?.request({force:true}).catch(()=>{});}catch(error){result.textContent=error.message==='PIN_RATE_LIMIT'?'Demasiados intentos. Espera unos minutos antes de volver a intentar.':error.message==='PIN_INVALID'?'No pudimos verificar ese PIN.':'No se pudo conectar. Vuelve a intentar cuando tengas conexión.';}finally{pin='';submit.disabled=false;}return;}
  if(event.target.id==='security-form'){
    event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]'),result=form.querySelector('#security-result');
    const password=form.elements.password.value,confirmation=form.elements.confirmation.value,current=securityScreen.configured?form.elements.current.value:null;
    if(password!==confirmation){result.textContent='La confirmación no coincide con la nueva clave.';return;}
    submit.disabled=true;
    try{await devices.setAdmin(password,current);notice('Clave administrativa guardada de forma segura.');app.innerHTML=await securityScreen();}
    catch(error){result.textContent=error.message.includes('AV2_ADMIN_PROOF_INVALID')?'La clave actual no es correcta.':error.message.includes('AV2_ADMIN_RATE_LIMIT')?'Demasiados intentos. Espera diez minutos.':'No se pudo guardar la clave. Revisa la conexión y vuelve a intentarlo.';}
    finally{for(const input of form.querySelectorAll('input[type=password]'))input.value='';submit.disabled=false;}
    return;
  }
  if (event.target.id !== 'expense-form') return; event.preventDefault();
  const form = event.target, submit = form.querySelector('[type=submit]'); submit.disabled = true;
  try {
    const values = new FormData(form);let data = Object.fromEntries([...values].filter(([key]) => key !== 'receipt'));
    data.amount = Number(data.amount); data.exchange_rate = data.exchange_rate ? Number(data.exchange_rate) : null;
    data=expenseSnapshots(data,expenseForm.base?.data||{},await rateService.get(data.currency,TRIP.currency));
    const receipt = values.get('receipt'); let blob = null;if(data.receipt_drive_id!==(expenseForm.base?.data.receipt_drive_id||'')){data.receipt_local_id=null;data.receipt_name=documents.find(f=>f.id===data.receipt_drive_id)?.name||null;}
    if (receipt?.size) { data.receipt_local_id = crypto.randomUUID(); data.receipt_name = receipt.name; data.receipt_drive_id = null; blob = { id: data.receipt_local_id, value: receipt }; }
    await store.mutate('expenses', form.dataset.id || crypto.randomUUID(), data, false, blob,expenseForm.base);
    location.hash = '#expenses'; notice('Gasto guardado en este dispositivo.');scheduleSync();
  } catch (error) { notice(error.message); } finally { submit.disabled = false; }
});
addEventListener('hashchange', () => render().catch(error => notice(error.message)));

addEventListener('offline', () => refreshRates().then(()=>refreshBackground()).catch(()=>refreshBackground()));
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
async function refreshBackground(){if(PIN_MODE&&!store.activeUser?.authorized&&document.querySelector('#pin-form')){updateConnection();return;}if(location.hash.startsWith('#place')||location.hash.startsWith('#expense/')||(location.hash==='#security'&&document.querySelector('#security-form'))){updateConnection();return;}await render();}
function scheduleSync(){clearTimeout(scheduleSync.timer);scheduleSync.timer=setTimeout(async()=>{if(sync&&navigator.onLine&&(!PIN_MODE||store.activeUser?.authorized)&&(await store.get('meta','authorized'))?.value){try{await sync.run();await refreshBackground();}catch(error){notice(error.message);if(error.message.includes('AV2_DEVICE_REVOKED'))await render();else await refreshBackground();}}},1000);}
await render();
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then(registration=>{
  const showUpdate = () => { const update = document.querySelector('#update'); update.hidden = false; update.onclick = () => registration.waiting?.postMessage('ACTIVATE_UPDATE'); };
  if (registration.waiting) showUpdate();
  registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', () => { if (registration.waiting && navigator.serviceWorker.controller) showUpdate(); }); });
  let changing = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || changing) return; changing = true; location.reload(); });
  }).catch(()=>{});
}
setInterval(()=>{if(document.visibilityState==='visible'){updateConnection();if((location.hash||'#home')==='#home')render().catch(error=>notice(error.message));}},60000);

async function refreshRootTransfers(){
 if(PIN_MODE||refreshingTransfers||!devices||!navigator.onLine||!authSession)return;
 refreshingTransfers=true;
 try{
  const own=(await store.get('meta','device-identity'))?.value;
  if(own?.id===store.device&&own.role==='ROOT_DEVICE'&&!own.deleted_at){await store.put('meta',{id:'root-transfer-requests',value:(await devices.pendingTransfers())||[]});}
  else{let request=(await store.get('meta','root-transfer'))?.value;if(request){const status=await devices.transferStatus(store.installation,request.ticket);request={...request,...status};await store.put('meta',{id:'root-transfer',value:request});}}
  const dialog=document.querySelector('#root-upgrade-confirm');if(dialog){const request=(await store.get('meta','root-transfer'))?.value;dialog.querySelector('[value=upgrade]').disabled=!request?.approved;dialog.querySelector('.upgrade-status').textContent=request?.approved?'Autorizada. Solo pulsa Convertir en PC Casa.':'Esperando autorización de PC Casa…';}
  transferRefreshAt=Date.now();if(location.hash==='#devices')await render();
 }catch{/* Keep local UI and retry automatically without discarding installation data. */}
 finally{refreshingTransfers=false;}
}
setInterval(()=>{if(document.visibilityState==='visible'&&location.hash==='#devices')refreshRootTransfers();},5000);
// Sheet API changes arrive independently of Calendar; pull while this PWA is visible.
setInterval(()=>{if(PIN_MODE&&document.visibilityState==='visible'&&store.activeUser?.authorized)scheduleSync();},15000);
async function refreshDeviceIdentity(){
 if(PIN_MODE){if(!navigator.onLine||!store.activeUser?.authorized||!pinAccess)return;try{await pinAccess.validate();}catch(error){if(error.message!=='ACCESS_UNAVAILABLE'){pinScreen.reverify=true;await render();}}return;}
 if(!navigator.onLine||!authSession||verifyingDevice)return;
 verifyingDevice=true;
 try{
  const own=await remote.rpc('av2_recover_device',{p_trip:TRIP.id,p_token:store.deviceToken});
  if(own?.id){await store.bindDevice(own);remote.device=store.device;}
  else{const status=await remote.rpc('av2_device_status',remote.credentials());if(status==='UNENROLLED'&&!(await store.get('meta','device-identity'))?.value){deviceVerification='unregistered';return;}if(status!=='ACTIVE')throw Error('AV2_DEVICE_RECOVERY_DENIED');}
  const list=await devices.list();await store.put('meta',{id:'device-list',value:list});
  const current=list.find(d=>d.id===store.device&&!d.deleted_at);
  if(!current)throw Error('AV2_DEVICE_RECOVERY_DENIED');
  deviceVerification='verified';
  if(current){await store.bindDevice(current);if(document.documentElement.dataset.av2Staging==='true'&&!Object.isFrozen(TRIP)){const config=await remote.rpc('av2_trip_configuration',remote.credentials());Object.assign(TRIP,config);await store.put('meta',{id:'trip-config',value:config});if(!days().includes(selectedDay))selectedDay=TRIP.start;}}
   await refreshRootTransfers();
 }catch{deviceVerification='error';/* Preserve cached identity and offline data; API failure never means a new installation. */}
 finally{verifyingDevice=false;}
}
async function startRemote(){
if(PIN_MODE){
 client=createClient('https://cslludzuejkhsydqiabx.supabase.co','sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U',{auth:{storageKey:'av2.pin.auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
 pinAccess=new PinAccess(store,client);remote=new SupabaseRemote(client,store.device,store.deviceToken);remote.pinAccess=pinAccess;
 const backend=new GoogleProviderBackend(client,()=>remote.credentials());mapUx.resolve=async inputs=>(await backend.call('resolve_locations',{inputs,details:true})).locations;const locationCache=new LocationCache(async inputs=>(await backend.call('resolve_locations',{inputs,details:true})).locations);
 googleAuthorization=new GoogleAuthorization(store,backend,state=>{googleState=state;updateConnection();});
 google=new GoogleSource(()=>googleAuthorization.token(),fetch,()=>remote.check(),token=>googleAuthorization.recover(token),local=>locationCache.refresh(local),async()=>(await backend.call("event_cities")).rows);sync=new SyncEngine(store,remote,google);
 if(navigator.onLine&&store.activeUser?.authorized){try{await pinAccess.validate();remote.device=store.device;{const config=await remote.rpc('av2_trip_configuration',remote.credentials());if(!Object.isFrozen(TRIP))Object.assign(TRIP,config);if(!days().includes(selectedDay))selectedDay=TRIP.start;}await store.put('meta',{id:'trip-config',value:{...TRIP}});}catch(error){if(error.message!=='ACCESS_UNAVAILABLE')pinScreen.reverify=true;}}
 await render();calendarRefresh=new CalendarRefresh({refresh:syncAll,lastSync:async()=>(await store.get('meta','calendar-sync'))?.synced_at,available:async()=>navigator.onLine&&!!store.activeUser?.authorized});calendarRefresh.start();if(store.activeUser?.authorized&&navigator.onLine)calendarRefresh.request({force:true}).catch(()=>{});
 setInterval(()=>{if(document.visibilityState==='visible'&&store.activeUser?.authorized)refreshDeviceIdentity().then(()=>refreshBackground()).catch(()=>{});scheduleSync();},30000);
 addEventListener('online',()=>refreshDeviceIdentity().then(()=>{if(store.activeUser?.authorized)calendarRefresh.request({force:true}).catch(()=>{});return refreshBackground();}));return;
}

client = createClient('https://cslludzuejkhsydqiabx.supabase.co', 'sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U', { auth: { storageKey: 'av2.auth',storage:googleSafeStorage(localStorage), flowType:'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
// Network/auth startup runs only after the local view is rendered.
client.auth.onAuthStateChange((event,session)=>{if(googleAuthorization)setTimeout(async()=>{try{authSession=session;await refreshDeviceIdentity();await googleAuthorization.capture(event,session);await refreshBackground();if(event==='SIGNED_IN'&&session?.provider_token)await calendarRefresh?.request({force:true});}catch(error){notice(error.message);}},0);else pendingGoogleAuth.push({event,session});});
remote = new SupabaseRemote(client, store.device,store.deviceToken);
devices=new Devices(remote);
const providerBackend=new GoogleProviderBackend(client,()=>remote.credentials());
const locationCache=new LocationCache(async inputs=>(await providerBackend.call('resolve_locations',{inputs,details:true})).locations);
googleAuthorization=new GoogleAuthorization(store,providerBackend,state=>{googleState=state;const node=document.querySelector('#connection');if(state==='refreshing')node.textContent='Renovando conexión…';});
authSession=(await client.auth.getSession()).data.session;
await refreshDeviceIdentity();
await googleAuthorization.capture('INITIAL_SESSION',authSession);
for(const {event,session}of pendingGoogleAuth)await googleAuthorization.capture(event,session);
google = new GoogleSource(()=>googleAuthorization.token(),fetch,()=>remote.check(),token=>googleAuthorization.recover(token),local=>locationCache.refresh(local),async()=>(await providerBackend.call("event_cities")).rows);
sync = new SyncEngine(store, remote, google);

if(['127.0.0.1','localhost'].includes(location.hostname)&&navigator.onLine){try{const response=await fetch('./root-claim',{cache:'no-store'});if(response.ok)rootClaim=await response.json();}catch{/* Claims are available only on PC Casa's local preview. */}}
await refreshBackground();
calendarRefresh=new CalendarRefresh({refresh:syncAll,lastSync:async()=>(await store.get('meta','calendar-sync'))?.synced_at,available:async()=>navigator.onLine&&!!(await client.auth.getSession()).data.session&&!!(await store.get('meta','authorized'))?.value});
calendarRefresh.start();
if (navigator.onLine && (await client.auth.getSession()).data.session) {if(!(await store.get('meta','authorized'))?.value){await refreshBackground();}else calendarRefresh.request({force:true}).catch(error=>notice(error.message));}
addEventListener('online',()=>refreshDeviceIdentity().then(()=>refreshBackground()).catch(()=>{}));
addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&store.activeUser?.authorized)refreshDeviceIdentity().then(()=>refreshBackground()).catch(()=>{});});
setInterval(()=>{refreshDeviceIdentity().then(()=>refreshBackground()).catch(()=>{});scheduleSync();},30000);
refreshRates().then(()=>refreshBackground()).catch(()=>{});

}
remoteStartup=new Promise((resolve,reject)=>setTimeout(()=>startRemote().then(resolve,reject),0));
remoteStartup.catch(()=>{calendarStatus='error';updateConnection();});

document.addEventListener('keydown',event=>{if(event.target.matches('circle[data-action="budget-slice"]')&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
