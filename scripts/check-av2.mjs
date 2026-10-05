import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'public/v2');
for(const file of readdirSync(dir).filter(x=>x.endsWith('.js'))) {
  const path=resolve(dir,file),source=readFileSync(path,'utf8');execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
  assert.ok(!/service_role|deleteDatabase|\.clear\(\)/.test(source)||file==='store.js',`${file}: forbidden credential or destructive storage operation`);
  for(const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) assert.ok(existsSync(resolve(dirname(path),match[1])),`missing import ${match[1]}`);
}
const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.webmanifest'),'utf8'));
assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons) { const path=resolve(dir,icon.src);assert.ok(existsSync(path));const bytes=readFileSync(path);const size=Number(icon.sizes.split('x')[0]);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size); }
const worker=readFileSync(resolve(dir,'sw.js'),'utf8');assert.match(worker,/name\.startsWith\('av2-shell-'/);assert.ok(!worker.includes('indexedDB'));
for(const match of worker.matchAll(/'((?:\.\/|\.\.\/)[^']+)'/g)) {const path=resolve(dir,match[1]);assert.ok(existsSync(path),`missing offline asset ${path}`);}
if(process.argv.includes('--build')) await build({entryPoints:[resolve(dir,'app.js')],bundle:true,format:'esm',platform:'browser',target:['es2022'],write:false,logLevel:'warning'});
console.log(`v2 syntax/import lint + PWA checks${process.argv.includes('--build')?' + browser bundle build':''}: passed`);
