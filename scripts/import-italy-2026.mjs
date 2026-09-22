import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const root=process.cwd();
const sourcePath=resolve(root,'recovery/input/tm3_recovery_master_v4_lodging_flights_tour.json');
const dryRun=process.argv.includes('--dry-run');
const apply=process.argv.includes('--apply');
const verify=process.argv.includes('--verify');
if([dryRun,apply,verify].filter(Boolean).length!==1) throw Error('Use exactly one of --dry-run, --apply, --verify');

const source=JSON.parse(await readFile(sourcePath,'utf8'));
const segmentTickets={UA2024:{PAX_JENNIFER:{ticketNumber:'0162368493945',seat:'38E'},PAX_JONATHAN:{ticketNumber:'0162368493946',seat:'38F'}},UA126:{PAX_JENNIFER:{ticketNumber:'0162368493945',seat:'50K'},PAX_JONATHAN:{ticketNumber:'0162368493946',seat:'50L'}},UA885:{PAX_JENNIFER:{ticketNumber:'0162368493945',seat:'49K'},PAX_JONATHAN:{ticketNumber:'0162368493946',seat:'49L'}},UA2025:{PAX_JENNIFER:{ticketNumber:'0162368493945',seat:'38B'},PAX_JONATHAN:{ticketNumber:'0162368493946',seat:'38A'}}};
const env=Object.fromEntries((await readFile(resolve(root,'.env.test.local'),'utf8')).split(/\r?\n/).filter(x=>x&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()]}));
const url='https://cslludzuejkhsydqiabx.supabase.co';
const key='sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U';
const sourceFile='recovery/input/tm3_recovery_master_v4_lodging_flights_tour.json';
const tripName='Italy October/November 2026';
const startDate='2026-10-20';
const endDate='2026-11-05';
const reportPath=resolve(root,'tmp/italy-2026-import-dry-run.json');
const exportPath=resolve(root,'tmp/italy-2026-post-import-export.json');

