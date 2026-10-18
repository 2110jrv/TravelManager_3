# Agenda Viajera V2 — TM3-ACCESO-REMOTO-022

Revisión de seguridad: TM3-ACCESO-REMOTO-024; preparación Cloud: TM3-ACCESO-CONTENIDO-031. No aplicar migraciones ni desplegar API/MCP hasta nueva autorización explícita. PR #1 permanece en borrador, sin fusionar.

Estado: implementación preparada; API/MCP NO desplegados. La revisión anterior de la migración pasó una transacción real con rollback; la revisión de seguridad actual se valida únicamente en PostgreSQL local PGlite. La aplicación persistente fue rechazada por revisión automática y el propietario ordenó expresamente no ejecutarla todavía. No se creó el pin remoto de prueba ni se modificaron datos del viaje. Antes de ejecutar la API: autorizar y aplicar, en orden, `20261018190000_av2_remote_content.sql` y `20261018200000_av2_remote_content_history.sql`, provisionar `AV2_REMOTE_ENCRYPTION_KEY` exclusivamente en servidor y desplegar la función; luego probar guardado/sync/reversión real antes de activar OAuth o publicar la interfaz de consentimiento. El workflow staging está preparado en `deploy/`, todavía no instalado en el repositorio staging.

## Arquitectura comprobada

Fuente: `2110jrv/TravelManager_3`, rama estable Cloud `codex/v2-cloud-stable`, código `public/v2`. Incluye `codex/v2-remote-022` y sus correcciones `d746aee`. `main` (`53e4ae5`) conserva el app antiguo; su workflow `deploy-pages.yml` publica `public/` al recibir push. No fusionar PR #1 ni cambiar main o la rama predeterminada para preparar Cloud.

Staging independiente: `2110jrv/agenda-viajera-v2-staging`, URL https://2110jrv.github.io/agenda-viajera-v2-staging/v2/. El artefacto lo generan `scripts/av2-staging-build.mjs` y `av2-staging-audit.mjs`; la configuración privada llega después de autenticar. `v2/build.json` identifica el commit fuente servido.

Supabase: `cslludzuejkhsydqiabx`. Las tablas V2 son `av2_*`; las tablas históricas `av_*` no alimentan esta interfaz. Pins: `av2_places_of_interest`, UUID estable, `poi_code` inmutable; notas `description`, categoría `label`, coordenadas `lat/lng`. Guías: `av2_records`, kind `app_settings`, tipo `place_guide`, unión `data.place_id`; narración `data.guide.audio_guide`. Geometrías en `guide.geo`; rutas y plantillas en tipos `travel_network` y `travel_journey`.

Google Calendar sigue siendo canónico para eventos y reservas. `av2-google-token` conserva lectura y edición existentes. La sesión directa conserva la lectura de Calendar existente. Las concesiones OAuth de contenido ahora excluyen Calendar, rutas y recorridos; no alteran eventos.

IndexedDB LocalStore: `agenda-viajera-v2`, stores `records/events/outbox/conflicts/meta/blobs`. GPS/Replay: `av2-travel-v1:<trip>:<installation>:<user>`, stores `points/segments/meta/progress/features/gaps/reconstructions/networks`. Los recorridos y Casa capturada son locales; una API del servidor no puede consultarlos desde otro teléfono.

Sync usa SupabaseRemote/SyncEngine y RPC `av2_sync_pull`, `av2_sync_places`, `av2_sync_apply`, `av2_place_apply`, `av2_sync_day_pins`, `av2_day_pin_apply`. No se vacía IndexedDB para resolver conflictos. Usuarios/roles: `av2_app_users`; instalación y sesión: `av2_user_devices`, `av2_install_sessions`, `av2_devices`. ADMIN/TRAVELER editan; VIEWER consulta. Se validan sesión Supabase técnica, dispositivo autorizado, actor y versión del PIN.

La API reutiliza esos RPC y `av2_schedule_access`. Historial adicional append-only: `av2_remote_history`; auditoría existente: `av2_audit_log`. RLS bloquea acceso directo al historial y `av2_remote_grants`. Las concesiones OAuth cifradas están vinculadas a usuario, cliente, viaje, actor y dispositivo, con caducidad máxima de 30 días y revocación. La nueva variable `AV2_REMOTE_ENCRYPTION_KEY` es exclusivamente de servidor; no se publica ninguna clave administrativa.

## Flujo Cloud sin PC encendida

TM3-CLOUD-SINCRONIZACION-028: el propietario confirmó disponible/publicado el entorno **Mis Proyectos - Codex Cloud**. Su tarea `work` abrió main antiguo; esa copia no es V2. La rama recomendada es `codex/v2-cloud-stable`. TM3-CLOUD-RAMA-030 verificó esa rama en Cloud, SHA `e1df83211f3a72f783e7f597215bdee07c1ddec6`, pruebas V2 y `push --dry-run`; no publicó cambios.

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

