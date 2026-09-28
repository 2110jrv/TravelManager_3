import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const env=Object.fromEntries(fs.readFileSync('.env.test.local','utf8').split(/\r?\n/).filter(Boolean).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}));
const url='https://cslludzuejkhsydqiabx.supabase.co';
const key='sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U';
const tripId='1aafae82-4ff7-423b-ade2-25170e8b0dd4';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function json(response){const data=await response.json();if(!response.ok)throw Error(`${response.status}: ${JSON.stringify(data)}`);return data;}
const session=await json(await fetch(`${url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({email:env.SUPABASE_TEST_ADMIN_EMAIL,password:env.SUPABASE_TEST_ADMIN_PASSWORD})}));
const headers={apikey:key,authorization:`Bearer ${session.access_token}`};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const sourceHash=hash(png),form=new FormData();
form.append('action','upload');form.append('tripId',tripId);form.append('date','2026-10-22');form.append('caption','TM3-275 binary integrity');form.append('location','QA');form.append('uploadKey',`tm3-275-integrity-${Date.now()}`);form.append('file',new File([png],'tm3-275-integrity.png',{type:'image/png'}),'tm3-275-integrity.png');
const uploaded=await json(await fetch(`${url}/functions/v1/dropbox-photo-storage`,{method:'POST',headers,body:form}));
assert.equal(uploaded.ok,true);assert.equal(uploaded.photo.size,png.byteLength);
const original=await json(await fetch(`${url}/functions/v1/dropbox-photo-storage`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'original',tripId,path:uploaded.photo.providerPath})}));
const downloaded=Buffer.from(original.original.data,'base64'),downloadedHash=hash(downloaded);
const result={source_size:png.byteLength,remote_size:uploaded.photo.size,source_sha256:sourceHash,downloaded_sha256:downloadedHash,match:sourceHash===downloadedHash,provider_file_id:uploaded.photo.providerFileId};
console.log(JSON.stringify(result));assert.equal(result.match,true);
