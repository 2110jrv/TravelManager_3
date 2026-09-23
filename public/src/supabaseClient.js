const SUPABASE_URL = 'https://cslludzuejkhsydqiabx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U';

import { createClient } from '../vendor/supabase-client.mjs';

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };

let clientPromise = null;

function createBrowserClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
}

export function getSupabaseClient() {
  if (!clientPromise) clientPromise = createBrowserClient();
  return clientPromise;
}

export async function getCurrentSession() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

export async function signUpWithEmailPassword(email, password) {
  const client = await getSupabaseClient();
  return client.auth.signUp({ email, password });
}

export async function signInWithEmailPassword(email, password) {
  const client = await getSupabaseClient();
  return client.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const client = await getSupabaseClient();
  return client.auth.signOut();
}

export async function onAuthStateChange(callback) {
  const client = await getSupabaseClient();
  return client.auth.onAuthStateChange(callback);
}
