import{readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync,existsSync}from'node:fs';import{resolve,join,relative}from'node:path';import{execFileSync}from'node:child_process';
const {TRIP,KINDS}=await import('../public/v2/config.js');
const root=resolve(import.meta.dirname,'..');if(process.cwd().toLowerCase()!==root.toLowerCase())throw Error('PROJECT_PATH_MISMATCH');const output=join(root,'.av2-private/staging-artifact');mkdirSync(output,{recursive:true});
function copy(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const source=join(dir,entry.name),rel=relative(join(root,'public'),source);if(entry.isDirectory())copy(source);else{const destination=join(output,rel);mkdirSync(resolve(destination,'..'),{recursive:true});copyFileSync(source,destination);}}}
copy(join(root,'public/v2'));for(const p of ['vendor/supabase-client.mjs','vendor/qrcode-generator.mjs','assets/tm3-icon-192.png','assets/tm3-icon-512.png','assets/tm3-apple-touch-icon.png']){const destination=join(output,p);mkdirSync(resolve(destination,'..'),{recursive:true});copyFileSync(join(root,'public',p),destination);}
const index=join(output,'v2/index.html');writeFileSync(index,readFileSync(index,'utf8').replace('<html lang="es">','<html lang="es" data-av2-staging="true">').replace('<head>','<head><meta name="robots" content="noindex,nofollow">').replace('<title>Italia 2026 · Agenda Viajera</title>','<title>Agenda Viajera 2.0</title>').replace('Tu itinerario de Italia, presupuesto y documentos, también sin conexión.','Agenda privada de viajes, también sin conexión.'));
const revision=execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();const sw=join(output,'v2/sw.js');writeFileSync(sw,readFileSync(sw,'utf8').replace(/av2-shell-local-first-157-ready/g,`av2-shell-staging-${revision}`));writeFileSync(join(output,'.nojekyll'),'');writeFileSync(join(output,'index.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./v2/"><a href="./v2/">Agenda Viajera 2.0</a>');
for(const forbidden of ['.av2-private','local-calendar','root-claim','.env','calendar.json'])if(existsSync(join(output,forbidden)))throw Error('PRIVATE_ARTIFACT');console.log('Isolated staging artifact prepared');

writeFileSync(join(output,'v2/config.js'),`export const TRIP=${JSON.stringify({id:TRIP.id,name:'Agenda Viajera',start:null,end:null,timezone:'UTC',travelers:[],currency:'USD',calendarId:'',drive:{}})};
export const KINDS=${JSON.stringify(KINDS)};
`);
execFileSync(process.execPath,['--check',join(output,'v2/config.js')]);
writeFileSync(join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
const landing=join(output,'index.html');writeFileSync(landing,readFileSync(landing,'utf8').replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="robots" content="noindex,nofollow">'));
