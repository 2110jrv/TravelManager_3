import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const env=Object.fromEntries(readFileSync('.env.test.local','utf8').split(/\r?\n/).filter(x=>x&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()]}));
const tripId='1aafae82-4ff7-423b-ade2-25170e8b0dd4';

test('real editor save pipeline persists locally, syncs, reloads and reverts',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async({email,password,tripId})=>{
    const signIn=await import('/src/supabaseClient.js');
    const auth=await signIn.signInWithEmailPassword(email,password); if(auth.error)throw auth.error;
    const userId=auth.data.user.id, deviceId=`tm3-persistence-${crypto.randomUUID()}`;
    localStorage.setItem('agenda-viajera.user',userId);localStorage.setItem('agenda-viajera.role','ADMIN');localStorage.setItem('agenda-viajera.device',deviceId);localStorage.setItem('agenda-viajera.remoteMode','supabase');
    const {SupabaseRemoteSyncAdapter}=await import('/src/sync/SupabaseRemoteSyncAdapter.js');
    const {platformRepository}=await import('/src/services/localPlatform.js');
    const {createLocalRepository}=await import('/src/db/localRepository.js');
    const {createAgendaController}=await import('/src/controllers/agendaController.js');
    const {flushPendingOperations,performMutation}=await import('/src/controllers/mutationController.js');
    const {renderAgendaEditor,editorChanges}=await import('/src/app/render/renderAgendaEditor.js');
    const adapter=new SupabaseRemoteSyncAdapter({userId,deviceId});
    const records=await adapter.pullRecords({tripId});
    if(!records.length)throw Error('No canonical agenda records available');
    const spot=records.flatMap(r=>r.data?.passengers||[]);
    const jennifer=spot.find(p=>p.ticket==='0162368493945'&&p.seat==='38E');
    const jonathan=spot.find(p=>p.ticket==='0162368493946'&&p.seat==='38F');
    const passengerSpotCheck=Boolean(jennifer&&jonathan);
    const target=records.find(r=>!['FLIGHT','RAIL'].includes(r.recordType))||records[0];
    const canonicalBefore=await adapter.getRecord(target.recordId);
    const remoteData=canonicalBefore.data||{};
    const local=await platformRepository();
    await local.applyCanonical({...canonicalBefore,data:remoteData});
    const repo=createLocalRepository();await repo.ready;
    const localBefore=repo.snapshot().items.find(x=>x.id===target.recordId)||{...remoteData,id:target.recordId,version:canonicalBefore.version};
    const original=localBefore.notes??remoteData.notes??'';
    const marker=`TM3-PERSISTENCE-TEST-${Date.now()}`;
    const access={permissions:{edit:true}};
    const agenda=createAgendaController({repository:repo,access});
    const form=document.createElement('form');form.innerHTML=renderAgendaEditor(localBefore);document.body.append(form);
    const notes=form.querySelector('[name="notes"]');if(!notes)throw Error('Notes binding missing');notes.value=marker;
    const payload=editorChanges(form);if(payload.notes!==marker||!('startDate' in payload)||!('passengers' in payload))throw Error('Editor payload binding failed');
    form.remove();
    let markerSaved=false;
    try{
      const saved=await agenda.save(target.recordId,{notes:marker});markerSaved=true;
      const op=saved.operation;
      if(!op.operationId||op.recordId!==target.recordId||op.baseVersion!==canonicalBefore.version||op.userId!==userId||op.deviceId!==deviceId)throw Error('ChangeOperation metadata mismatch');
      const localAfter=repo.snapshot().items.find(x=>x.id===target.recordId);
      if(localAfter?.notes!==marker||localAfter.version!==canonicalBefore.version+1)throw Error('Local readback/version failed');
      const queued=(await local.all('changeOperations')).find(x=>x.operationId===op.operationId);if(!queued||queued.status!=='PENDING')throw Error('Pending queue entry missing');
      const sync=await flushPendingOperations();if(sync.pending!==0)throw Error(`Queue did not drain: ${sync.pending}`);
      const applied=(await local.all('changeOperations')).find(x=>x.operationId===op.operationId);if(applied?.status!=='APPLIED')throw Error('Operation not applied');
      const remoteAfter=await adapter.getRecord(target.recordId);if(remoteAfter?.data?.notes!==marker)throw Error('Supabase canonical marker readback failed');
      const independent=await new SupabaseRemoteSyncAdapter({userId,deviceId:`${deviceId}-independent`}).getRecord(target.recordId);if(independent?.data?.notes!==marker)throw Error('Independent canonical read failed');
      const reopened=await createLocalRepository();await reopened.ready;if(reopened.snapshot().items.find(x=>x.id===target.recordId)?.notes!==marker)throw Error('Reopened local store read failed');
      await agenda.save(target.recordId,{notes:original});await flushPendingOperations();
      const reverted=await adapter.getRecord(target.recordId);if((reverted?.data?.notes??'')!==original)throw Error('Supabase revert failed');
      const reopenedAfter=await createLocalRepository();await reopenedAfter.ready;if((reopenedAfter.snapshot().items.find(x=>x.id===target.recordId)?.notes??'')!==original)throw Error('Reopened revert read failed');
      return{target:target.recordId,version:canonicalBefore.version,operationId:op.operationId,baseVersion:op.baseVersion,marker,original,queue:'APPLIED',passengerSpotCheck,payloadSections:['General','Horario','Lugar / ruta','Reserva','Pasajeros','Costo','Documentos y notas','Historial']};
    }finally{if(markerSaved){try{await flushPendingOperations()}catch{}}}
  },{email:env.SUPABASE_TEST_ADMIN_EMAIL,password:env.SUPABASE_TEST_ADMIN_PASSWORD,tripId});
  expect(result.queue).toBe('APPLIED');expect(result.payloadSections).toHaveLength(8);
});
