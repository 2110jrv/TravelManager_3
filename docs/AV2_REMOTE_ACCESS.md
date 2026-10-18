# Agenda Viajera V2 — TM3-ACCESO-REMOTO-022

Revisión de seguridad: TM3-ACCESO-REMOTO-024. No aplicar migraciones ni desplegar API/MCP hasta nueva autorización explícita. PR #1 permanece en borrador, sin fusionar.

Estado: implementación preparada; API/MCP NO desplegados. La revisión anterior de la migración pasó una transacción real con rollback; la revisión de seguridad actual se valida únicamente en PostgreSQL local PGlite. La aplicación persistente fue rechazada por revisión automática y el propietario ordenó expresamente no ejecutarla todavía. No se creó el pin remoto de prueba ni se modificaron datos del viaje. Antes de ejecutar la API: autorizar y aplicar exclusivamente `20261018190000_av2_remote_content.sql`, provisionar `AV2_REMOTE_ENCRYPTION_KEY` exclusivamente en servidor y desplegar la función; luego probar guardado/sync/reversión real antes de activar OAuth o publicar la interfaz de consentimiento. El workflow staging está preparado en `deploy/`, todavía no instalado en el repositorio staging.

## Arquitectura comprobada

Fuente: `2110jrv/TravelManager_3`, rama estable Cloud `codex/v2-cloud-stable`, código `public/v2`. Incluye `codex/v2-remote-022` y sus correcciones `d746aee`. `main` (`53e4ae5`) conserva el app antiguo; su workflow `deploy-pages.yml` publica `public/` al recibir push. No fusionar PR #1 ni cambiar main o la rama predeterminada para preparar Cloud.

Staging independiente: `2110jrv/agenda-viajera-v2-staging`, URL https://2110jrv.github.io/agenda-viajera-v2-staging/v2/. El artefacto lo generan `scripts/av2-staging-build.mjs` y `av2-staging-audit.mjs`; la configuración privada llega después de autenticar. `v2/build.json` identifica el commit fuente servido.

Supabase: `cslludzuejkhsydqiabx`. Las tablas V2 son `av2_*`; las tablas históricas `av_*` no alimentan esta interfaz. Pins: `av2_places_of_interest`, UUID estable, `poi_code` inmutable; notas `description`, categoría `label`, coordenadas `lat/lng`. Guías: `av2_records`, kind `app_settings`, tipo `place_guide`, unión `data.place_id`; narración `data.guide.audio_guide`. Geometrías en `guide.geo`; rutas y plantillas en tipos `travel_network` y `travel_journey`.

Google Calendar sigue siendo canónico para eventos y reservas. `av2-google-token` conserva lectura y edición existentes. Esta API solo expone lectura de Calendar; no altera los 43 eventos.

IndexedDB LocalStore: `agenda-viajera-v2`, stores `records/events/outbox/conflicts/meta/blobs`. GPS/Replay: `av2-travel-v1:<trip>:<installation>:<user>`, stores `points/segments/meta/progress/features/gaps/reconstructions/networks`. Los recorridos y Casa capturada son locales; una API del servidor no puede consultarlos desde otro teléfono.

Sync usa SupabaseRemote/SyncEngine y RPC `av2_sync_pull`, `av2_sync_places`, `av2_sync_apply`, `av2_place_apply`, `av2_sync_day_pins`, `av2_day_pin_apply`. No se vacía IndexedDB para resolver conflictos. Usuarios/roles: `av2_app_users`; instalación y sesión: `av2_user_devices`, `av2_install_sessions`, `av2_devices`. ADMIN/TRAVELER editan; VIEWER consulta. Se validan sesión Supabase técnica, dispositivo autorizado, actor y versión del PIN.

La API reutiliza esos RPC y `av2_schedule_access`. Historial adicional append-only: `av2_remote_history`; auditoría existente: `av2_audit_log`. RLS bloquea acceso directo al historial y `av2_remote_grants`. Las concesiones OAuth cifradas están vinculadas a usuario, cliente, viaje, actor y dispositivo, con caducidad máxima de 30 días y revocación. La nueva variable `AV2_REMOTE_ENCRYPTION_KEY` es exclusivamente de servidor; no se publica ninguna clave administrativa.

## Flujo Cloud sin PC encendida

