import {MockRemoteSyncAdapter} from '../services/remoteSyncAdapter.js';
import {platformRepository} from '../services/localPlatform.js';
import {patchAppState} from '../app/appState.js';

const adapter=new MockRemoteSyncAdapter();
const canResolve=()=>['ADMIN','SYSTEM_OWNER'].includes(localStorage.getItem('agenda-viajera.role')||'ADMIN');
export async function loadConflicts(){const conflicts=await adapter.listConflicts({tripId:'trip-italy-2026'});patchAppState({conflicts,conflictCount:conflicts.filter(x=>x.status==='OPEN').length});return conflicts;}
export async function resolveConflict({conflictId,resolutionType,resolvedValue,resolutionNote}={}){if(!canResolve())throw Error('DENIED');const result=await adapter.resolveConflict({conflictId,resolutionType,resolvedValue,resolutionNote,resolverUserId:localStorage.getItem('agenda-viajera.user')||'jonathan',resolverDeviceId:localStorage.getItem('agenda-viajera.device')||'unknown',resolverRole:localStorage.getItem('agenda-viajera.role')||'ADMIN'});const repo=await platformRepository();if(result.canonical)await repo.applyCanonical(result.canonical);if(result.conflict)await repo.put('conflicts',{id:result.conflict.conflictId,...result.conflict});await loadConflicts();window.dispatchEvent(new CustomEvent('tm3-conflict-resolved',{detail:result}));return result;}
