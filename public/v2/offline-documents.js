export const documentVersion=file=>file.version||file.md5Checksum||file.modifiedTime||null;
export class OfflineDocuments{
 constructor(store,google,storage=globalThis.navigator?.storage){Object.assign(this,{store,google,storage});}
 async available(files){const result=[];for(const f of files){const cached=await this.store.get('blobs',`drive:${f.id}`);if(cached?.blob)result.push(f.id);}return result;}
 async download(files,onProgress=()=>{},fullListing=false){if(this.running)return this.running;this.running=this.perform(files,onProgress,fullListing).finally(()=>this.running=null);return this.running;}
 async perform(files,onProgress,fullListing){let completed=0,downloaded=0;const unique=[...new Map(files.map(f=>[f.id,f])).values()],needed=[];for(const f of unique){const c=await this.store.get('blobs',`drive:${f.id}`);if(!c?.blob||!documentVersion(f)||c.version!==documentVersion(f))needed.push(f);}
 const estimate=await this.storage?.estimate?.().catch(()=>null),bytes=needed.reduce((n,f)=>n+Number(f.size||0),0);if(estimate&&bytes>estimate.quota-estimate.usage)throw Error('No hay espacio suficiente. Libera espacio en este dispositivo antes de descargar.');
 onProgress({completed,total:unique.length,downloaded});const failures=[];
 for(const file of unique){try{const key=`drive:${file.id}`,cached=await this.store.get('blobs',key);if(!cached?.blob||!documentVersion(file)||cached.version!==documentVersion(file)){const blob=await this.google.download(file);await this.store.put('blobs',{id:key,drive_file_id:file.id,modifiedTime:file.modifiedTime||null,version:documentVersion(file),mimeType:blob.type,downloaded_at:new Date().toISOString(),blob});downloaded++;}completed++;}catch(error){failures.push({id:file.id,message:error.message});}onProgress({completed,total:unique.length,downloaded,failures});}
 // Removed files remain recoverable until a complete authoritative listing confirms removal twice.
 const previous=(await this.store.get('meta','offline-doc-removal-candidates'))?.value||[],present=new Set(unique.map(f=>f.id)),candidates=[];if(fullListing&&!failures.length){for(const c of await this.store.all('blobs'))if(c.id.startsWith('drive:')&&!present.has(c.id.slice(6))){if(previous.includes(c.id))await this.store.transaction(['blobs'],tx=>tx.objectStore('blobs').delete(c.id));else candidates.push(c.id);}await this.store.put('meta',{id:'offline-doc-removal-candidates',value:candidates});}
 await this.store.put('meta',{id:'offline-doc-status',value:{completed,total:unique.length,downloaded,failures,updated_at:new Date().toISOString()}});return{completed,total:unique.length,downloaded,failures};
 }
}