Lecturas: `list_places/get_place/get_audio_guide/get_place_guide/get_place_notes/list_content_history/get_itinerary/get_sync_status/list_zones/list_routes/list_travel_records`. Listas paginadas `limit/after`; GPS local no se presenta como dato remoto disponible.

Escrituras: `create_place/update_audio_guide/update_place_guide/update_place_notes/update_place_metadata/rollback_content`. Exigen UUID exacto, `expected_version`, UUID `request_id` idempotente y patch permitido. Audio cambia solo la narración; investigación preserva narración y geometrías; notas cambian solo description. En esta aplicación «descripción» y «Mis notas» designan ese mismo campo; no existen dos columnas independientes. Las coordenadas públicas requieren confirmación y URL HTTPS. Casa queda excluida. No hay borrado ni escritura Calendar.

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

1. La revisión previa registró OAuth Server desactivado y Site URL en localhost; esta tarea no consultó ni cambió esa configuración remota. Supabase combina Site URL y Authorization Path. Revisar los retornos existentes antes de cambiar ese ajuste global; esta tarea no cambia silenciosamente la autorización Google.
2. Preparar un cliente OAuth con el callback exacto mostrado por ChatGPT y PKCE; no inventar el callback ni activar registro dinámico innecesariamente.
3. Consentimiento en `v2/oauth.html`, usando la sesión existente de Agenda. El propietario revisa el cliente y decide si concede escritura. No se autoriza automáticamente.
4. Crear la conexión MCP en Apps/Connectors de ChatGPT y completar OAuth, si la cuenta lo permite. La creación de una API no prueba esa conexión.
5. Desde un chat nuevo, consultar y modificar/revertir un pin público de prueba sin información personal; solo entonces declarar la conexión ChatGPT comprobada.

Revocación inmediata: POST autenticado `/revoke`, con credenciales de instalación y client_id; revocar también el cliente en OAuth. Fuentes: https://developers.openai.com/plugins/build/auth y https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication

## Validación física

Después de una edición remota, Motorola debe recibir el mismo texto/versión al pulsar Actualizar; comprobar cierre/reapertura y funcionamiento offline. Verificar el outbox y los conflictos sin borrar datos. Chromium y pruebas locales no sustituyen la comprobación física.

## Preparación TM3-ACCESO-CONTENIDO-031

Ruta Cloud verificada: `/workspace/TravelManager_3`; base `codex/v2-cloud-stable`
SHA `e1df83211f3a72f783e7f597215bdee07c1ddec6`. No se aplicó SQL persistente,
no se activó OAuth ni se desplegó API, consentimiento, staging o producción.
Las pruebas SQL usan únicamente PGlite en memoria con fixtures sintéticos.

### Revisión de migraciones

`20261018190000_av2_remote_content.sql` conserva UUID, poi_code y registros
existentes. Añade tablas/RLS, concesiones cifradas, historial inmutable y triggers
que recuerdan pins privados aun después de renombrarlos. Escrituras: rol actual,
instalación/usuario/PIN, versión exacta, request_id idempotente y allowlist de
campos. Rollback restaura solo las claves modificadas y rechaza una versión posterior.
No contiene escritura Calendar ni borrado de pins. Sí crea objetos persistentes y
siembra la tabla de restricciones privadas: requiere autorización expresa.

`20261018200000_av2_remote_content_history.sql` es una migración adicional preparada,
NO aplicada. Añade `av2_remote_content_history`: consulta por pin con paginación,
validación de dispositivo y concesión OAuth vigente incluso para lectura, filtro
privado actual y persistente. Retorna exclusivamente history_id, place_id, tool,
changed_fields, record_id, result_version y created_at. Nunca devuelve los snapshots,
patches, tokens ni claves del historial. Rol VIEWER/concesión de lectura pueden
consultarlo; no pueden escribir. La paginación usa UUID, no orden cronológico;
created_at permite ordenar las entradas recibidas. Releer desde el comienzo para
un historial actualizado tras escrituras concurrentes.

### Alcance de la conexión ChatGPT

Las concesiones OAuth de contenido no anuncian ni ejecutan `get_itinerary`,
`list_routes` o `list_travel_records`, ni por MCP ni por `/api`. Esos payloads
podrían contener ubicaciones personales fuera de los filtros de pins. La sesión
directa de Agenda conserva sus operaciones existentes; no se conceden a ChatGPT.
El consentimiento muestra el alcance real: pins públicos autorizados, guías,
notas, historial y estado de sincronización. La escritura sigue siendo opcional.
Antes de activar, el propietario debe revisar que **toda ubicación personal**
esté marcada privada/restringida: un nombre neutro sin indicador de privacidad
no permite inferir automáticamente que el lugar es personal. No se inspeccionó
ni modificó ese inventario real en esta tarea.

