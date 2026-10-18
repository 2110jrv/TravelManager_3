import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{PGlite}from'@electric-sql/pglite';
import{TRIP}from'../public/v2/config.js';import{dayPlan,scheduledInstant,scheduleId,canSchedule}from'../public/v2/day-pin-schedule.js';
const day='2026-10-22',pin={id:'00000000-0000-0000-0000-000000000010',kind:'places_of_interest',data:{name:'Existing pin',resolved_city:'Venezia',google_maps_url:'https://maps.app.goo.gl/Existing123',label:'Interés'}};
const event={id:'calendar',title:'Confirmed',start:day+'T15:00:00+02:00',end:day+'T15:30:00+02:00',timezone:'Europe/Rome',cities:['Venezia']};
test('real locality/manual relations filter options; exact Calendar pin relations exclude redundant options',()=>{
 const outside={...pin,id:'outside',data:{...pin.data,resolved_city:'Roma'}},manual={...pin,id:'manual',data:{...pin.data,resolved_city:'Venecia',assignment_mode:'manual',assigned_dates:[day]}},auto={...manual,id:'auto',data:{...manual.data,assignment_mode:'auto'}};
 assert.deepEqual(dayPlan([event],[pin,outside,manual,auto],day).options.map(p=>p.id),[pin.id,'manual']);
 assert.deepEqual(dayPlan([{...event,location:pin.data.google_maps_url}],[pin],day).options,[]);
});
test('same pin changes position, remains independent of Calendar, and returns to options after removal',()=>{
 const schedule={id:'schedule',kind:'day_pin_schedule',data:{pin_id:pin.id,date:day,scheduled_time:'14:30',active:true}},original=structuredClone(event);
 let plan=dayPlan([event],[pin,schedule],day);assert.deepEqual(plan.agenda.map(e=>e.id),['schedule','calendar']);assert.equal(plan.options.length,0);assert.equal(plan.agenda[0].pin,pin);
 plan=dayPlan([event],[pin,{...schedule,data:{...schedule.data,scheduled_time:'16:00'}}],day);assert.deepEqual(plan.agenda.map(e=>e.id),['calendar','schedule']);
 plan=dayPlan([event],[pin,{...schedule,data:{...schedule.data,active:false}}],day);assert.deepEqual(plan.options,[pin]);assert.deepEqual(event,original);
 assert.equal(dayPlan([event],[pin,schedule],'2026-10-23').schedules.length,0);
});
test('wall-clock scheduling observes DST, rejects invalid times, and viewer never writes',()=>{
 assert.equal(scheduledInstant('2026-10-24','14:30'),'2026-10-24T12:30:00.000Z');assert.equal(scheduledInstant('2026-10-25','14:30'),'2026-10-25T13:30:00.000Z');assert.throws(()=>scheduledInstant(day,'24:00'));
 assert.equal(canSchedule({user_id:'u',role:'VIEWER',can_edit:true},{id:'u',authorized:true}),false);assert.equal(canSchedule({user_id:'u',role:'ADMIN',can_edit:true},{id:'u',authorized:true}),true);
});
test('canonical SQL enforces unique identity, replay safety, reversible scheduling, actor and viewer permissions',async()=>{
 const db=new PGlite(),trip=TRIP.id,actor='00000000-0000-0000-0000-000000000001',device='00000000-0000-0000-0000-000000000002',installation='00000000-0000-0000-0000-000000000003';
 try{await db.exec(`create role anon;create role authenticated;create role service_role;create table av2_trips(id uuid primary key,start_date date,end_date date);create table av2_app_users(id uuid primary key,trip_id uuid,active boolean);create table av2_devices(id uuid primary key);create table av2_user_devices(device_id uuid,user_id uuid,installation_id uuid,friendly_name text);create table av2_places_of_interest(id uuid primary key,trip_id uuid,deleted_at timestamptz);create table av2_sync_metadata(id uuid primary key,trip_id uuid,device_id uuid,result jsonb,updated_by_device uuid);create table av2_audit_log(trip_id uuid,actor_user uuid,installation_id uuid,device_name text,action text,entity text,entity_id text,summary text);create function av2_authenticate_device(uuid,uuid,text) returns boolean language sql as $$select $3='valid'$$;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261009140000_av2_day_pin_schedule.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261009160000_av2_itinerary_times.sql',import.meta.url),'utf8'));
 await db.query('insert into av2_trips values ($1,$2,$3)',[trip,TRIP.start,TRIP.end]);await db.query('insert into av2_app_users(id,trip_id,active) values ($1,$2,true)',[actor,trip]);await db.query('insert into av2_devices values ($1)',[device]);await db.query("insert into av2_user_devices values ($1,$2,$3,'Test')",[device,actor,installation]);await db.query('insert into av2_places_of_interest values ($1,$2,null)',[pin.id,trip]);
 const id=await scheduleId(trip,day,pin.id),operation=(changes,base_version=0)=>({id:crypto.randomUUID(),record_id:id,kind:'day_pin_schedule',device_id:device,actor_user:actor,installation_id:installation,base_version,changes}),apply=async(op,token='valid')=>(await db.query('select av2_day_pin_apply($1,$2,$3,$4::jsonb) result',[trip,device,token,JSON.stringify(op)])).rows[0].result;
 const first=operation({date:day,pin_id:pin.id,scheduled_time:'14:30',active:true});let r=await apply(first);assert.equal(r.record.data.scheduled_time,'14:30');assert.deepEqual(await apply(first),r);const created=r.record.data.created_at;
 r=await apply(operation({scheduled_time:'16:00'},1));assert.equal(r.record.version,2);r=await apply(operation({active:false},2));assert.equal(r.record.data.active,false);r=await apply(operation({active:true,scheduled_time:'14:30'},3));assert.equal(r.record.data.created_at,created);assert.equal((await db.query('select count(*) n from av2_day_pin_schedule')).rows[0].n,1);
 await assert.rejects(()=>apply(operation({active:true}),'invalid'),/AV2_DEVICE_REVOKED/);await assert.rejects(()=>apply({...operation({active:true}),actor_user:pin.id}),/ACTOR_MISMATCH/);await assert.rejects(()=>apply(operation({scheduled_time:'25:00'})),/AV2_TIME_INVALID/);
 r=await apply(operation({scheduled_time:null,start_time:null,end_time:'17:15',completed:true,completed_at:'2026-10-22T15:15:00Z'},4));assert.equal(r.record.data.start_time,null);assert.equal(r.record.data.end_time,'17:15');assert.equal(r.record.data.completed,true);r=await apply(operation({end_time:'17:30',completed_at:'2026-10-22T15:30:00Z'},5));assert.equal(r.record.data.end_time,'17:30');const other=await scheduleId(trip,'2026-10-23',pin.id);await assert.rejects(()=>apply({...operation({date:'2026-10-23',pin_id:pin.id,scheduled_time:null,active:true}),record_id:other}),/AV2_PIN_ALREADY_SCHEDULED/);
 await db.query("update av2_app_users set agenda_role='VIEWER'");await assert.rejects(()=>apply(operation({active:false})),/AV2_AGENDA_READ_ONLY/);const rows=(await db.query('select av2_sync_day_pins($1,$2,$3) r',[trip,device,'valid'])).rows[0].r;assert.equal(rows.length,1);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from av2_day_pin_schedule'),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
