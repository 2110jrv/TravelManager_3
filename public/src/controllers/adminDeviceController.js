import {MockRemoteSyncAdapter} from '../services/remoteSyncAdapter.js';
import {patchAppState} from './appState.js';
const adapter=new MockRemoteSyncAdapter();
export async function loadAdminDevices(){const devices=await adapter.call('/devices');patchAppState({devices});return devices;}
export async function handleAdminDeviceAction(element){const card=element.closest('[data-device-id]');if(!card)return;const id=card.dataset.deviceId,action=element.dataset.action;if(['device-trust','device-block','device-revoke'].includes(action))await adapter.updateDevice(id,{state:{'device-trust':'TRUSTED','device-block':'BLOCK','device-revoke':'REVOKED'}[action]});else await adapter.call(`/devices/${id}/commands`,{method:'POST',body:{command:action.replace('device-','').toUpperCase()}});return loadAdminDevices();}
