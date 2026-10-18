import {formatMoney} from './format.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#574eb5','#bd5576','#30759e','#bd7830','#795891','#a04e45','#53638f'];
export function budgetSlices(finance){
 const slices=[];let index=0;
 for(const [category,totals] of Object.entries(finance.by_category)){
  for(const [field,status] of [['paid','PAID'],['estimated','ESTIMATED']])if(totals[field]>0)slices.push({category,status,amount:totals[field],color:colors[index%colors.length],pending:status==='ESTIMATED'});
  index++;
 }
 if(finance.available>0)slices.push({category:'Disponible',status:'AVAILABLE',amount:finance.available,color:'#248453'});
 return slices;
}
export function renderBudgetChart(finance){
 const slices=budgetSlices(finance),total=slices.reduce((sum,s)=>sum+s.amount,0);if(!total)return '<p class="muted">Configura el presupuesto o registra un gasto para ver su distribución.</p>';
 let offset=0;const circumference=2*Math.PI*70;
 const arcs=slices.map((s,index)=>{const length=s.amount/total*circumference,start=offset;offset+=length;return `<circle cx="100" cy="100" r="70" fill="none" stroke="${s.color}" stroke-opacity="${s.pending?'.48':'1'}" stroke-width="32" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-start}" transform="rotate(-90 100 100)" data-action="budget-slice" data-id="${index}" tabindex="0" role="button" aria-label="${escape(s.category)} · ${s.status==='PAID'?'Pagado':s.status==='ESTIMATED'?'Pendiente':'Disponible'} · ${formatMoney(s.amount)}"><title>${escape(s.category)} · ${formatMoney(s.amount)}</title></circle>`;}).join('');
 return `<section class="card budget-distribution"><h2>Distribución del presupuesto</h2><svg viewBox="0 0 200 200" class="budget-donut" aria-label="Presupuesto por categoría y estado">${arcs}<text x="100" y="96" text-anchor="middle" class="donut-caption">${finance.over_budget?'Proyectado':'Presupuesto'}</text><text x="100" y="116" text-anchor="middle" class="donut-total">${formatMoney(total)}</text></svg><div id="budget-slice-detail" aria-live="polite"></div>${['PAID','ESTIMATED','AVAILABLE'].map(status=>`<div class="budget-legend-group"><strong>${status==='PAID'?'Pagado':status==='ESTIMATED'?'Pendiente':'Disponible'}</strong>${slices.map((s,index)=>s.status!==status?'':`<button data-action="budget-slice" data-id="${index}"><i style="background:${s.color};opacity:${s.pending?'.48':'1'}"></i><span>${escape(s.category)}</span><strong>${formatMoney(s.amount)}</strong></button>`).join('')}</div>`).join('')}</section>`;
}
export function budgetSliceDetail(finance,index){const slice=budgetSlices(finance)[index];if(!slice)return '';return `<p><strong>${escape(slice.category)}</strong> · ${slice.status==='PAID'?'Pagado':slice.status==='ESTIMATED'?'Pendiente':'Disponible'} · ${formatMoney(slice.amount)}${finance.budget>0?' · '+(slice.amount/finance.budget*100).toFixed(1)+'% del presupuesto':''}</p>${slice.status==='AVAILABLE'?'':`<button data-action="budget-drilldown" data-id="${index}">Ver gastos</button>`}`;}
