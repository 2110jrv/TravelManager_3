# Agenda Viajera 2.0: configuración Google y PC Casa

Proyecto autorizado: `C:\Codex\TravelManager_3`; Supabase: `cslludzuejkhsydqiabx`.

## Configuración única de Jonathan

1. En Google Cloud, habilitar **Google Calendar API** y **Google Drive API**.
2. Configurar la pantalla de consentimiento OAuth para Agenda Viajera. Mientras la aplicación esté en Testing, añadir las cuentas Google de Jonathan y Jenny como test users. Los teléfonos pueden usar esas mismas cuentas; cada instalación tiene una identidad y secreto independientes.
3. Crear un OAuth client de tipo **Web application**. Añadir este Authorized redirect URI:
   `https://cslludzuejkhsydqiabx.supabase.co/auth/v1/callback`
4. En Supabase Dashboard → Authentication → Sign In / Providers → Google, habilitar Google y guardar el Client ID y Client Secret. **El secreto solo se guarda en Supabase; nunca en la PWA, Git, screenshots o chat.**
5. En Authentication → URL Configuration, conservar Site URL y todos los redirects legacy. Añadir únicamente:
   - `http://127.0.0.1:5004/v2/`
   - `http://localhost:5004/v2/`
   - El URL HTTPS del preview aprobado cuando exista, incluyendo su ruta `/v2/`.
6. Abrir `http://127.0.0.1:5004/v2/#settings` en PC Casa, pulsar **Conectar Google**, elegir la cuenta propietaria `2110jrv@gmail.com`, y después **Activar PC Casa** en Dispositivos. La reclamación raíz privada dura 24 horas y se consume una sola vez. No enviarla a teléfonos.
7. En Dispositivos, configurar la clave administrativa e invitar cada teléfono. Cada enlace/QR caduca en 15 minutos y solo admite una instalación. Para móviles se necesita un origen HTTPS accesible desde el dispositivo; HTTP en una IP LAN no permite una PWA segura/instalable.

La configuración OAuth no se repite por dispositivo. Cada dispositivo autentica una cuenta Google autorizada y acepta el enlace temporal. Las cuentas de teléfono se vinculan al viaje al consumir una invitación válida; no se importa ningún registro legacy.

## Scopes

- `https://www.googleapis.com/auth/calendar.readonly`: lectura de Calendar, Labels y colores. No permite editar/eliminar eventos.
- `https://www.googleapis.com/auth/drive`: lectura de los documentos privados existentes y creación de recibos en el árbol ya existente, además de la acción explícita de enviar un documento a la papelera. No se exige acceso público. `drive.file` por sí solo no proporciona acceso a todos los archivos preexistentes del viaje; adoptar ese scope requeriría un flujo Google Picker adicional para otorgar acceso archivo por archivo.

El código limita listado, descarga y papelera al árbol Italia 2026 y sube recibos exclusivamente a Recibos. El acceso administrativo a Google Drive sigue siendo el de la cuenta Google; la revocación de un dispositivo Agenda bloquea las operaciones de la aplicación, pero no revoca la cuenta Google personal.

OAuth usa PKCE. El navegador recibe el token de acceso Google a través de Supabase; no recibe el client secret. Supabase renueva su propia sesión, pero **no renueva automáticamente el token del proveedor Google**. Cuando Google devuelve 401, la aplicación conserva la cola y solicita Conectar Google nuevamente. El consentimiento ya concedido puede reutilizarse; no se reconfigura Google Cloud. No se solicita ni almacena un refresh token Google en esta fase.

## Variables y secretos

- `AV2_OWNER_EMAIL=2110jrv@gmail.com`: solo para `node scripts/av2-remote.mjs provision-root`.
- `AV2_PREVIEW_PORT`: opcional; default `5004`.
- `AV2_TEST_FIXTURE=1`: exclusivamente servidor de pruebas. Habilita el endpoint de fixture; además el navegador requiere `?fixture=1`. Nunca habilitar en el preview normal.
- `AV2_REAL_FIXTURE=1`: ejecutar pruebas financieras específicas con el snapshot privado real.
- Client ID/Secret Google: configuración del proveedor Supabase, sin variables frontend.
- Token de gestión Supabase: usa el login existente del CLI; no copiarlo a archivos públicos.
- Secretos de dispositivo y claim raíz: `.av2-private/` o IndexedDB privado; nunca Git.

## Migraciones y comprobaciones

No ejecutar `supabase db push` sobre todas las migraciones del repositorio. Usar:

```powershell
node scripts/av2-remote.mjs inspect
node scripts/av2-remote.mjs dry-run
node scripts/av2-remote.mjs apply
$env:AV2_OWNER_EMAIL='2110jrv@gmail.com'
node scripts/av2-remote.mjs provision-root
npm run test:v2:remote
```

El script solo admite `20261005090000_agenda_viajera_v2.sql`, `20261005100000_av2_device_authorization.sql` y `20261005110000_av2_sync_validation.sql`, verifica el proyecto y ejecuta DDL transaccional. Las pruebas remotas crean un viaje QA av2 separado y dejan tombstones auditables; no alteran Italia 2026 ni tablas legacy.

No se ha publicado la PWA ni hecho push. Validar OAuth desde la PWA, Calendar/Labels/zonas horarias, Drive, recibo offline → reconnect → Drive, y la instalación Android real antes de declarar PASS.

Referencias oficiales: [Labels Google Calendar](https://developers.google.com/workspace/calendar/api/guides/labels), [Google con Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google), [tokens del proveedor](https://supabase.com/docs/guides/auth/social-login), [scopes Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
