import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const env=Object.fromEntries(readFileSync('.env.test.local','utf8').split(/\r?\n/).filter(x=>x&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()]}));

test('authenticated browser sees the imported Italy trip and live audit data',async({page})=>{
  await page.goto('/');
  await page.evaluate(async({email,password})=>{
    const{signInWithEmailPassword,getSupabaseClient}=await import('/src/supabaseClient.js');
    const{data,error}=await signInWithEmailPassword(email,password);if(error)throw error;
    localStorage.setItem('agenda-viajera.remoteMode','supabase');localStorage.setItem('agenda-viajera.user',data.user.id);localStorage.setItem('agenda-viajera.userName','Jonathan Rivera');localStorage.setItem('agenda-viajera.role','ADMIN');localStorage.setItem('agenda-viajera.device','tm3-live-ui-italy');
    const c=await getSupabaseClient();const{data:trips,error:tripError}=await c.from('av_trips').select('id,name,start_date,end_date').eq('name','Italy October/November 2026');if(tripError)throw tripError;if(trips.length!==1)throw Error('Italy canonical trip not visible');
    const trip=trips[0];const{data:records,error:recordError}=await c.from('av_records').select('record_type,data').eq('trip_id',trip.id);if(recordError)throw recordError;const{data:audits,error:auditError}=await c.from('av_audit_issues').select('code').eq('trip_id',trip.id);if(auditError)throw auditError;
    if(trip.start_date!=='2026-10-20'||trip.end_date!=='2026-11-05')throw Error('Italy dates mismatch');
    if(records.filter(x=>x.record_type==='LODGING').length!==6||records.filter(x=>x.record_type==='FLIGHT').length!==4||records.filter(x=>x.record_type==='RAIL').length!==10)throw Error('Imported record counts mismatch');
    if(!audits.some(x=>x.code==='SHORT_CONNECTION')||!audits.some(x=>x.code==='CONFIRMED_WITHOUT_DATE'))throw Error('Expected audits missing');
    localStorage.setItem('agenda-viajera.remoteTripId',trip.id);
  },{email:env.SUPABASE_TEST_ADMIN_EMAIL,password:env.SUPABASE_TEST_ADMIN_PASSWORD});
  await page.reload();
  await expect(page.getByText('Agenda Viajera')).toBeVisible();
  await page.getByRole('button',{name:/Agenda/}).click();
  await expect(page.locator('h1').filter({hasText:'Agenda'})).toBeVisible();
  await page.getByRole('button',{name:'J'}).click();
  await page.getByText('Presupuesto').click();
  await expect(page.locator('h1').filter({hasText:'Presupuesto'})).toBeVisible();
  await page.getByRole('button',{name:'J'}).click();
  await page.getByText('Administración').click();
  await expect(page.locator('h1').filter({hasText:'Administración'})).toBeVisible();
});
