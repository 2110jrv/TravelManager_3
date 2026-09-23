import { readFile } from 'node:fs/promises';

const env = Object.fromEntries((await readFile('.env.test.local', 'utf8')).split(/\r?\n/).filter(line => line && !line.trim().startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const url = 'https://cslludzuejkhsydqiabx.supabase.co';
const key = (await readFile('public/src/supabaseClient.js', 'utf8')).match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
const tripId = '1aafae82-4ff7-423b-ade2-25170e8b0dd4';
const accounts = { admin: 'SUPABASE_TEST_ADMIN', traveler: 'SUPABASE_TEST_TRAVELER', viewer: 'SUPABASE_TEST_VIEWER', outsider: 'SUPABASE_TEST_OUTSIDER' };
async function json(response) { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return text; } }
async function login(prefix) { const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: env[`${prefix}_EMAIL`], password: env[`${prefix}_PASSWORD`] }) }); const data = await json(response); if (!response.ok) throw Error(`login ${prefix} ${response.status}`); return data; }
async function rest(token, path, options = {}) { const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }, body: options.body && JSON.stringify(options.body) }); return { status: response.status, data: await json(response) }; }
const sessions = {}; for (const [role, prefix] of Object.entries(accounts)) sessions[role] = await login(prefix);
const reads = {}; for (const [role, session] of Object.entries(sessions)) { const trip = await rest(session.access_token, `av_trips?id=eq.${tripId}&select=id,name`); const records = await rest(session.access_token, `av_records?trip_id=eq.${tripId}&select=record_id&deleted_at=is.null`); reads[role] = { tripStatus: trip.status, tripCount: Array.isArray(trip.data) ? trip.data.length : 0, recordStatus: records.status, recordCount: Array.isArray(records.data) ? records.data.length : 0 }; }
const memberships = await rest(sessions.admin.access_token, `av_trip_memberships?trip_id=eq.${tripId}&select=user_id,role,status`);
const viewerId = sessions.viewer.user.id;
const functionResponse = await fetch(`${url}/functions/v1/admin-user-management`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${sessions.admin.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update_role', tripId, userId: viewerId, role: 'VIEWER' }) });
const functionBody = await json(functionResponse);
console.log(JSON.stringify({ reads, memberships: memberships.data, adminFunction: { status: functionResponse.status, body: functionBody } }, null, 2));
