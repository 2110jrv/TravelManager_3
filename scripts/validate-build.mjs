import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'public/index.html',
  'public/sw.js',
  'public/manifest.webmanifest',
  'public/src/app/main.js',
  'public/src/db/localRepository.js',
  'public/src/services/audit.js',
  'public/src/supabaseClient.js'
];
const missing = required.filter(path => !existsSync(resolve(root, path)));
const index = readFileSync(resolve(root, 'public/index.html'), 'utf8');
for (const route of ['./src/app/main.js', './styles/base.css', './styles/layout.css', './manifest.webmanifest']) {
  if (!index.includes(route)) missing.push(`public/index.html -> ${route}`);
}
if (missing.length) {
  console.error(`Static build validation failed:\n- ${missing.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Static build validation passed (${required.length} required files).`);
}
