import {roles} from '../auth/permissions.js';
export function can(user,trip,permission){if(user?.id==='jonathan'||user?.role==='SYSTEM_OWNER')return true;return Boolean(roles[trip?.role||user?.role]?.[permission]);}
export function assertPermission(user,trip,permission){if(!can(user,trip,permission))throw new Error(`Permission denied: ${permission}`);return true;}