TM3-CLOUD-SINCRONIZACION-028: el propietario confirmó disponible/publicado el entorno **Mis Proyectos - Codex Cloud**. Su tarea `work` abrió main antiguo; esa copia no es V2. La rama recomendada es `codex/v2-cloud-stable`. No se ha comprobado todavía una tarea Cloud ejecutando esa rama.

En Settings > Codex Cloud > Environments, editar ese entorno y preparar el repositorio `2110jrv/TravelManager_3` con la rama estable. Si la interfaz ofrece selector de rama/revisión, elegir `codex/v2-cloud-stable`; si no, usar los comandos siguientes durante la preparación. Republish y abrir **una tarea nueva** en ese entorno desde el celular; reabrir `work` puede conservar su copia antigua.

En el checkout Linux del repositorio (no en Windows), después de comprobar origin y árbol limpio:

```bash
pwd
git remote get-url origin
git status --short
git fetch origin refs/heads/codex/v2-cloud-stable:refs/remotes/origin/codex/v2-cloud-stable
git switch -c codex/cloud-028 origin/codex/v2-cloud-stable
git rev-parse HEAD
git merge-base --is-ancestor d746aee98a22f465cfd51d59764b6026b435738f HEAD
git ls-files --error-unmatch public/v2/app.js public/v2/travel-audio.js public/v2/travel-gps.js public/v2/travel-replay.js
npm ci
npm run build:v2
npm run test:v2
npm run test:v2:remote-content
```

Usar un nombre de tarea nuevo si `codex/cloud-028` ya existe. No usar reset --hard, clean ni switch -C para arreglar una copia con cambios. Una rama local llamada `work` es aceptable solo si su SHA/ascendencia y archivos corresponden a V2; el nombre por sí solo no demuestra qué fuente cargó Cloud.

### Si falla el proxy o fetch

