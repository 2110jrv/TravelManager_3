import {createClient} from 'npm:@supabase/supabase-js@2.117.0';
import {credentialCipher} from '../av2-google-token/lifecycle.js';
import {createRemoteHandler} from './handler.js';
Deno.serve(createRemoteHandler({
 url:Deno.env.get('SUPABASE_URL')!,anon:Deno.env.get('SUPABASE_ANON_KEY')!,
 serviceRoleKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,createClient,
 cipher:()=>credentialCipher(Deno.env.get('AV2_REMOTE_ENCRYPTION_KEY'))
}));
