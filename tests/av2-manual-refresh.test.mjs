import test from 'node:test';import assert from'node:assert/strict';import{ManualRefresh}from'../public/v2/manual-refresh.js';
test('manual refresh coalesces repeated clicks, renders once after data and unlocks after failure',async()=>{
 let release,updates=0,renders=0;const gate=new Promise(r=>release=r),r=new ManualRefresh(async()=>{updates++;await gate;},async()=>{renders++;});
 const first=r.run(),second=r.run();assert.equal(first,second);assert.equal(updates,1);assert.equal(renders,0);release();await first;assert.equal(renders,1);assert.equal(r.running,null);
 let fail=true;const retry=new ManualRefresh(async()=>{if(fail)throw Error('offline');},async()=>renders++);await assert.rejects(retry.run(),/offline/);assert.equal(retry.running,null);fail=false;await retry.run();assert.equal(renders,2);
});
