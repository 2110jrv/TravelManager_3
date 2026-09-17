import {platformRepository} from '../services/localPlatform.js';
export async function requestRestore(deviceId){const reason=prompt('Nota explicativa obligatoria');if(reason)await (await platformRepository()).createRestoreRequest({deviceId,reason});}
