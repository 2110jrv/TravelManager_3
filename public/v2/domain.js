import { TRIP } from './config.js';
export function normalizeEvent(raw, colors = {}, labels = {}) {
  const block = /\[AGENDA_VIAJERA\]([\s\S]*?)\[\/AGENDA_VIAJERA\]/.exec(raw.description || '');
  const fields = Object.fromEntries([...(block?.[1] || '').matchAll(/\b(COST|CURRENCY|COST_STATUS|PURCHASE_ID)\s*=\s*([^\s]+)/g)].map(match => [match[1], match[2]]));
  const parsedCost = fields.COST !== undefined && /^\d+(\.\d+)?$/.test(fields.COST) ? Number(fields.COST) : null;
  const cost=Number.isFinite(parsedCost)?parsedCost:null;
  const currency = validCurrency(fields.CURRENCY) ? fields.CURRENCY : null;
  const status = ['PAID', 'ESTIMATED'].includes(fields.COST_STATUS) ? fields.COST_STATUS : null;
  const labelId = raw.eventLabelId || raw.event_label_id || null;
  const warnings=[];
  const valid=!!block && cost!==null && Number.isFinite(cost) && currency!==null && status!==null;
  if(block && !valid) warnings.push('Bloque financiero inválido; no se incluye en el presupuesto.');
  if(!block && /\[\/?AGENDA_VIAJERA\]/.test(raw.description||''))warnings.push('Bloque financiero incompleto; no se incluye en el presupuesto.');
  const purchase=/^\s*✅/.test(raw.summary||'')?'PAID':/^\s*☐/.test(raw.summary||'')?'PENDING':null;
  if(valid && ((purchase==='PAID'&&status==='ESTIMATED') || (purchase==='PENDING'&&status==='PAID')))warnings.push('El símbolo del título y el estado financiero no coinciden.');
  const timezone=raw.start?.timeZone || raw.end?.timeZone || raw.calendarTimezone || null;
  return { id: raw.id, title: raw.summary || 'Sin título', description: raw.description || '',
    start: raw.start?.dateTime || raw.start?.date, end: raw.end?.dateTime || raw.end?.date,
    allDay: !!raw.start?.date, timezone, end_timezone:raw.end?.timeZone || timezone,location: raw.location || '',
    label: labelId ? { id: labelId, name: labels[labelId]?.name || (typeof labels[labelId] === 'string' ? labels[labelId] : null), color: labels[labelId]?.backgroundColor || labels[labelId]?.background_color || null } : null,
    color_id: raw.colorId || raw.color_id || null, color: colors[raw.colorId || raw.color_id]?.background || null,
    cost:valid?cost:null, currency:valid?currency:null, cost_status:valid?status:null, purchase_status:purchase,purchase_id:fields.PURCHASE_ID||null,financial_fields:{cost,currency,status},financial_state:valid?'OK':cost===null&&purchase==='PAID'?'PAID_COST_MISSING':cost===null&&purchase==='PENDING'?'ESTIMATE_MISSING':block?'INVALID_FINANCIAL':'NON_FINANCIAL',warnings,
    recurring_event_id: raw.recurringEventId || null, original_start: raw.originalStartTime || null,
    recurrence:raw.recurrence || [],etag:raw.etag || null,
    deleted_at: raw.status === 'cancelled' ? raw.updated || new Date().toISOString() : null, updated_at: raw.updated, html_link: raw.htmlLink || null };
}
export function validCurrency(value){if(!/^[A-Z]{3}$/.test(value||''))return false;return Intl.supportedValuesOf?Intl.supportedValuesOf('currency').includes(value):true;}
function localEventDate(event,value) {return event.timezone?dateKey(new Date(value),event.timezone):value.slice(0,10);}
export function dateKey(now = new Date(), timezone = TRIP.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function occursOn(event, day) {
  if (event.deleted_at || !event.start || !event.end) return false;
  if (event.allDay) return event.start <= day && day < event.end;
  const first = localEventDate(event,event.start);
  const last = event.timezone ? dateKey(new Date(new Date(event.end).getTime() - 1), event.end_timezone||event.timezone) : new Date(Date.parse(event.end)-1+offsetMinutes(event.end)*60000).toISOString().slice(0,10);
  return first <= day && day <= last;
}
export function offsetMinutes(value){const match=/([+-])(\d\d):(\d\d)$/.exec(value);return match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3])):0;}
export function days() {
  const result = [];
  for (let time = Date.parse(`${TRIP.start}T12:00:00Z`); time <= Date.parse(`${TRIP.end}T12:00:00Z`); time += 86400000) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
export function finance(events, expenses, budget = null, referenceRates = {}) {
  let paid = 0, estimated = 0; const missing = [], by_currency={};
  const unique = [...new Map(events.filter(x => !x.deleted_at).map(x => [x.id, x])).values()];
  const audit=financialAudit(unique),financial_issues=audit.filter(row=>row.states.some(state=>!['OK','NON_FINANCIAL','DUPLICATE_PURCHASE'].includes(state)));
  const seenPurchases=new Set(),by_category={};
  for (const item of [...unique.map(x => ({ ...x, amount: x.cost })), ...expenses.filter(x => !x.deleted_at).map(x => ({ id: x.id, ...x.data }))]) {
    if (item.amount == null || !item.cost_status) continue;
    if(item.purchase_id){if(seenPurchases.has(item.purchase_id))continue;seenPurchases.add(item.purchase_id);}
    const original=item.amount_original ?? item.amount,currency=item.currency_original ?? item.currency;
    const originalTotals=by_currency[currency]??={paid:0,estimated:0,projected:0};
    if(item.cost_status==='PAID')originalTotals.paid+=Number(original);
    else if(item.cost_status==='ESTIMATED')originalTotals.estimated+=Number(original);
    originalTotals.projected=originalTotals.paid+originalTotals.estimated;
    const saved=(item.cost_status==='PAID'?item.actual_base_amount:null) ?? item.amount_base ?? item.base_amount ?? ((item.fx_rate_to_base ?? item.exchange_rate)!=null?original*(item.fx_rate_to_base ?? item.exchange_rate):null);
    const equivalent=item.cost_status==='PAID'&&item.actual_base_amount!=null?Number(item.actual_base_amount):currency===TRIP.currency?original:item.cost_status==='ESTIMATED'&&referenceRates[currency]?.rate?original*referenceRates[currency].rate:saved;
    if (equivalent == null) { missing.push(item); continue; }
    const category=item.label?.name||item.category||'Otros',totals=by_category[category]??={paid:0,estimated:0,projected:0};
    if (item.cost_status === 'PAID') {paid += Number(equivalent);totals.paid+=Number(equivalent);} else if (item.cost_status === 'ESTIMATED') {estimated += Number(equivalent);totals.estimated+=Number(equivalent);}
    totals.projected=totals.paid+totals.estimated;
  }
  return { paid, estimated, projected: paid + estimated, budget, difference: budget == null ? null : budget - paid - estimated, missing,by_currency,by_category,audit,financial_issues,missing_costs:financial_issues.filter(row=>row.states.includes('MISSING_COST')),partial:missing.length>0||financial_issues.length>0 };
}
export function financialAudit(events){
 const groups=new Map();for(const event of events.filter(e=>!e.deleted_at&&e.purchase_id)){const group=groups.get(event.purchase_id)||[];group.push(event);groups.set(event.purchase_id,group);}
 return events.filter(e=>!e.deleted_at).map(event=>{
  const fields=event.financial_fields||{cost:event.cost,currency:event.currency,status:event.cost_status},states=[];
  const financial=!!event.purchase_status||event.cost_status||Object.values(fields).some(value=>value!==null&&value!==undefined)||event.financial_state==='INVALID_FINANCIAL';
  if(!financial)states.push('NON_FINANCIAL');else{
   if(fields.cost==null)states.push('MISSING_COST');if(!fields.currency)states.push('MISSING_CURRENCY');if(!fields.status)states.push('MISSING_STATUS');
   if(event.purchase_status==='PAID'&&fields.status==='ESTIMATED'||event.purchase_status==='PENDING'&&fields.status==='PAID')states.push('SYMBOL_STATUS_MISMATCH');
   if(event.purchase_id&&groups.get(event.purchase_id)?.length>1)states.push('DUPLICATE_PURCHASE');if(!states.length)states.push('OK');
  }
  return{id:event.id,event:event.title,symbol:event.purchase_status==='PAID'?'✅':event.purchase_status==='PENDING'?'☐':'—',label:event.label?.name||null,cost:fields.cost,currency:fields.currency,cost_status:fields.status,purchase_id:event.purchase_id||null,state:states[0],states,financial_state:event.financial_state||(!event.cost_status&&event.purchase_status==='PAID'?'PAID_COST_MISSING':!event.cost_status&&event.purchase_status==='PENDING'?'ESTIMATE_MISSING':event.cost_status?'OK':'NON_FINANCIAL')};
 });
}
export function mergeFields(current, operation) {
  if (current?.deleted_at) return { record: current, conflicts: operation.deleted_at ? [] : [{ field: 'deleted_at', current: current.deleted_at, incoming: operation.changes }] };
  const data = { ...(current?.data || {}) }, conflicts = [];
  for (const [field, value] of Object.entries(operation.changes)) {
    const remote = data[field] ?? null, base = operation.base[field] ?? null;
    if (JSON.stringify(remote) !== JSON.stringify(base) && JSON.stringify(remote) !== JSON.stringify(value)) conflicts.push({ field, base, current: remote, incoming: value });
    else data[field] = value;
  }
  if (operation.deleted_at && current && current.version !== operation.base_version) conflicts.push({ field: 'deleted_at', current: current.data, incoming: operation.deleted_at });
  return { record: { ...current, data }, conflicts };
}