### Secuencia de activación autorizada (pendiente; no ejecutar automáticamente)

1. **Aprobar destino y revisión.** El propietario debe elegir un entorno aislado de
   pruebas y aprobar explícitamente el SHA revisado, las dos migraciones anteriores,
   el despliegue de `av2-remote-content` y la publicación de `v2/oauth.html` en un
   origen autorizado. No usar `supabase db push` indiscriminado: comprobar primero
   el inventario de migraciones y aplicar solo las aprobadas. No habilitar producción
   en esta etapa. No modificar registros actuales para verificar la conexión.
2. **Secretos de servidor.** El administrador genera una clave aleatoria de 32 bytes
   codificada en base64 y configura `AV2_REMOTE_ENCRYPTION_KEY` mediante el gestor de
   secretos de Supabase. `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` son los bindings de servidor de Edge Functions.
   No copiarlos al repositorio, al navegador ni a ChatGPT. La clave pública del
   navegador no sustituye la clave de cifrado. Rotar la clave de cifrado exige
   revocar/reautorizar las concesiones cifradas con la anterior.
3. **Verificar backend aislado.** Desplegar únicamente la función aprobada, con
   `verify_jwt=false` solo para ella según `supabase/config.toml`. El handler conserva
   `auth.getUser()` obligatorio para toda operación. Probar descubrimiento público
   y 401 sin Bearer; después lectura, escritura, conflicto, historial, reversión y
   revocación con un pin sintético público nuevo y sin información personal.
4. **Preparar OAuth con revisión del propietario.** Comprobar el estado actual de
   Supabase Auth > OAuth Server y los callbacks Google existentes; la descripción
   anterior de localhost no es una observación en vivo. Aprobar por separado activar
   OAuth Server y cambiar Site URL/Authorization Path. El URL combinado debe abrir
   exactamente el `v2/oauth.html` publicado **en el mismo origen que Agenda**, con
   acceso a su sesión e IndexedDB. No usar localhost para el callback público ni
   trasladar secretos de instalación entre orígenes. Validar primero que Google
   sigue iniciando sesión correctamente.
5. **Registrar el cliente de ChatGPT.** En ChatGPT, si la cuenta/administrador permite
   apps MCP personalizadas, abrir Configuración > Apps/Conectores, habilitar el modo
   de desarrollador cuando se requiera y crear una app con autenticación OAuth y el
   URL MCP indicado abajo. Copiar el callback exacto que muestre ChatGPT; registrar
   ese URI, sin comodines, en el cliente OAuth de Supabase. Usar authorization code
   con PKCE S256; configurar el client ID y, solo si el cliente confidencial lo exige,
   su secret en la configuración segura de ChatGPT. Nunca en instrucciones de chat.
   No habilitar registro dinámico salvo que se apruebe expresamente y sea necesario.
   Si la cuenta no ofrece crear apps MCP, el administrador debe habilitarlo o
   proporcionar una cuenta compatible; crear una API por sí solo no crea una app.
6. **Completar consentimiento.** Conectar la app desde ChatGPT. En la página de
   Agenda revisar nombre/URI del cliente, iniciar sesión/PIN en ese mismo navegador
   y pulsar Volver a comprobar. Conceder primero solo lectura; para editar,
   el propietario debe marcar «Permitir también cambios de contenido» y pulsar
   «Autorizar este cliente». La concesión dura como máximo 30 días y sigue vinculada
   a viaje, actor y dispositivo. No requiere permisos de escritura Calendar.
7. **Aceptación desde un chat nuevo.** Seleccionar la app conectada. Ejecutar
   `list_places`, `get_place`, `get_place_notes`, `get_place_guide` y `get_audio_guide`.
   Verificar que un pin privado conocido no aparece ni permite acceso directo.
   Con una concesión de escritura aprobada, usar un pin sintético público: guardar
   una nota, audio y un campo de guía de forma independiente, conservando UUID y
   poi_code. Para cada llamada usar la versión devuelta por la lectura correspondiente
   y un UUID request_id nuevo. Ante 409, releer y revisar diferencias antes de decidir;
   no actualizar la versión automáticamente para forzar una escritura.
8. **Auditoría y reversión.** Consultar `list_content_history` con place_id. Usar
   history_id de la edición y la versión actual del registro para `rollback_content`.
   No reutilizar la versión del pin para una guía, ni borrar el pin de prueba mediante
   esta API. Comprobar sincronización en Motorola, cierre/reapertura y caché offline.
   Probar que la concesión de lectura no anuncia herramientas de escritura y que
   revocarla o revocar el dispositivo impide tanto lectura como escritura.
