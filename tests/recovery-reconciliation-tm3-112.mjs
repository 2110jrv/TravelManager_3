import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TM3-112 recovery reconciliation report and canonical exports', () => {
  const report=JSON.parse(fs.readFileSync('tmp/recovery-reconciliation-report.json','utf8'));
  const before=JSON.parse(fs.readFileSync('tmp/before-recovery-data-merge.json','utf8'));
  const after=JSON.parse(fs.readFileSync('tmp/after-full-recovery-data-merge.json','utf8'));
  assert.equal(report.sourceItemCount,152);
  assert.equal(report.canonicalBefore,21);
  assert.equal(report.canonicalAfter,150);
  assert.equal(report.idempotency.fullSecondRunCreated,0);
  assert.equal(report.idempotency.fullSecondRunUpdated,0);
  assert.equal(before.records.length,21);
  assert.equal(after.records.length,150);
  const counts=Object.fromEntries(Object.entries(after.records.reduce((m,x)=>(m[x.record_type]=(m[x.record_type]||0)+1,m),{})));
  assert.deepEqual(counts,{LODGING:6,FLIGHT:4,RAIL:10,TOUR:1,TRANSPORT:30,FOOD:14,ACTIVITY:66,PURCHASE:14,OTHER:4,SHOPPING:1});
  assert.equal(after.audits.filter(x=>x.code==='SHORT_CONNECTION').length,1);
  assert.equal(after.audits.filter(x=>x.code==='CONFIRMED_WITHOUT_DATE').length,1);
  assert.equal(new Set(after.records.map(x=>x.record_id)).size,after.records.length);
  const ua2024=after.records.find(x=>x.data?.flight==='UA 2024');
  assert.deepEqual(ua2024.data.passengers.map(x=>[x.passengerId,x.ticketNumber,x.seat]),[['jennifer','0162368493945','38E'],['jonathan','0162368493946','38F']]);
  const tirano=after.records.find(x=>x.data?.confirmationCode==='HM9YY3Y8TZ');
  assert.equal(tirano.data.qrSourceType,'MANUAL');
  assert.equal(tirano.data.qrPayload,'');
  const purchases=after.records.filter(x=>x.record_type==='PURCHASE');
  assert.equal(Number(purchases.reduce((n,x)=>n+Number(x.data.cost.amount),0).toFixed(2)),561.18);
  assert.equal(after.records.filter(x=>x.data?.latitude!=null&&x.data?.longitude!=null).length,68);
});
