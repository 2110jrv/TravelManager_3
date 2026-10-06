import { createClient } from '../vendor/supabase-client.mjs';
import { TRIP } from './config.js';
import { dateKey, occursOn, days, finance, normalizeEvent } from './domain.js';
import { LocalStore } from './store.js';
import { GoogleSource } from './google.js';
import { GoogleAuthorization } from './google-auth.js';
import { SupabaseRemote, SyncEngine } from './sync.js';
import {Devices} from './devices.js';
import {expenseSnapshots,ReferenceRates,FrankfurterProvider,calendarFxId} from './fx.js';
import qrcode from '../vendor/qrcode-generator.mjs';

let googleAuthorization=null;const pendingGoogleAuth=[];
const client = createClient('https://cslludzuejkhsydqiabx.supabase.co', 'sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U', { auth: { storageKey: 'av2.auth', flowType:'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
// Subscribe before opening IndexedDB: PKCE can finish during database startup.
client.auth.onAuthStateChange((event,session)=>{if(googleAuthorization)setTimeout(()=>googleAuthorization.capture(event,session).catch(error=>notice(error.message)),0);else pendingGoogleAuth.push({event,session});});
const store = await new LocalStore().open();
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
const remote = new SupabaseRemote(client, store.device,store.deviceToken);
const devices=new Devices(remote);
googleAuthorization=new GoogleAuthorization(store);
await googleAuthorization.capture('INITIAL_SESSION',(await client.auth.getSession()).data.session);
for(const {event,session}of pendingGoogleAuth)await googleAuthorization.capture(event,session);
const google = new GoogleSource(()=>googleAuthorization.token(),fetch,()=>remote.check(),()=>googleAuthorization.invalidate());
const sync = new SyncEngine(store, remote, google);
const app = document.querySelector('#app');
let rootClaim=null;
if(['127.0.0.1','localhost'].includes(location.hostname)&&navigator.onLine){try{const response=await fetch('./root-claim',{cache:'no-store'});if(response.ok)rootClaim=await response.json();}catch{/* Claims are available only on PC Casa's local preview. */}}
let selectedDay = days().includes(dateKey()) ? dateKey() : TRIP.start;
let documents = (await store.get('meta', 'drive-files'))?.value || [];
let events = [], records = [], pending = [], conflicts = [], now = new Date();
let installPrompt;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = value => new Intl.NumberFormat('es', { style: 'currency', currency: TRIP.currency }).format(value || 0);
const localDate=(value=new Date())=>dateKey(value,Intl.DateTimeFormat().resolvedOptions().timeZone);
const formatDay = day => new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const active = kind => records.filter(x => x.kind === kind && !x.deleted_at);
const eventTime = event => event.allDay ? 'Todo el día' : event.timezone?new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: event.timezone }).format(new Date(event.start)):event.start?.slice(11,16)||'—';
const button = (action, text, id = '', style = 'secondary') => `<button class="${style}" data-action="${action}" data-id="${escape(id)}">${text}</button>`;
function notice(message) { const friendly={AV2_DEVICE_ENROLLMENT_REQUIRED:'Esta instalación requiere una invitación o activar PC Casa.',AV2_DEVICE_REVOKED:'Este dispositivo fue revocado. Se invalidaron los datos locales.',AV2_ADMIN_PROOF_INVALID:'La clave administrativa no es válida.',AV2_INVITE_ALREADY_USED:'La invitación ya fue utilizada.',AV2_INVITE_INVALID_OR_EXPIRED:'La invitación venció o no es válida.',AV2_ADMIN_KEY_NOT_CONFIGURED:'Configura la clave administrativa desde PC Casa.',AV2_ADMIN_RATE_LIMIT:'Demasiados intentos. Espera diez minutos antes de intentar otra vez.'};const node = document.querySelector('#notice'); node.textContent = Object.entries(friendly).find(([code])=>String(message).includes(code))?.[1]||message; node.hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => { node.hidden = true; }, 6500); }
function summary() {const snapshots=active('app_settings').filter(r=>r.data.type==='calendar_fx');return finance(events.filter(x=>days().some(day=>occursOn(x,day))).map(e=>{const snapshot=snapshots.find(r=>r.data.event_id===e.id&&r.data.snapshot?.amount_original===e.cost&&r.data.snapshot?.currency_original===e.currency)?.data.snapshot;return snapshot&&e.cost_status==='PAID'?{...e,...snapshot}:e;}),active('expenses'),active('budgets')[0]?.data.amount??null,referenceRates);}
const currencyMoney=(amount,currency)=>new Intl.NumberFormat('es',{style:'currency',currency}).format(amount);
function stats(view='USD') {const f=summary();const content=view==='original'?`<div class="currency-table"><table><thead><tr><th>Moneda</th><th>Pagado real</th><th>Estimado pendiente</th><th>Total proyectado</th></tr></thead><tbody>${[...new Set(['USD','EUR','CHF',...Object.keys(f.by_currency)])].map(currency=>{const t=f.by_currency[currency]||{paid:0,estimated:0,projected:0};return`<tr><th>${currency}</th><td>${currencyMoney(t.paid,currency)}</td><td>${currencyMoney(t.estimated,currency)}</td><td>${currencyMoney(t.projected,currency)}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="grid"><div class="card stat"><span>Pagado real</span><strong>${money(f.paid)}</strong></div><div class="card stat"><span>Estimado pendiente</span><strong>${money(f.estimated)}</strong></div><div class="card stat highlight"><span>Total proyectado</span><strong>${money(f.projected)}</strong></div></div>`;return content+(f.missing.length?`<p class="warning">${f.missing.length} importe(s) sin equivalente USD. La proyección consolidada es parcial; los importes originales están conservados.</p>`:'');}
function eventCard(event) {
  const past = event.end && new Date(event.allDay ? `${event.end}T00:00:00` : event.end) < now;
  return `<a class="event ${past ? 'past' : ''}" href="#event/${encodeURIComponent(event.id)}"><span class="event-time">${escape(eventTime(event))}</span><div class="event-body"><h3>${escape(event.title)}</h3><p>${escape(event.location || 'Ubicación por confirmar')}</p>${event.label ? `<span class="badge">${escape(event.label.name || `Label ${event.label.id}`)}</span>` : ''}${event.cost_status ? `<span class="badge ${event.cost_status === 'PAID' ? 'paid' : 'pending'}">${event.cost_status === 'PAID' ? 'Pagado' : 'Estimado'} · ${escape(event.currency || 'Moneda pendiente')} ${escape(event.cost ?? '—')}</span>` : ''}${event.allDay && event.end > event.start ? '<span class="badge">Disponible durante su vigencia</span>' : ''}</div><span aria-hidden="true">›</span></a>`;
}
function eventList(list) { return list.length ? `<div class="events">${list.sort((a, b) => a.start.localeCompare(b.start)).map(eventCard).join('')}</div>` : '<div class="empty">No hay eventos de Calendar para este día. Conecta Google y sincroniza tu itinerario real.</div>'; }
function home() {
  const today = localDate(now), before = today < TRIP.start, after = today > TRIP.end, f = summary();
  const countdown = Math.ceil((Date.parse(`${TRIP.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const day = before ? TRIP.start : today;
  const dayEvents = events.filter(x => occursOn(x, day));
  const next = dayEvents.find(x => x.allDay || new Date(x.end) > now);
  const expensesToday = active('expenses').filter(x => x.data.date === today);
  const todayFinance = finance([], expensesToday);
  return `<section class="hero"><span class="eyebrow">Jonathan + Jenny · 20 oct — 5 nov</span><h1>Italia 2026</h1><p>${before ? `La aventura todavía no comienza.<br>Faltan ${countdown} días para partir.` : after ? 'Viaje completado. Cada recuerdo, en un lugar.' : `HOY · ${escape(formatDay(today))}`}</p><span class="badge">${before ? 'Preparando el viaje' : after ? 'Viaje completado' : escape(next?.location || 'En viaje')}</span></section>
    <div class="row"><h2>${after ? 'El viaje en números' : 'Tu viaje, en equilibrio'}</h2><a class="primary" href="#expense/new">+ Gasto</a></div>${stats()}
    ${after ? `<section class="card section"><h3>Costo final registrado: ${money(f.paid)}</h3><p>Presupuesto inicial: ${f.budget == null ? 'Sin configurar' : money(f.budget)} · Diferencia: ${f.budget == null ? '—' : money(f.budget - f.paid)}</p><p>${active('expenses').length} gastos · ${events.filter(x => !x.deleted_at).length} eventos sincronizados</p>${f.estimated ? '<p class="warning">Quedan importes estimados por conciliar antes de cerrar el costo final.</p>' : ''}</section>` : `<section class="section"><div class="row"><h2>${before ? 'Tu primer día en Italia' : 'Tu agenda de hoy'}</h2><a href="#itinerary" class="muted">Ver itinerario ›</a></div><p class="subtitle">${escape(formatDay(day))}${before ? '' : ` · Gastos de hoy: ${money(todayFinance.paid)}`}</p>${eventList(dayEvents)}</section>`}
    <section class="card section"><span class="eyebrow">Antes de salir</span><h3 style="margin-top:12px">Todo a mano, incluso sin conexión</h3><p class="muted">Prepara tu itinerario y documentos importantes para llevarlos contigo.</p><a class="secondary" href="#offline">Preparar offline ↗</a></section>
    <section class="section"><h2>Pendientes importantes</h2>${eventList(events.filter(x => !x.deleted_at && (x.purchase_status === 'PENDING' || x.cost_status === 'ESTIMATED')).slice(0, 4))}</section>`;
}
function itinerary() {
  return `<span class="eyebrow">Italia 2026</span><h1>Un día a la vez.</h1><p class="subtitle">Tu itinerario desde Italy Vacation · Google Calendar</p><div class="day-strip">${days().map(day => `<button data-action="day" data-id="${day}" class="${day === selectedDay ? 'active' : ''}">${new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}<strong>${day.slice(8)}</strong></button>`).join('')}</div><h2>${escape(formatDay(selectedDay))}</h2>${eventList(events.filter(x => occursOn(x, selectedDay)))}`;
}
function detail(id) {
  const event = events.find(x => x.id === id && !x.deleted_at); if (!event) return '<div class="empty">Este evento no está disponible en la cache de Calendar.</div>';
  const links = active('document_links').filter(x => x.data.calendar_event_id === id);
  return `<div class="detail"><a class="back" href="#itinerary">‹ Volver al itinerario</a><span class="eyebrow">${escape(event.label?.name || 'Google Calendar')}</span><h1>${escape(event.title)}</h1><p class="subtitle">${escape(event.start)} — ${escape(event.end)} · ${escape(event.timezone)}</p><section class="card"><h3>${escape(event.location || 'Ubicación por confirmar')}</h3>${event.location ? `<a class="secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location)}">Navegar ↗</a>` : ''}<p>${event.cost_status ? `${event.cost_status === 'PAID' ? 'Precio real pagado' : 'Precio estimado pendiente'}: ${escape(event.cost)} ${escape(event.currency)}` : 'Estado financiero sin especificar en Calendar.'}</p><p class="description">${escape(event.description)}</p></section><section class="section"><h2>Documentos y boletos</h2>${links.map(link => `<div class="card list-row row"><a href="#document/${encodeURIComponent(link.data.drive_file_id)}">${escape(documents.find(x => x.id === link.data.drive_file_id)?.name || link.data.drive_file_id)}</a>${button('unlink', 'Desvincular', link.id)}</div>`).join('') || '<p class="muted">Sin documentos vinculados.</p>'}<div class="actions">${button('load-documents', 'Consultar archivos Drive')} ${button('link-document', 'Adjuntar / Vincular documento', id)}</div></section><p class="muted">Calendar es la fuente maestra. Los cambios locales no modifican Google Calendar.</p></div>`;
}
function budget() {
  const f=summary();return `<span class="eyebrow">USD · Moneda base</span><div class="row"><h1>Presupuesto</h1><a class="primary" href="#expense/new">+ Gasto</a></div><p class="subtitle">Pagado real + estimado pendiente = total proyectado</p><div class="segmented" aria-label="Vista del presupuesto"><button data-action="finance-view" data-id="USD" aria-pressed="${financeView==='USD'}">USD consolidado</button><button data-action="finance-view" data-id="original" aria-pressed="${financeView==='original'}">Monedas originales</button></div>${stats(financeView)}<section class="card section"><div class="row"><div><span class="eyebrow">Presupuesto configurado · USD</span><h2>${f.budget===null?'Por definir':money(f.budget)}</h2></div>${button('budget','Configurar presupuesto')}</div><p><strong>Disponible proyectado: ${f.difference===null?'Por definir':money(f.difference)}</strong>${f.missing.length?' · parcial':''}</p>${f.budget>0?`<progress max="${f.budget}" value="${Math.min(f.projected,f.budget)}"></progress>`:''}</section><section class="card section"><div class="row"><h2>Tasas de referencia</h2>${button('refresh-fx','Actualizar tasas')}</div><p class="muted">Los estimados usan la referencia vigente. Los pagos conservan su tasa; el cargo real USD tiene prioridad.</p>${Object.entries(referenceRates).filter(([currency])=>currency!=='USD').map(([currency,rate])=>`<p><strong>1 ${escape(currency)} = ${rate?escape(rate.rate.toFixed(6))+' USD':'sin tasa disponible'}</strong>${rate?`<br><small>${escape(rate.source)} · ${escape(rate.rate_date)} · ${rate.cached?'Caché':'Referencia'}${rate.stale?' · desactualizada':''}</small>`:''}</p>`).join('')||'<p class="muted">No hay tasas disponibles todavía. Tus importes originales permanecen guardados.</p>'}</section><section class="section"><div class="row"><h2>Gastos manuales</h2><a href="#expenses" class="muted">Ver todos ›</a></div>${expenseList()}</section>`;
}
function expenseList() { return active('expenses').map(x => `<div class="card list-row row"><div><h3>${escape(x.data.description)}</h3><small>${escape(x.data.date)} · ${escape(x.data.category)} · ${escape(x.data.cost_status)}</small></div><a href="#expense/${x.id}">${escape(x.data.amount)} ${escape(x.data.currency)} ›</a></div>`).join('') || '<div class="empty">Aún no hay gastos manuales. Registra uno y tu presupuesto se actualiza inmediatamente.</div>'; }
function expenseForm(id) {
  const record = active('expenses').find(x => x.id === id), d = record?.data || {};
  expenseForm.base=record?structuredClone(record):null;
  return `<a class="back" href="#budget">‹ Presupuesto</a><h1>${record ? 'Editar gasto' : 'Nuevo gasto'}</h1><p class="subtitle">Se guarda en este dispositivo, incluso sin conexión.</p><form id="expense-form" class="card detail" data-id="${escape(record?.id || '')}"><label>Descripción<input name="description" required maxlength="200" value="${escape(d.description)}"></label><div class="form-grid"><label>Importe original<input name="amount" type="number" min="0" step="any" required value="${escape(d.amount)}"></label><label>Moneda ISO<input name="currency" required pattern="[A-Z]{3}" maxlength="3" value="${escape(d.currency || 'USD')}" list="currencies"><datalist id="currencies"><option>USD</option><option>EUR</option><option>CHF</option></datalist></label><label>Estado<select name="cost_status"><option value="PAID" ${d.cost_status === 'PAID' ? 'selected' : ''}>Pagado real</option><option value="ESTIMATED" ${d.cost_status === 'ESTIMATED' ? 'selected' : ''}>Estimado pendiente</option></select></label><label>Fecha<input name="date" type="date" required value="${escape(d.date || localDate())}"></label><label>Categoría<input name="category" value="${escape(d.category || 'Otros')}" required></label><label>Persona<select name="person"><option value="">Sin especificar</option>${TRIP.travelers.map(person => `<option ${d.person === person ? 'selected' : ''}>${person}</option>`).join('')}</select></label><label>Tasa a USD por unidad (opcional)<input name="exchange_rate" type="number" min="0.000001" step="any" value="${escape(d.exchange_rate)}"></label><label>Cargo real en USD (opcional)<input name="actual_base_amount" type="number" min="0" step="0.01" value="${escape(d.actual_base_amount)}"></label><label>Ubicación (opcional)<input name="location" value="${escape(d.location)}"></label></div><label>Notas<textarea name="notes">${escape(d.notes)}</textarea></label><label>Foto o archivo de recibo<input name="receipt" type="file" accept="image/*,application/pdf" capture="environment"></label>${d.receipt_local_id ? `<p class="muted">Recibo guardado ${d.receipt_drive_id ? 'en Drive' : 'localmente; pendiente de subir'}. ${button('remove-receipt', 'Quitar recibo del gasto', record.id)}</p>` : ''}<div class="actions"><button type="submit" class="primary">Guardar gasto</button>${record ? button('delete-expense', 'Eliminar gasto', record.id, 'danger') : ''}</div></form>`;
}
function settings() {
  return `<span class="eyebrow">Tu viaje, conectado</span><h1>Más y ajustes</h1><section class="card"><h3>Google Calendar + Drive</h3><p class="muted">Autoriza tu cuenta con acceso a Italy Vacation y a la carpeta privada del viaje.</p><div class="actions">${button('google', 'Conectar Google', '', 'primary')}${button('sync', 'Sincronizar ahora')}${button('install', 'Instalar aplicación')}</div><p class="muted">${pending.length} cambios pendientes · ${conflicts.length} conflictos locales</p></section><section class="card section">${[['devices','Dispositivos'],['documents','Documentos y boletos'],['offline','Preparar offline'],['sync','Sincronización'],['conflicts','Resolver conflictos']].map(([route, text]) => `<a class="list-row row" href="#${route}">${text}<span>›</span></a>`).join('')}</section><section class="card"><h3>Este dispositivo</h3><p class="muted">Identidad independiente: ${escape(store.device)}</p><p class="muted">Italia 2026 · Jonathan + Jenny · USD</p></section>`;
}
function requestValue(label,type='text',value=''){
 return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>${escape(label)}</h2><label>${escape(label)}<input type="${type}" value="${escape(value)}" autocomplete="${type==='password'?'off':'on'}" required maxlength="100" ${type==='password'?'minlength="8"':''}></label><div class="actions"><button value="cancel" formnovalidate class="secondary">Cancelar</button><button value="ok" class="primary">Continuar</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok'?dialog.querySelector('input').value:null;dialog.querySelector('input').value='';dialog.remove();resolve(result);},{once:true});});
}
async function deviceScreen(){
 const session=(await client.auth.getSession()).data.session,invite=await store.get('meta','pending-invite');
 let list=[];if(session)try{list=await devices.list();await store.put('meta',{id:'device-list',value:list});}catch{list=(await store.get('meta','device-list'))?.value||[];}
 const own=list.find(x=>x.id===store.device&&!x.deleted_at);deviceScreen.root=own?.role==='ROOT_DEVICE';
 return `<span class="eyebrow">Cada instalación, independiente</span><h1>Dispositivos</h1><p class="subtitle">4 celulares + PC Casa · Italia 2026</p>${!session?`<section class="card"><p>Conecta tu cuenta Google para autorizar esta instalación.</p>${button('google','Conectar Google','','primary')}</section>`:''}${!own&&session?`<section class="card"><h3>Autorizar este dispositivo</h3><p class="muted">Usa el enlace/QR temporal generado por PC Casa.</p>${invite?button('enroll','Registrar este teléfono','','primary'):''}${rootClaim&&new Date(rootClaim.expires_at)>new Date()?button('claim-root','Activar PC Casa','','primary'):''}</section>`:''}${own?`<div class="actions">${button('invite','Agregar dispositivo','','primary')}${button('rename-device','Nombrar esta instalación')}${deviceScreen.root?'<a class="secondary" href="#security">Seguridad</a>':button('remove-self','Quitar este dispositivo','', 'danger')}</div>`:''}<section class="section">${list.map(d=>`<div class="card list-row row"><div><h3>${escape(d.name)}</h3><small>${d.role==='ROOT_DEVICE'?'PC protegida':d.deleted_at?'Revocado':d.id===store.device?'Esta instalación':'Autorizado'}</small></div>${!d.deleted_at&&d.role!=='ROOT_DEVICE'&&d.id!==store.device?button('revoke-device','Revocar',d.id,'danger'):''}</div>`).join('')}</section>`;
}
async function securityScreen(){
  const list=await devices.list();const own=list.find(d=>d.id===store.device&&!d.deleted_at);
  if(own?.role!=='ROOT_DEVICE')return '<a class="back" href="#devices">‹ Dispositivos</a><h1>Seguridad</h1><section class="card"><p>La clave se solicita solo al administrar dispositivos. Ver dispositivos no requiere clave.</p><p>Para crear o cambiar la clave administrativa, usa PC Casa.</p></section>';
  const configured=await devices.adminConfigured();securityScreen.configured=configured;
  return `<a class="back" href="#devices">‹ Dispositivos</a><span class="eyebrow">PC Casa · ROOT protegido</span><h1>Seguridad</h1><section class="card detail"><h2>${configured?'Cambiar clave administrativa':'Crear clave administrativa'}</h2><p class="muted">Los celulares usarán esta clave únicamente para administrar dispositivos. PC Casa administra sin PIN y ningún celular puede revocarla.</p><form id="security-form">${configured?'<label>Clave actual<input name="current" type="password" autocomplete="current-password" required minlength="8" maxlength="100"></label>':''}<label>Nueva clave administrativa<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label><label>Confirmar nueva clave<input name="confirmation" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label><p class="muted">Usa al menos 8 caracteres. La clave se guarda como una derivación fuerte con salt; no se guarda en este dispositivo.</p><button type="submit" class="primary">${configured?'Cambiar clave administrativa':'Crear clave administrativa'}</button><p id="security-result" role="status"></p></form></section>`;
}
async function offline() {
  const calendar = await store.get('meta', 'calendar-sync'), last = await store.get('meta', 'last-sync');
  const selected = documents.filter(x => x.offline);
  const cached = await Promise.all(selected.map(x => store.get('blobs', `drive:${x.id}`)));
  const checks = [['Itinerario real de Calendar', calendar?.source==='google-api'], ['Presupuesto y gastos sincronizados', !!last&&pending.length===0&&conflicts.length===0], ['Presupuesto configurado', active('budgets').length > 0], ['Documentos y boletos seleccionados', selected.length > 0 && cached.every(Boolean)], ['Shell offline', !!navigator.serviceWorker?.controller]];
  const ready = checks.filter(([name])=>name!=='Presupuesto configurado').every(x => x[1]);
  return `<h1>Preparar offline</h1><p class="subtitle">Lleva lo esencial contigo.</p><section class="card">${checks.map(([name, ok]) => `<div class="offline-check"><span>${name}</span><strong>${ok ? '✓' : 'Pendiente'}</strong></div>`).join('')}<div class="actions">${button('prepare-offline', 'Verificar y descargar', '', 'primary')}<a class="secondary" href="#documents">Seleccionar documentos</a></div><p class="${ready ? 'badge paid' : 'warning'}">${ready ? 'Italia 2026 listo para usar offline' : 'Preparación incompleta. Sincroniza y descarga tus documentos seleccionados.'}</p></section>`;
}
function documentList() { return `<div class="row"><h1>Documentos</h1>${button('load-documents', 'Actualizar Drive')}</div><p class="subtitle">Archivos privados del viaje · disponibles con autorización Google</p>${documents.map(file => `<div class="card list-row row"><a href="#document/${encodeURIComponent(file.id)}"><h3>${escape(file.name)}</h3><small>${file.offline ? 'Seleccionado para offline' : escape(file.mimeType)}</small></a>${button('offline-document', file.offline ? 'Quitar selección offline' : 'Disponible offline', file.id)}</div>`).join('') || '<div class="empty">Consulta Drive para seleccionar los documentos reales del viaje.</div>'}`; }
async function render() {
  now = new Date(); [events, records, pending, conflicts] = await Promise.all(['events','records','outbox','conflicts'].map(name => store.all(name)));
  const [route, rawId] = (location.hash.slice(1) || 'home').split('/'), id = decodeURIComponent(rawId || '');
  if(route==='devices'){app.innerHTML=await deviceScreen();return;}
  if(route==='security'){try{app.innerHTML=await securityScreen();}catch{app.innerHTML='<a class="back" href="#devices">‹ Dispositivos</a><h1>Seguridad</h1><p class="warning">Conéctate para consultar o cambiar la configuración de seguridad.</p>';}return;}
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.hash === `#${route}`));
  document.querySelector('#connection').textContent = navigator.onLine ? pending.length ? `${pending.length} pendientes` : 'En línea' : 'Sin conexión';
  if (route === 'home') app.innerHTML = home(); else if (route === 'itinerary') app.innerHTML = itinerary(); else if (route === 'event') app.innerHTML = detail(id); else if (route === 'budget') app.innerHTML = budget(); else if (route === 'expense') app.innerHTML = expenseForm(id); else if (route === 'expenses') app.innerHTML = `<div class="row"><h1>Gastos</h1><a class="primary" href="#expense/new">+ Gasto</a></div>${expenseList()}`; else if (route === 'documents') app.innerHTML = documentList(); else if (route === 'offline') app.innerHTML = await offline(); else if (route === 'sync') app.innerHTML = `<h1>Sincronización</h1><section class="card"><p>${pending.length} cambios pendientes · ${conflicts.length} conflictos</p><p class="muted">Última sincronización: ${escape((await store.get('meta','last-sync'))?.value || 'Todavía no realizada')}</p>${button('sync','Sincronizar ahora','','primary')}</section>`; else if (route === 'conflicts') app.innerHTML = `<h1>Resolver conflictos</h1>${conflicts.map(c => `<section class="card section"><h3>${escape(c.field)}</h3><p>Servidor: ${escape(JSON.stringify(c.current))}</p><p>Este dispositivo: ${escape(JSON.stringify(c.incoming))}</p>${button('resolve-current','Conservar servidor',c.id)} ${c.field !== 'deleted_at' ? button('resolve-incoming','Usar valor local',c.id) : '<p class="warning">El registro eliminado no puede resucitarse. Ambos valores se conservan para revisión.</p>'}</section>`).join('') || '<div class="empty">No hay conflictos pendientes.</div>'}`; else if (route === 'document') {
    const file = documents.find(x => x.id === id), cached = await store.get('blobs', `drive:${id}`);
    if (render.objectUrl) URL.revokeObjectURL(render.objectUrl);
    render.objectUrl = cached ? URL.createObjectURL(cached.blob) : null;
    app.innerHTML = `<a class="back" href="#documents">‹ Documentos</a><h1>${escape(file?.name || 'Documento')}</h1>${cached ? `<a class="primary" href="${render.objectUrl}" download="${escape(file?.name || 'documento')}">Abrir archivo offline</a>${['application/pdf','image/png','image/jpeg','image/webp'].includes(cached.blob.type) ? `<iframe title="Documento offline" sandbox src="${render.objectUrl}"></iframe>` : ''}` : '<p class="muted">Sin copia offline en este dispositivo.</p>'}${file ? `<div class="actions">${button('download-document','Descargar copia offline',file.id)}<a class="secondary" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view">Abrir en Google Drive ↗</a></div>` : ''}`;
  } else app.innerHTML = settings();
  if(route==='event'){const warnings=events.find(x=>x.id===id)?.warnings||[];if(warnings.length)app.insertAdjacentHTML('beforeend',`<p class="warning">${warnings.map(escape).join('<br>')}</p>`);}
  if(route==='document'&&documents.some(x=>x.id===id))app.insertAdjacentHTML('beforeend',`<div class="actions">${button('trash-document','Enviar archivo a la papelera de Google Drive',id,'danger')}</div>`);
}
async function syncAll() {
  if (!navigator.onLine) throw Error('Sin conexión. Tus cambios siguen guardados localmente.');
  try{await sync.run();financialRemoteReady=true; await remote.check(); await google.syncCalendar(store);await loadDocuments();await refreshRates();}catch(error){if(error.message.includes('AV2_DEVICE_REVOKED')){financialRemoteReady=false;await store.purge();await client.auth.signOut();documents=[];await render();}throw error;}finally{await refreshBackground();}
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
app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault(); target.disabled = true;
  const { action, id } = target.dataset;
  try {
    if (action === 'day') selectedDay = id;
    else if (action === 'google') { const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}`, scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendars.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly' } }); if (error) throw error; }
    else if(action==='claim-root'){await devices.claimRoot(rootClaim?.token);rootClaim=null;await store.put('meta',{id:'authorized',value:true});await syncAll();}
    else if(action==='enroll'){const name=await requestValue('Nombre del teléfono','text','Jonathan S26 Ultra');if(name){await devices.enroll((await store.get('meta','pending-invite'))?.value,name);await store.transaction(['meta'],tx=>tx.objectStore('meta').delete('pending-invite'));await store.put('meta',{id:'authorized',value:true});location.hash='#home';await syncAll();notice('Dispositivo autorizado. Puedes instalar la PWA y preparar offline.');}}
    else if(action==='rename-device'){const name=await requestValue('Nombre de esta instalación');if(name)await devices.rename(name);}
    else if(action==='finance-view'){financeView=id==='original'?'original':'USD';await store.put('meta',{id:'finance-view',value:financeView});}
    else if(action==='refresh-fx'){await refreshRates(true);notice('Referencias actualizadas; los pagos conservan su snapshot.');}
    else if(action==='invite'){
      const password=deviceScreen.root?null:await requestValue('Clave administrativa','password');if(!deviceScreen.root&&!password)return;
      const invite=await devices.invite(password),url=`${location.origin}${location.pathname}#invite/${invite.token}`;
      const qr=qrcode(0,'M');qr.addData(url);qr.make();const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>Agregar dispositivo</h2><p>Un solo uso · válido hasta ${escape(new Date(invite.expires_at).toLocaleTimeString())}</p>${qr.createSvgTag(4,4)}<label>Enlace temporal<input readonly value="${escape(url)}"></label><button class="primary">Cerrar</button></form>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    }
    else if(action==='revoke-device'){if(confirm('¿Revocar este teléfono? Al reconectarse perderá acceso y se invalidarán sus datos locales.')){const password=deviceScreen.root?null:await requestValue('Clave administrativa','password');if(deviceScreen.root||password)await devices.revoke(id,password);}}
    else if(action==='remove-self'){if(confirm('¿Quitar esta instalación y eliminar sus datos locales?')){await devices.revoke(store.device,null,true);await store.purge();await client.auth.signOut();location.reload();}}
    else if (action === 'sync') { await syncAll(); notice('Sincronización completada.'); }
    else if (action === 'budget') {
      const value=await new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML=`<form method="dialog"><h2>Presupuesto del viaje</h2><label>Presupuesto en USD<input type="number" min="0" step="0.01" required value="${escape(active('budgets')[0]?.data.amount??'')}"></label><div class="actions"><button value="cancel" class="secondary" formnovalidate>Cancelar</button><button value="save" class="primary">Guardar presupuesto</button></div></form>`;document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='save'?Number(dialog.querySelector('input').value):null);dialog.remove();},{once:true});});
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
    else if (action === 'download-document') { await remote.check(); const file = documents.find(x => x.id === id); await store.put('blobs', { id: `drive:${id}`, blob: await google.download(file) }); }
    else if (action === 'prepare-offline') { await syncAll(); for (const file of documents.filter(x => x.offline)) { await remote.check(); await store.put('blobs', { id: `drive:${file.id}`, blob: await google.download(file) }); } }
    else if (action.startsWith('resolve-')) {
      const c = conflicts.find(x => x.id === id); if (c.resolving) throw Error('La resolución está pendiente de sincronizar.');
      await store.resolve(c, action === 'resolve-incoming' ? 'incoming' : 'current'); notice('Resolución guardada; pendiente de sincronizar.');
    } else if (action === 'install') { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; } else notice('Usa el menú del navegador: Instalar aplicación o Añadir a pantalla de inicio.'); }
    await render();scheduleSync();
  } catch (error) { notice(error.message); await render(); }
  finally { target.disabled = false; }
});
app.addEventListener('submit', async event => {
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
    const receipt = values.get('receipt'); let blob = null;
    if (receipt?.size) { data.receipt_local_id = crypto.randomUUID(); data.receipt_name = receipt.name; data.receipt_drive_id = null; blob = { id: data.receipt_local_id, value: receipt }; }
    await store.mutate('expenses', form.dataset.id || crypto.randomUUID(), data, false, blob,expenseForm.base);
    location.hash = '#expenses'; notice('Gasto guardado en este dispositivo.');scheduleSync();
  } catch (error) { notice(error.message); } finally { submit.disabled = false; }
});
addEventListener('hashchange', () => render().catch(error => notice(error.message)));
addEventListener('online', () => syncAll().catch(error => notice(error.message)));
addEventListener('offline', () => refreshRates().then(()=>refreshBackground()).catch(()=>refreshBackground()));
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
async function refreshBackground(){if(location.hash.startsWith('#expense/')||location.hash==='#security'){document.querySelector('#connection').textContent=navigator.onLine?'En línea':'Sin conexión';return;}await render();}
function scheduleSync(){clearTimeout(scheduleSync.timer);scheduleSync.timer=setTimeout(async()=>{if(navigator.onLine&&(await store.get('meta','authorized'))?.value){try{await sync.run();await refreshBackground();}catch(error){notice(error.message);if(error.message.includes('AV2_DEVICE_REVOKED'))await render();else await refreshBackground();}}},1000);}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  const showUpdate = () => { const update = document.querySelector('#update'); update.hidden = false; update.onclick = () => registration.waiting?.postMessage('ACTIVATE_UPDATE'); };
  if (registration.waiting) showUpdate();
  registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', () => { if (registration.waiting && navigator.serviceWorker.controller) showUpdate(); }); });
  let changing = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || changing) return; changing = true; location.reload(); });
}
await render();
setInterval(() => { if ((location.hash || '#home') === '#home') render().catch(error => notice(error.message)); }, 60000);
if (navigator.onLine && (await client.auth.getSession()).data.session) {if(!(await store.get('meta','authorized'))?.value){location.hash='#devices';await render();}else syncAll().catch(error => notice(error.message));}
setInterval(scheduleSync,30000);
refreshRates().then(()=>refreshBackground()).catch(()=>{});
