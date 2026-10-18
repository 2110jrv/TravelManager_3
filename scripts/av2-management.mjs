import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const PROJECT='cslludzuejkhsydqiabx';
export const ROOT=resolve(import.meta.dirname,'..');
export const quote=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
export function assertRoot(){if(process.cwd().toLowerCase()!==ROOT.toLowerCase())throw Error('PROJECT_PATH_MISMATCH');if(readFileSync(join(ROOT,'supabase/.temp/project-ref'),'utf8').trim()!==PROJECT)throw Error('SUPABASE_PROJECT_MISMATCH');}
export function query(sql){
  assertRoot();const dir=join(ROOT,'.av2-private/queries');mkdirSync(dir,{recursive:true});const path=join(dir,`${randomUUID()}.sql`);writeFileSync(path,sql);
  try{
    const cli=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
    const result=spawnSync(process.execPath,[cli,'--yes','--cache',join(ROOT,'.av2-private/npm-cache'),'supabase@2.119.0','db','query','--linked','--file',path,'--output','json'],{cwd:ROOT,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    if(result.status!==0) {const code=String(result.stderr).match(/(?:AV2_[A-Z_]+|Access token not provided|permission denied|syntax error[^\n]*)/)?.[0]||'MANAGEMENT_QUERY_FAILED';throw Error(code);}
    const start=result.stdout.indexOf('{');const data=JSON.parse(result.stdout.slice(start));return data.rows||[];
  }finally{unlinkSync(path);}
}
export function privateJson(name,value){const dir=join(ROOT,'.av2-private');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),JSON.stringify(value,null,2));}
