import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = process.cwd();
assert.equal(root, 'C:\\Codex\\TravelManager_3');
const env = Object.fromEntries(fs.readFileSync('.env.test.local', 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
const base = 'https://cslludzuejkhsydqiabx.supabase.co';
const apiKey = fs.readFileSync('public/src/supabaseClient.js', 'utf8').match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
assert.ok(apiKey, 'publishable key is configured');
const tripId = '11111111-1111-4111-8111-111111111100';
const creds = role => ({email: env[`SUPABASE_TEST_${role.toUpperCase()}_EMAIL`], password: env[`SUPABASE_TEST_${role.toUpperCase()}_PASSWORD`]});
const json = async (res) => { const body = await res.json().catch(() => null); return {res, body}; };
async function login(role) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {method:'POST', headers:{apikey:apiKey,'content-type':'application/json'}, body:JSON.stringify(creds(role))});
  const {body} = await json(r); assert.equal(r.status, 200, `auth ${role}: ${r.status}`); return {role, userId: body.user.id, token: body.access_token};
}
async function rest(session, table, {method='GET', query='', body, prefer='return=representation'}={}) {
  const headers = {apikey:apiKey, authorization:session?.token ? `Bearer ${session.token}` : `Bearer ${apiKey}`};
  if (body !== undefined) { headers['content-type']='application/json'; headers.prefer=prefer; }
  return json(await fetch(`${base}/rest/v1/${table}${query}`, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)}));
}
async function rpc(session, name, args) {
  const r = await fetch(`${base}/rest/v1/rpc/${name}`, {method:'POST', headers:{apikey:apiKey,authorization:`Bearer ${session.token}`,'content-type':'application/json'}, body:JSON.stringify(args)});
  return json(r);
}
const denied = status => [401, 403, 404, 405, 409, 425].includes(status) || status >= 400;

