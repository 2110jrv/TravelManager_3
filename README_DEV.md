# Agenda Viajera · desarrollo

Instalar dependencias con `npm install` y arrancar con `npm start`.

Validación rápida: `npm run test:smoke`.

Suite Chromium: `npm run test:e2e`. Playwright inicia un servidor local en el puerto 5003.

El core usa IndexedDB `agenda-viajera-core`, versión 3, con stores por dominio. Para resetear la demo, borrar la base desde DevTools → Application → IndexedDB; no se borran datos de Supabase.

El shell PWA se cachea mediante `agenda-viajera-shell-v1`. Documentos privados simulados permanecen en IndexedDB y no en Cache Storage.