Verificar el destino y el acceso del entorno; mantener su proxy y certificados configurados. Permitir solo los hosts necesarios (`github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`; añadir el host exacto de una descarga si falla). Guardar, comprobar, Republish y probar en una tarea nueva. No quitar el proxy ni desactivar TLS. [OpenAI Docs](https://learn.chatgpt.com/docs/environments/cloud-environments).

```bash
curl --head --connect-timeout 15 --max-time 30 https://github.com
git ls-remote --heads origin codex/v2-cloud-stable
npm ping --registry=https://registry.npmjs.org
```

No imprimir variables proxy, encabezados de autorización ni salida de `git credential`. Si un cliente tiene una configuración local obsoleta, corregirla con el proxy aprobado del entorno; no hacer unset global ni usar --noproxy, http.sslVerify=false o NODE_TLS_REJECT_UNAUTHORIZED=0. Un 407 requiere revisar autenticación del proxy/entorno; 401/403 de GitHub exige revisar la conexión GitHub y sus permisos; DNS, timeout o conexión rechazada al proxy requieren revisar su disponibilidad/configuración y volver a preparar el entorno. Si GitHub permite lectura pero falla el proxy de git, probar el conector GitHub para leer la revisión; eso no actualiza el checkout ni demuestra que las pruebas se ejecutaron sobre V2. Si el servicio sigue caído, conservar el trabajo y reportar host/código sin secretos; no continuar editando main viejo.

Procedimiento del checkout Linux, una vez disponible el entorno Cloud en la cuenta:

1. Conectar GitHub y seleccionar exclusivamente `2110jrv/TravelManager_3` al crear el entorno. No copiar `.av2-private`, adjuntos ni credenciales de Windows. Preparar Node 22 y acceso de instalación npm; publicar el entorno para seleccionarlo desde el celular.
2. Comprobar `pwd`, `git remote get-url origin`, `git branch --show-current` y `git status --short`. Detenerse si origin no es este repositorio o hay cambios ajenos. La excepción Linux de AGENTS.md no autoriza otros repositorios.
3. Crear cada rama de tarea desde `origin/codex/v2-cloud-stable` como en los comandos anteriores. Nunca trabajar sobre main ni fusionar PR #1 para preparar el entorno.
4. Ejecutar `npm ci`, `npm run build:v2`, `npm run test:v2`, `npm run test:v2:remote-content` y `git diff --check`. Implementar únicamente la tarea y repetir las pruebas afectadas. Guardar/push en la rama de tarea y abrir un PR hacia `codex/v2-cloud-stable`; revisar CI y diff antes de integrar a esa rama.
5. El primer trabajo Cloud debe informar SHA, rama, origin, los cuatro archivos requeridos y resultados. La cuenta ya tiene entorno disponible según el propietario; falta comprobar su checkout V2. GitHub Actions valida la rama estable en un runner limpio sin depender de esta PC.
6. Publicación staging posterior: instalar el workflow preparado únicamente en el repositorio staging y configurar sus Pages para Actions con autorización. Ejecutar primero `dry_run=true` con el SHA completo aprobado; publicar solo con autorización staging, `dry_run=false` y `approve_staging=true`. No utilizar el workflow main del repositorio fuente. Para rollback, elegir un SHA anterior que incluya los scripts requeridos y repetir validación y aprobación. No revertir datos ni forzar ramas.

Fuente: https://learn.chatgpt.com/docs/environments/cloud-environments

El workflow `deploy/av2-staging-pages.yml` se instala en `.github/workflows/` del repositorio de staging. Publica un SHA fuente explícito con GitHub Pages Actions, sin PAT permanente. Revisar CI y SHA antes de aprobar staging. Revertir código significa publicar un SHA fuente anterior validado con el mismo workflow; no usar force push ni revertir datos. `dry_run` solo valida un artefacto, no es una reversión pública ejecutada.

## API y operaciones

POST `https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content/api`, con Bearer de sesión Supabase y JSON `{tool,arguments,credentials}`. Las credenciales `p_trip/p_device/p_token` proceden de una instalación autorizada; nunca se piden ni pegan en el chat ni en URLs.

Lecturas: `list_places/get_place/get_audio_guide/get_place_guide/get_place_notes/get_itinerary/get_sync_status/list_zones/list_routes/list_travel_records`. Listas paginadas `limit/after`; GPS local no se presenta como dato remoto disponible.

Escrituras: `create_place/update_audio_guide/update_place_guide/update_place_notes/update_place_metadata/rollback_content`. Exigen UUID exacto, `expected_version`, UUID `request_id` idempotente y patch permitido. Audio cambia solo la narración; investigación preserva narración y geometrías; notas cambian solo description. Las coordenadas públicas requieren confirmación y URL HTTPS. Casa queda excluida. No hay borrado ni escritura Calendar.

Ante conflicto, releer y resolver; no reintentar con versión nueva sin revisar la edición concurrente. `rollback_content` usa history_id y la versión resultante todavía vigente; no pisa cambios posteriores ni revierte creaciones mediante borrado.

## Cambios persistentes propuestos por la migración (NO aplicada)

`20261018190000_av2_remote_content.sql` crea tres tablas con RLS: `av2_remote_history` (historial inmutable con campos modificados), `av2_remote_grants` (concesiones cifradas y limitadas), y `av2_remote_private_places` (restricción persistente por UUID/viaje). Ninguna permite acceso directo de anon/authenticated; las concesiones y restricciones solo se administran en servidor. No se conceden permisos OAuth ni se modifica su configuración al aplicar SQL.

La restricción privada se inicializa a partir de indicadores existentes y nombres de domicilio; no cambia los pins ni las guías originales. Dos triggers posteriores a INSERT/UPDATE recuerdan indicadores privados de pins/guías por ID, incluso si una sincronización posterior renombra el pin o elimina el indicador. La API no permite quitar esa restricción, cambiar identidad, crear lugares privados ni alterar los campos de privacidad. Son indicadores explícitos `private/is_private`, `visibility/ privacy` private/restricted, `permissions.remote_access=false` y `guide.geo.private`; las variantes Unicode, acentos, puntuación y nombres compuestos de Casa/Home/Hogar/Domicilio/Residencia son una defensa adicional conservadora. Un falso positivo requiere revisión autorizada en servidor; no se sortea cambiando el nombre.

Las funciones auxiliares y `av2_remote_private_place_ids` aplican el acceso existente por dispositivo/PIN. `av2_remote_content_write` valida versiones, rol, concesión OAuth cuando existe y campos permitidos antes de llamar a los RPC de sincronización existentes. Los helpers internos no se exponen a anon/authenticated. La creación exige un UUID de pin generado por el cliente y otro UUID de request, versión cero y nombre válido; asigna POI y versión inicial mediante el contrato existente, mantiene el lugar opcional y rechaza duplicados ambiguos/Google Place ID sin cambiar el registro existente. La corrección de priority se limita a esta transacción remota, con la misma versión y metadatos de sync.

Cada operación guarda solamente su lista de campos afectados. Rollback restaura o elimina exclusivamente esas claves, preserva el resto y exige que la versión resultante continúe vigente; si hubo una edición posterior se rechaza por conflicto. Revertir el primer audio deja una guía vacía válida, sin borrarla. Revertir la creación de un pin no está permitido, pues implicaría borrado.

Los tokens OAuth siempre resuelven su concesión vigente, tanto en MCP como en `/api`; no pueden reemplazarla enviando credenciales, aprobar otra concesión ni revocarla mediante los endpoints de sesión. `can_write` nunca supera la concesión ni el rol actual. SQL vuelve a verificar permisos de escritura, caducidad y revocación. Credenciales de dispositivo, Bearer y clave administrativa no se incluyen en respuestas ni en el historial; la concesión se cifra con AES-GCM y contexto usuario/cliente/viaje.

Validación nueva exclusivamente local: migraciones reales en PGlite, integridad de registros preexistentes, creación/duplicados/versiones, cuatro modalidades de rollback, RPC/HTTP OAuth, cifrado y motor real de sync con caché de prueba. No equivale a desplegar ni a verificar el Motorola o ChatGPT en vivo. Calendar y las 288 guías anteriores no se escriben durante esta revisión.

## Siguiente etapa registrada: JSON por pin (sin implementar ahora)

Después de asegurar y conectar el acceso remoto, añadir Copiar JSON/Importar JSON en detalles. Exportar ID estable, nombre, dirección, coordenadas, categoría, descripción/notas, guía, audio y metadatos autorizados. Modalidad IA excluye datos privados e internos sensibles; modalidad completa exige advertencia de privacidad. Ninguna exporta contraseñas, tokens, secretos ni claves administrativas.

Importación: validar sintaxis/esquema, identidad inmutable, allowlist de campos, tipos, permisos y versión; mostrar diferencias y seleccionar campos individuales antes de guardar. Ausentes no borran valores. Campos privados protegidos requieren autorización explícita. Registrar historial, permitir reversión con conflictos/versiones y comprobar sincronización con Motorola. No se añade UI, importador ni exportador en esta etapa.

## Conectar ChatGPT

MCP: `https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content`. Solo su subruta `/.well-known/oauth-protected-resource` es pública. Cada operación MCP exige auth.getUser, concesión vigente y los controles de dispositivo/PIN/rol existentes. `verify_jwt=false` solo permite que el descubrimiento OAuth llegue al handler; no permite herramientas anónimas ni modifica otras funciones.

Faltan pasos de autorización/configuración que no deben darse por hechos:

1. OAuth Server de Supabase está desactivado y Site URL apunta a localhost. Supabase combina Site URL y Authorization Path. Revisar los retornos existentes antes de cambiar ese ajuste global; esta tarea no cambia silenciosamente la autorización Google.
2. Preparar un cliente OAuth con el callback exacto mostrado por ChatGPT y PKCE; no inventar el callback ni activar registro dinámico innecesariamente.
3. Consentimiento en `v2/oauth.html`, usando la sesión existente de Agenda. El propietario revisa el cliente y decide si concede escritura. No se autoriza automáticamente.
4. Crear la conexión MCP en Apps/Connectors de ChatGPT y completar OAuth, si la cuenta lo permite. La creación de una API no prueba esa conexión.
5. Desde un chat nuevo, consultar y modificar/revertir un pin privado de prueba; solo entonces declarar la conexión ChatGPT comprobada.

Revocación inmediata: POST autenticado `/revoke`, con credenciales de instalación y client_id; revocar también el cliente en OAuth. Fuentes: https://developers.openai.com/plugins/build/auth y https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication

## Validación física

Después de una edición remota, Motorola debe recibir el mismo texto/versión al pulsar Actualizar; comprobar cierre/reapertura y funcionamiento offline. Verificar el outbox y los conflictos sin borrar datos. Chromium y pruebas locales no sustituyen la comprobación física.
