import { mkdir, readFile, writeFile } from 'node:fs/promises';

const env = Object.fromEntries((await readFile('.env.test.local', 'utf8')).split(/\r?\n/).filter(line => line && !line.trim().startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const url = 'https://cslludzuejkhsydqiabx.supabase.co';
const key = (await readFile('public/src/supabaseClient.js', 'utf8')).match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
const tripId = '1aafae82-4ff7-423b-ade2-25170e8b0dd4';
const accounts = { admin: 'SUPABASE_TEST_ADMIN', traveler: 'SUPABASE_TEST_TRAVELER', viewer: 'SUPABASE_TEST_VIEWER', outsider: 'SUPABASE_TEST_OUTSIDER' };
const expected = { admin: 'ADMIN', traveler: 'TRAVELER', viewer: 'VIEWER' };
const permissions = { ADMIN: { CanChat: true, CanEditAgenda: true, CanViewDocuments: true, CanResolveConflicts: true }, TRAVELER: { CanChat: true, CanEditAgenda: true, CanViewDocuments: true, CanResolveConflicts: false }, VIEWER: { CanChat: false, CanEditAgenda: false, CanViewDocuments: true, CanResolveConflicts: false } };

async function body(response) { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return text; } }
async function login(prefix) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: env[`${prefix}_EMAIL`], password: env[`${prefix}_PASSWORD`] }) });
  const data = await body(response); if (!response.ok) throw Error(`login failed for ${prefix} (${response.status})`); return data;
}
async function api(token, path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }, body: options.body && JSON.stringify(options.body) });
  const data = await body(response); if (!response.ok) throw Error(`${response.status} ${path}: ${JSON.stringify(data)}`); return data;
}

const sessions = {}; for (const [role, prefix] of Object.entries(accounts)) sessions[role] = await login(prefix);
const userIds = Object.fromEntries(Object.entries(sessions).map(([role, session]) => [role, session.user.id]));
const adminToken = sessions.admin.access_token;
const rows = await api(adminToken, `av_trip_memberships?trip_id=eq.${tripId}&select=*`);
const before = Object.fromEntries(Object.entries(userIds).map(([role, userId]) => [role, { userId, membership: rows.find(row => row.user_id === userId) || null }]));
await mkdir('tmp', { recursive: true }); await writeFile('tmp/before-role-qa-memberships.json', JSON.stringify({ tripId, capturedAt: new Date().toISOString(), memberships: before }, null, 2));

for (const [role, userId] of Object.entries(userIds)) {
  const current = before[role].membership;
  if (role === 'outsider') {
    if (current && current.status !== 'INACTIVE') await api(adminToken, `av_trip_memberships?trip_id=eq.${tripId}&user_id=eq.${userId}`, { method: 'PATCH', body: { status: 'INACTIVE' } });
    continue;
  }
  const patch = { role: expected[role], status: 'ACTIVE', permissions: current?.permissions || permissions[expected[role]] };
  if (current) {
    if (current.role !== patch.role || current.status !== patch.status) await api(adminToken, `av_trip_memberships?trip_id=eq.${tripId}&user_id=eq.${userId}`, { method: 'PATCH', body: patch });
  } else await api(adminToken, 'av_trip_memberships', { method: 'POST', body: { trip_id: tripId, user_id: userId, ...patch } });
}

const afterRows = await api(adminToken, `av_trip_memberships?trip_id=eq.${tripId}&select=*`);
const after = Object.fromEntries(Object.entries(userIds).map(([role, userId]) => [role, { userId, membership: afterRows.find(row => row.user_id === userId) || null }]));
await writeFile('tmp/after-role-qa-memberships.json', JSON.stringify({ tripId, capturedAt: new Date().toISOString(), memberships: after }, null, 2));
console.log(JSON.stringify({ tripId, before, after, duplicates: Object.values(after).some(({ membership }) => membership && afterRows.filter(row => row.user_id === membership.user_id).length > 1) }, null, 2));