test('TM3-108 direct Supabase photo metadata, RLS, chat and idempotency', async () => {
  const [admin, traveler, viewer, outsider] = await Promise.all(['admin','traveler','viewer','outsider'].map(login));
  const members = await rest(admin, 'av_trip_memberships', {query:`?trip_id=eq.${tripId}&select=user_id,role,permissions,status`});
  assert.equal(members.res.status, 200, 'membership read');
  assert.ok(members.body.some(x => x.user_id === admin.userId), 'admin membership exists');

  const photoId = crypto.randomUUID(), operationId = crypto.randomUUID(), deviceId = `tm3-108-${photoId.slice(0,8)}`;
  const photo = {caption:'TM3-108 metadata QA', capturedAt:'2026-09-22T12:00:00.000Z', place:'Sandbox only', agendaItemId:'it-1', externalUrl:'https://example.invalid/tm3-108-photo', state:'EXTERNAL_REF', provider:'tm3-test', externalId:photoId};
  let r = await rpc(admin, 'av_apply_change_operation', {p_operation_id:operationId,p_trip_id:tripId,p_record_type:'PHOTO',p_record_id:photoId,p_action:'CREATE',p_base_version:0,p_changes:photo,p_user_id:admin.userId,p_device_id:deviceId});
  assert.equal(r.res.status, 200, `photo RPC ${r.res.status}`); assert.equal(r.body.status, 'APPLIED');
  r = await rest(admin, 'av_records', {query:`?record_id=eq.${photoId}&select=*`});
  assert.equal(r.res.status, 200); assert.equal(r.body[0].data.agendaItemId, 'it-1'); assert.equal(r.body[0].data.caption, photo.caption);
  const updateOp = crypto.randomUUID();
  r = await rpc(admin, 'av_apply_change_operation', {p_operation_id:updateOp,p_trip_id:tripId,p_record_type:'PHOTO',p_record_id:photoId,p_action:'UPDATE',p_base_version:1,p_changes:{caption:'TM3-108 updated'},p_user_id:admin.userId,p_device_id:deviceId});
  assert.equal(r.res.status, 200); assert.equal(r.body.status, 'APPLIED');
  const secondSession = await login('admin');
  r = await rest(secondSession, 'av_records', {query:`?record_id=eq.${photoId}&select=*`}); assert.equal(r.res.status, 200); assert.equal(r.body[0].data.caption, 'TM3-108 updated');
  r = await rest(viewer, 'av_records', {query:`?record_id=eq.${photoId}&select=record_id,data`}); assert.equal(r.res.status, 200); assert.equal(r.body.length, 1, 'member can read photo metadata');
  r = await rest(viewer, 'av_records', {method:'POST', body:{record_id:crypto.randomUUID(),trip_id:tripId,record_type:'PHOTO',data:{caption:'denied'}}}); assert.ok(denied(r.res.status) || !r.body?.length, `viewer write unexpectedly allowed: ${r.res.status}`);
  r = await rest(outsider, 'av_records', {query:`?record_id=eq.${photoId}&select=record_id`}); assert.equal(r.res.status, 200); assert.equal(r.body.length, 0, 'outsider cannot read photo metadata');
  r = await rest(outsider, 'av_records', {method:'POST', body:{record_id:crypto.randomUUID(),trip_id:tripId,record_type:'PHOTO',data:{caption:'denied'}}}); assert.ok(denied(r.res.status) || !r.body?.length, `outsider write unexpectedly allowed: ${r.res.status}`);
  r = await rest(null, 'av_records', {query:`?record_id=eq.${photoId}&select=record_id`}); assert.ok(r.res.status === 401 || (r.res.status === 200 && r.body.length === 0), 'anonymous cannot read photo metadata');
  const deleteOp = crypto.randomUUID();
  r = await rpc(admin, 'av_apply_change_operation', {p_operation_id:deleteOp,p_trip_id:tripId,p_record_type:'PHOTO',p_record_id:photoId,p_action:'DELETE',p_base_version:2,p_changes:{},p_user_id:admin.userId,p_device_id:deviceId}); assert.equal(r.res.status, 200); assert.equal(r.body.status, 'APPLIED');
  r = await rest(admin, 'av_records', {query:`?record_id=eq.${photoId}&select=deleted_at`}); assert.equal(r.res.status, 200); assert.ok(r.body[0].deleted_at, 'photo cleanup tombstone exists');

  const messageId = crypto.randomUUID(), message = {message_id:messageId,trip_id:tripId,conversation_id:'tm3-108-isolated',conversation_type:'GROUP',sender_user_id:traveler.userId,recipient_user_id:null,text:'TM3-108 isolated QA'};
  r = await rest(traveler, 'av_messages', {method:'POST',body:message}); assert.equal(r.res.status, 201, `chat member insert ${r.res.status}`);
  r = await rest(traveler, 'av_messages', {method:'POST',body:message}); assert.ok([403,409].includes(r.res.status), `chat duplicate was unexpectedly accepted: ${r.res.status}`);
  r = await rest(traveler, 'av_messages', {query:`?message_id=eq.${messageId}&select=*`}); assert.equal(r.res.status, 200); assert.equal(r.body.length, 1);
  r = await rest(admin, 'av_messages', {query:`?message_id=eq.${messageId}&select=*`}); assert.equal(r.res.status, 200); assert.equal(r.body.length, 1, 'second session reads one');
  r = await rest(outsider, 'av_messages', {query:`?message_id=eq.${messageId}&select=*`}); assert.equal(r.res.status, 200); assert.equal(r.body.length, 0, 'outsider cannot read chat');
  r = await rest(outsider, 'av_messages', {method:'POST',body:{...message,message_id:crypto.randomUUID(),sender_user_id:outsider.userId}}); assert.ok(denied(r.res.status) || !r.body?.length, `outsider chat write unexpectedly allowed: ${r.res.status}`);
  r = await rest(viewer, 'av_messages', {method:'POST',body:{...message,message_id:crypto.randomUUID(),sender_user_id:viewer.userId}}); assert.ok(denied(r.res.status) || !r.body?.length, `CanChat=false write unexpectedly allowed: ${r.res.status}`);
  r = await rest(outsider, 'av_messages', {method:'POST',body:{...message,message_id:crypto.randomUUID(),trip_id:'11111111-1111-4111-8111-111111111101',sender_user_id:outsider.userId,conversation_id:`direct:${tripId}:${outsider.userId}:${traveler.userId}`,conversation_type:'DIRECT'}}); assert.ok(denied(r.res.status) || !r.body?.length, `cross-trip DM unexpectedly allowed: ${r.res.status}`);
  // av_messages intentionally has no delete grant/policy; the isolated conversation keeps the QA row out of user chats.
  assert.equal(message.conversation_id, 'tm3-108-isolated');
});
