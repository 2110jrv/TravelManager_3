import { build } from 'esbuild';

await build({
  entryPoints: ['public/src/supabase-browser-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  outfile: 'public/vendor/supabase-client.mjs',
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
});
