import {SupabaseRemoteSyncAdapter} from '../sync/SupabaseRemoteSyncAdapter.js';
import {patchAppState} from '../app/appState.js';
const adapter=new SupabaseRemoteSyncAdapter({deviceId:localStorage.getItem('agenda-viajera.device'),userId:localStorage.getItem('agenda-viajera.user')});
export async function loadAdminDevices(){const devices=await adapter.listDevices();patchAppState({devices});return devices;}
export async function handleAdminDeviceAction(element){const card=element.closest('[data-device-id]');if(!card)return;const id=card.dataset.deviceId,action=element.dataset.action;if(['device-trust','device-block','device-revoke'].includes(action))await adapter.updateDevice(id,{state:{'device-trust':'TRUSTED','device-block':'BLOCK','device-revoke':'REVOKED'}[action]});return loadAdminDevices();}