9. **Revocar y recuperar.** Desde la sesión autorizada de Agenda llamar `/revoke`
   mediante la aplicación con client_id; no pegar credenciales en el chat. Revocar
   también la autorización OAuth de ese cliente y desconectar la app en ChatGPT.
   Si OAuth falla después de guardar la concesión, revocarla antes de reintentar.
   Un fallo de pruebas no autoriza revertir datos existentes ni desplegar producción.

URL MCP preparado (no comprobado como desplegado en esta tarea):
`https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content`

Descubrimiento del recurso:
`https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content/.well-known/oauth-protected-resource`

Servidor de autorización previsto: `https://cslludzuejkhsydqiabx.supabase.co/auth/v1`.
Validar su metadata real tras habilitar OAuth; no inventar authorization/token endpoints.
Si se elige otro proyecto aislado, sustituir el dominio en la configuración aprobada
antes de conectar ChatGPT; no apuntar las pruebas al proyecto actual por defecto.

### Siguiente funcionalidad

Se mantiene pendiente **exportación/importación JSON por pin**: vista previa de
campos añadidos/cambiados, selección individual, UUID/poi_code inmutables,
validación de versión y permisos, campos ausentes preservados, historial/reversión
y exclusión de credenciales/ubicaciones personales. No implementada en esta tarea.

### Evidencia de validación Cloud (031)

| Comprobación | Resultado |
| --- | --- |
| `npm ci --cache /tmp/tm3-npm-cache --ignore-scripts --no-audit --no-fund` | Correcto; sin ejecutar hooks de instalación |
| `npm run build:v2` | Correcto; sintaxis, imports, PWA y bundle en memoria |
| `npm run test:v2` | 120 pasan, 0 fallan, 1 omitida por fixture privada ausente |
| `node --test --test-concurrency=2 tests/av2-*.test.mjs` | 202 pasan, 0 fallan, 1 omitida; incluye las pruebas SQL/HTTP remotas |
| `npm run test:v2:remote-content` tras el último cambio | 13 pasan, 0 fallan; SQL en memoria, OAuth HTTP, privacidad, historial, versiones, rollback y sync |
| Playwright, nueva suite `av2-oauth.integration.spec.mjs` | 5 pasan, 0 fallan; cliente escapado, lectura predeterminada, VIEWER, fallo/caducidad y rechazo |
| Playwright, 37 pruebas V2 anteriores | 21 pasan, 16 fallan en la primera ejecución con navegador instalado |
| Revisión de las dos pruebas inicialmente bloqueadas por directorio de perfiles | Reinicio de PIN pasa; reinicio de documentos falla en la aserción del login. Balance anterior actualizado: 22 pasan y 15 siguen fallando |
| 14 archivos de pruebas Node adicionales existentes | 51 pasan, 3 fallan, 1 omitida por snapshot privado ausente |
| `git diff --check`, `node --check` de content/handler | Correctos |

Los 15 fallos pendientes de navegador están en pruebas de presupuesto, actualización
Calendar simulada, login/documentos/mapa, persistencia offline, proveedor Google
simulado, expiración de transferencia, carrusel/gaps, shell móvil y service worker.
Los tres fallos Node adicionales son:

- `tests/data-quality-tm3-118.test.mjs`: falta `tmp/final-data-quality-report.json`.
- `tests/private-access-tm3-126.test.mjs`: contrato antiguo espera patrón de PIN de 4–6 dígitos.
- `tests/ui-admin-security-tm3-120.test.mjs`: contrato antiguo espera «Asignar PIN».

Se comprobó que el código de aplicación relacionado y esas pruebas no tienen
cambios respecto de la base estable. No se corrigieron funciones ajenas al acceso
remoto para ocultar estos resultados. No se realizó una ejecución comparativa
completa de navegador en otro checkout de la base; estos fallos requieren revisión
separada y no permiten declarar toda la aplicación aprobada.

El primer intento de Playwright no pudo iniciar Chromium por faltar su binario.
Se descargó en `work/tm3-031/browsers` y se repitió la suite; los resultados anteriores
corresponden a esa ejecución. Logs y artefactos son locales y no contienen
credenciales reales de despliegue; no forman parte del commit.

No ejecutadas: `test:v2:remote`, `test:v2:remote:browser`, pruebas Supabase/live y
validaciones administrativas remotas que escriben fixtures/estado persistente,
requieren credenciales no provistas o leen `.av2-private` como fuente de acceso.
No se buscó ni copió ninguna credencial de esa carpeta. Docker aislado tampoco se
ejecutó: la imagen requerida `public.ecr.aws/supabase/postgres:17.6.1.147` no está
instalada y su registry no está permitido en la política de red actual. No se
cambió la política ni se intentó sortearla. Las migraciones se comprobaron con
PostgreSQL PGlite desechable en memoria. Motorola y OAuth/MCP en ChatGPT real
siguen pendientes de la activación expresamente autorizada.