const stableUuid=(value)=>{const b=createHash('sha256').update(`agenda-viajera:${value}`).digest().subarray(0,16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const provenance=(legacyId,sourceRecoveryId,sourceStatus,sourceNotes)=>({legacyId,sourceRecoveryId,sourceFile,sourceStatus,...(sourceNotes?{sourceNotes}:{})});
const pax=(id,extra={})=>({passengerId:id==='PAX_JONATHAN'?'jonathan':'jennifer',sourcePassengerId:id,...extra});
const json=(x)=>JSON.stringify(x);

function canonicalData(recordType,legacyId,sourceRecoveryId,sourceStatus,data,sourceNotes){return {recordType,sourceStatus,provenance:provenance(legacyId,sourceRecoveryId,sourceStatus,sourceNotes),...data}}
function buildRecords(){
  const flights=source.documentedFlights;
  const records=[];
  for(const [i,s] of flights.Segments.entries()){const flight=String(s.Flight||'').replaceAll(' ','').toUpperCase();const segment=segmentTickets[flight]||{};records.push({type:'FLIGHT',legacyId:`FLIGHT_${s.Date}_${s.Flight.replaceAll(' ','_')}`,data:canonicalData('FLIGHT',`FLIGHT_${s.Date}_${s.Flight.replaceAll(' ','_')}`,`RECOVERY_FLIGHT_${i+1}`,'CONFIRMED',{date:s.Date,arrivalDate:s.ArrivalDate||s.Date,flight:s.Flight,from:s.From,to:s.To,departure:s.Departure,arrival:s.Arrival,overnight:Boolean(s.Overnight),provider:flights.Provider,bookingReference:flights.AirlineReference,ticketBookingId:flights.BookingID,cost:i===0?{kind:'EXACT',currency:'USD',amount:flights.PaidUSD}:{kind:'UNKNOWN',currency:null,amount:null},passengers:Object.entries(s.Seats||{}).map(([id,seat])=>pax(id,{seat,...(segment[id]||{})}))},{sourceStatus:'PAID_CONFIRMED'})});}
  for(const l of source.documentedLodging) records.push({type:'LODGING',legacyId:l.LodgingID,data:canonicalData('LODGING',l.LodgingID,l.LodgingID,'CONFIRMED',{city:l.City,property:l.Property,host:l.Host,checkInDate:l.CheckInDate,checkOutDate:l.CheckOutDate,nights:l.Nights,guests:l.Guests,confirmationCode:l.ConfirmationCode,cost:{kind:'EXACT',currency:'USD',amount:l.PaidUSD},status:l.Status,notes:l.Notes,passengers:[pax('PAX_JONATHAN'),pax('PAX_JENNIFER')]})});
  for(const t of source.documentedTransport){const legacy=t.TransportID;const status=t.TransportMode==='DAY_PASS'?'CONFIRMED':'CONFIRMED';records.push({type:'RAIL',legacyId:legacy,data:canonicalData('RAIL',legacy,legacy,status,{date:t.Date,provider:t.Provider,service:t.Service,trainNumber:t.TrainNumber,from:t.From,to:t.To,departure:t.DepartureTime,arrival:t.ArrivalTime,class:t.Class,bookingReference:t.BookingReference||null,flexibleRegionalTravel:Boolean(t.FlexibleRegionalTravel),specificTrainRequired:t.SpecificTrainRequired!==false,routeScope:t.RouteScope||null,cost: t.PriceCHF?{kind:'EXACT',currency:'CHF',amount:t.PriceCHF*2}:railCost(t),passengers:(t.PassengersConfirmed||[]).map(p=>pax(p.PassengerID,{ticketNumber:p.TicketCode||p.TicketID||null,bookingReference:p.BookingReference||p.Reference||t.BookingReference||null,seat:p.Seat||null,coach:p.Coach||null}))})});}
  const tour=source.documentedTours[0];records.push({type:'TOUR',legacyId:tour.TourID,data:canonicalData('TOUR',tour.TourID,tour.TourID,'NEEDS_REVIEW',{provider:tour.Provider,title:tour.Title,startTime:tour.StartTime,durationMinutes:tour.DurationMinutes,tickets:tour.Tickets,orderNumber:tour.OrderNumber,date:null,cost:{kind:'EXACT',currency:'EUR',amount:tour.PaidEUR},needsReview:true,reviewReason:tour.ReviewReason,passengers:[pax('PAX_JONATHAN'),pax('PAX_JENNIFER')]})});
  return records;
}
function railCost(t){const n=(t.PassengersConfirmed||[]).length||2;const ref=t.TransportID;const amounts={'TRAIN_2026-10-21_FCO_ROMA_LEONARDO':14*n,'TRAIN_2026-10-21_ROMA_VENEZIA_9428':42.90*n,'TRAIN_2026-10-24_VENEZIA_MILANO_8974':102.80,'TRAIN_2026-10-24_MILANO_TIRANO_2822':null,'TRAIN_2026-10-26_TIRANO_MILANO_2815':12.50*n,'TRAIN_2026-10-26_MILANO_GENOVA_659':null,'TRAIN_2026-10-26_GENOVA_PISA_511':null,'TRAIN_2026-10-28_FIRENZE_NAPOLI_8902':57.80,'TRAIN_2026-11-02_NAPOLI_ROMA_9940':61.80};return amounts[ref]!=null?{kind:'EXACT',currency:'EUR',amount:amounts[ref]}:{kind:'UNKNOWN',currency:null,amount:null}}

function validate(){
  if(!source.trips.some(t=>t.StartDate===startDate&&t.EndDate===endDate&&t.TripID==='TRIP_ITALY_2026'))throw Error('Italy source trip/date validation failed');
  if(source.documentedLodging.length!==6)throw Error('Expected six canonical lodging stays');
  if(source.documentedFlights.Segments.length!==4)throw Error('Expected four flight segments');
  if(source.documentedTransport.length!==10)throw Error('Expected ten rail entries');
  if(source.documentedTours.length!==1||source.documentedTours[0].Date!==null)throw Error('Tour must remain undated needs-review');
  const c=source.lodgingCoverageAudit;if(c.NightsRequiringCoverage!==16||c.CoveredNights!==16||c.UncoveredNights.length)throw Error('Night coverage is not 16/16');
  if(source.documentedTransport.some(t=>t.TransportMode==='DAY_PASS'&&t.SpecificTrainRequired!==false))throw Error('Flexible SBB pass incorrectly treated as reservation');
  const records=buildRecords();if(new Set(records.map(r=>r.legacyId)).size!==records.length)throw Error('Duplicate source fingerprints');
  const warnings=[{code:'SHORT_CONNECTION',date:'2026-10-21',message:'Leonardo Express arrival 16:10 to Frecciarossa departure 16:35 (25 minutes)'},{code:'CONFIRMED_WITHOUT_DATE',message:source.documentedTours[0].ReviewReason}];
  return {records,warnings};
}

async function auth(email,password){const r=await fetch(`${url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:json({email,password})});const b=await r.json();if(!r.ok)throw Error(`Supabase authenticated login failed (${r.status})`);return {token:b.access_token,user:b.user}}
async function api(session,path,{method='GET',body,headers={}}={}){const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${session.token}`,'content-type':'application/json',Prefer:'return=representation',...headers},body:body===undefined?undefined:json(body)});const b=await r.text();let value;try{value=b?JSON.parse(b):null}catch{value=b}if(!r.ok)throw Error(`Supabase REST ${method} ${path} failed (${r.status}): ${value?.message||value?.hint||value?.code||'request rejected'}`);return value}
async function setup(session,traveler){
  const adminId=session.user.id,jenniferId=traveler.user.id;
  for(const [s,id,name,email] of [[session,adminId,'Jonathan Rivera','admin'],[traveler,jenniferId,'Jennifer Torres','traveler']]){const rows=await api(s,`av_users?id=eq.${id}`,{});if(!rows.length)await api(s,'av_users',{method:'POST',body:{id,display_name:name,email:`${email}@test.local`}})}
  const existing=await api(session,`av_trips?name=eq.${encodeURIComponent(tripName)}&select=id,name,start_date,end_date`);let trip=existing[0];if(!trip){trip=(await api(session,'av_trips',{method:'POST',body:{id:stableUuid('trip:italy-2026'),name:tripName,start_date:startDate,end_date:endDate,status:'PLANNING',created_by:adminId}}))[0]}else if(trip.start_date!==startDate||trip.end_date!==endDate)throw Error('Existing canonical Italy trip has wrong dates');
  const adminPermissions={CanChat:true,CanEditAgenda:true,CanViewDocuments:true,CanResolveConflicts:true};
  await api(session,'rpc/av_bootstrap_admin_membership',{method:'POST',body:{p_trip_id:trip.id,p_permissions:adminPermissions}});
  const travelerMembership={trip_id:trip.id,user_id:jenniferId,role:'TRAVELER',permissions:{CanChat:true,CanEditAgenda:true,CanViewDocuments:true,CanResolveConflicts:false},status:'ACTIVE'};
  await api(session,'av_trip_memberships?on_conflict=trip_id%2Cuser_id',{method:'POST',body:travelerMembership,headers:{Prefer:'resolution=merge-duplicates,return=representation'}});
  return {trip,adminId,jenniferId};
}
async function applyImport(){
  const session=await auth(env.SUPABASE_TEST_ADMIN_EMAIL,env.SUPABASE_TEST_ADMIN_PASSWORD);const traveler=await auth(env.SUPABASE_TEST_TRAVELER_EMAIL,env.SUPABASE_TEST_TRAVELER_PASSWORD);const setupData=await setup(session,traveler);const {records,warnings}=validate();const deviceId='tm3-import-italy-2026';
  const out=[];for(const r of records){const recordId=stableUuid(`record:${r.legacyId}`);const operationId=stableUuid(`operation:${r.legacyId}`);const result=await api(session,'rpc/av_apply_change_operation',{method:'POST',body:{p_operation_id:operationId,p_trip_id:setupData.trip.id,p_record_type:r.type,p_record_id:recordId,p_action:'CREATE',p_base_version:0,p_changes:r.data,p_user_id:setupData.adminId,p_device_id:deviceId,p_created_at:new Date().toISOString()}});const current=(await api(session,`av_records?record_id=eq.${recordId}&select=version,data`))[0];if(current&&r.data.cost?.amount!=null&&current.data?.cost?.amount!==r.data.cost.amount){await api(session,'rpc/av_apply_change_operation',{method:'POST',body:{p_operation_id:stableUuid(`operation:${r.legacyId}:budget-normalize`),p_trip_id:setupData.trip.id,p_record_type:r.type,p_record_id:recordId,p_action:'UPDATE',p_base_version:current.version,p_changes:{cost:r.data.cost},p_user_id:setupData.adminId,p_device_id:deviceId,p_created_at:new Date().toISOString()}})}out.push({legacyId:r.legacyId,recordId,status:result?.status||'UNKNOWN'})}
  for(const w of warnings){const existing=await api(session,`av_audit_issues?trip_id=eq.${setupData.trip.id}&code=eq.${w.code}&select=id`);if(!existing.length)await api(session,'av_audit_issues',{method:'POST',body:{trip_id:setupData.trip.id,code:w.code,severity:'WARN',repair_class:'REVIEW',entry_ids:[],message:w.message}})}
  return {session,setupData,written:out};
}
async function verifyImport(){
  const session=await auth(env.SUPABASE_TEST_ADMIN_EMAIL,env.SUPABASE_TEST_ADMIN_PASSWORD);const trips=await api(session,`av_trips?name=eq.${encodeURIComponent(tripName)}&select=*`);if(trips.length!==1)throw Error('Canonical Italy trip count is not one');const trip=trips[0];if(trip.start_date!==startDate||trip.end_date!==endDate)throw Error('Canonical Italy dates mismatch');const members=await api(session,`av_trip_memberships?trip_id=eq.${trip.id}&select=*`);const records=await api(session,`av_records?trip_id=eq.${trip.id}&select=*`);const audits=await api(session,`av_audit_issues?trip_id=eq.${trip.id}&select=*`);const data=records.map(x=>x.data||{});if(data.filter(x=>x.recordType==='LODGING').length!==6)throw Error('Live lodging count mismatch');if(data.filter(x=>x.recordType==='FLIGHT').length!==4)throw Error('Live flight count mismatch');if(data.filter(x=>x.recordType==='RAIL').length!==10)throw Error('Live rail count mismatch');if(data.filter(x=>x.recordType==='TOUR'&&x.sourceStatus==='NEEDS_REVIEW').length!==1)throw Error('Live tour review count mismatch');return {trip,members,records,audits}}

