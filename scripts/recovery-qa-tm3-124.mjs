import { readFile } from 'node:fs/promises';
const env = Object.fromEntries((await readFile('.env.test.local', 'utf8')).split(/\r?\n/).filter(line => line && !line.trim().startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const key = (await readFile('public/src/supabaseClient.js', 'utf8')).match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
const response = await fetch('https://cslludzuejkhsydqiabx.supabase.co/auth/v1/recover', { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: env.SUPABASE_TEST_VIEWER_EMAIL, redirect_to: 'https://2110jrv.github.io/TravelManager_3/#reset-password' }) });
console.log(JSON.stringify({ status: response.status, success: response.ok }));