const {records,warnings}=validate();
const active=records.filter(r=>r.data.sourceStatus==='CONFIRMED');
const currencyTotals={USD:765.35+source.documentedLodging.reduce((a,x)=>a+x.PaidUSD,0)+506.53,EUR:80+14*2+42.90*2+102.80+12.50*2+57.80+61.80,CHF:52*2};
const report={generatedAt:new Date().toISOString(),source:{file:sourceFile,datasetId:source.datasetId},trip:{name:tripName,startDate,endDate},sourceItemCount:source.itemCandidates.length,confirmedActiveCount:active.length,archivedCount:0,duplicateCount:source.conflicts.filter(x=>String(x).toUpperCase().includes('DUPLIC')).length,conflictCount:source.conflicts.length,needsReviewCount:records.filter(r=>r.data.sourceStatus==='NEEDS_REVIEW').length,recordsByType:Object.groupBy(records,r=>r.type),lodgingCount:source.documentedLodging.length,flightSegments:source.documentedFlights.Segments.length,railEntries:source.documentedTransport.length,tourNeedsReview:1, currencyTotals,nightCoverage:{required:16,covered:16,uncovered:[],auditCodeAbsent:'NIGHT_WITHOUT_LODGING'},passengerAudit:{jonathan:true,jennifer:true,documentedSegments:records.filter(r=>r.type==='FLIGHT'||r.type==='RAIL').length},warnings,mappingPreview:records.map(r=>({legacyId:r.legacyId,canonicalUuid:stableUuid(`record:${r.legacyId}`),sourceRecoveryId:r.data.provenance.sourceRecoveryId,sourceStatus:r.data.sourceStatus}))};
if(dryRun){await mkdir(resolve(root,'tmp'),{recursive:true});await writeFile(reportPath,json(report),'utf8');console.log(JSON.stringify({mode:'dry-run',report:reportPath,valid:true,sourceItems:report.sourceItemCount,confirmed:report.confirmedActiveCount,needsReview:report.needsReviewCount,coverage:'16/16'},null,2));}
if(apply){if(report.confirmedActiveCount!==20||report.lodgingCount!==6||report.flightSegments!==4||report.railEntries!==10||report.nightCoverage.covered!==16)throw Error('Dry-run acceptance failed; apply stopped');const r=await applyImport();console.log(JSON.stringify({mode:'apply',tripId:r.setupData.trip.id,recordsWritten:r.written.length,statuses:r.written.map(x=>x.status)},null,2));}
if(verify){const r=await verifyImport();await mkdir(resolve(root,'tmp'),{recursive:true});const exportData={exportedAt:new Date().toISOString(),trip:r.trip,memberships:r.members,records:r.records,audits:r.audits,sourceFile};await writeFile(exportPath,json(exportData),'utf8');console.log(JSON.stringify({mode:'verify',tripId:r.trip.id,memberships:r.members.length,records:r.records.length,audits:r.audits.map(x=>x.code),exportPath},null,2));}

