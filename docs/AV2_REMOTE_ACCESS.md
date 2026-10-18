# Agenda Viajera V2 — TM3-ACCESO-REMOTO-022

Estado: implementación preparada y pruebas locales/CI aprobadas; API/MCP NO desplegados. La migración pasó una transacción real con rollback, pero la revisión automática rechazó su aplicación persistente a la base compartida por requerir autorización explícita adicional. No se creó el pin remoto de prueba ni se modificaron datos del viaje. Antes de ejecutar la API: autorizar y aplicar exclusivamente `20261018190000_av2_remote_content.sql`, provisionar `AV2_REMOTE_ENCRYPTION_KEY` exclusivamente en servidor y desplegar la función; luego probar guardado/sync/reversión real antes de activar OAuth o publicar la interfaz de consentimiento. El workflow staging está preparado en `deploy/`, todavía no instalado en el repositorio staging.

## Arquitectura comprobada

Fuente: `2110jrv/TravelManager_3`, rama `codex/v2-remote-022`, código `public/v2`. `main` conserva el app antiguo; su workflow `deploy-pages.yml` publica `public/` al recibir push. No mezclar esta rama en main ni publicar producción durante el viaje.

Staging independiente: `2110jrv/agenda-viajera-v2-staging`, URL https://2110jrv.github.io/agenda-viajera-v2-staging/v2/. El artefacto lo generan `scripts/av2-staging-build.mjs` y `av2-staging-audit.mjs`; la configuración privada llega después de autenticar. `v2/build.json` identifica el commit fuente servido.

Supabase: `cslludzuejkhsydqiabx`. Las tablas V2 son `av2_*`; las tablas históricas `av_*` no alimentan esta interfaz. Pins: `av2_places_of_interest`, UUID estable, `poi_code` inmutable; notas `description`, categoría `label`, coordenadas `lat/lng`. Guías: `av2_records`, kind `app_settings`, tipo `place_guide`, unión `data.place_id`; narración `data.guide.audio_guide`. Geometrías en `guide.geo`; rutas y plantillas en tipos `travel_network` y `travel_journey`.

Google Calendar sigue siendo canónico para eventos y reservas. `av2-google-token` conserva lectura y edición existentes. Esta API solo expone lectura de Calendar; no altera los 43 eventos.

IndexedDB LocalStore: `agenda-viajera-v2`, stores `records/events/outbox/conflicts/meta/blobs`. GPS/Replay: `av2-travel-v1:<trip>:<installation>:<user>`, stores `points/segments/meta/progress/features/gaps/reconstructions/networks`. Los recorridos y Casa capturada son locales; una API del servidor no puede consultarlos desde otro teléfono.

Sync usa SupabaseRemote/SyncEngine y RPC `av2_sync_pull`, `av2_sync_places`, `av2_sync_apply`, `av2_place_apply`, `av2_sync_day_pins`, `av2_day_pin_apply`. No se vacía IndexedDB para resolver conflictos. Usuarios/roles: `av2_app_users`; instalación y sesión: `av2_user_devices`, `av2_install_sessions`, `av2_devices`. ADMIN/TRAVELER editan; VIEWER consulta. Se validan sesión Supabase técnica, dispositivo autorizado, actor y versión del PIN.

La API reutiliza esos RPC y `av2_schedule_access`. Historial adicional append-only: `av2_remote_history`; auditoría existente: `av2_audit_log`. RLS bloquea acceso directo al historial y `av2_remote_grants`. Las concesiones OAuth cifradas están vinculadas a usuario, cliente, viaje, actor y dispositivo, con caducidad máxima de 30 días y revocación. La nueva variable `AV2_REMOTE_ENCRYPTION_KEY` es exclusivamente de servidor; no se publica ninguna clave administrativa.

## Flujo Cloud sin PC encendida

En ChatGPT, crear/publicar un entorno Cloud conectado a este repositorio y preparar el checkout de `codex/v2-remote-022`, Node 22+, `npm ci`, `npm run build:v2`, `npm run test:v2:remote-content`. Después seleccionarlo desde el teléfono. Crear una rama `codex/<tarea>`, implementar, ejecutar CI, abrir PR y revisar el diff. La disponibilidad del entorno y su primer trabajo deben comprobarse en la cuenta; el conector GitHub por sí solo no demuestra acceso a Codex Cloud.

Fuente: https://learn.chatgpt.com/docs/environments/cloud-environments

El workflow `deploy/av2-staging-pages.yml` se instala en `.github/workflows/` del repositorio de staging. Publica un SHA fuente explícito con GitHub Pages Actions, sin PAT permanente. Revisar CI y SHA antes de aprobar staging. Revertir código significa publicar un SHA fuente anterior validado con el mismo workflow; no usar force push ni revertir datos. `dry_run` solo valida un artefacto, no es una reversión pública ejecutada.

## API y operaciones

POST `https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content/api`, con Bearer de sesión Supabase y JSON `{tool,arguments,credentials}`. Las credenciales `p_trip/p_device/p_token` proceden de una instalación autorizada; nunca se piden ni pegan en el chat ni en URLs.

Lecturas: `list_places/get_place/get_audio_guide/get_place_guide/get_place_notes/get_itinerary/get_sync_status/list_zones/list_routes/list_travel_records`. Listas paginadas `limit/after`; GPS local no se presenta como dato remoto disponible.

Escrituras: `create_place/update_audio_guide/update_place_guide/update_place_notes/update_place_metadata/rollback_content`. Exigen UUID exacto, `expected_version`, UUID `request_id` idempotente y patch permitido. Audio cambia solo la narración; investigación preserva narración y geometrías; notas cambian solo description. Las coordenadas públicas requieren confirmación y URL HTTPS. Casa queda excluida. No hay borrado ni escritura Calendar.

Ante conflicto, releer y resolver; no reintentar con versión nueva sin revisar la edición concurrente. `rollback_content` usa history_id y la versión resultante todavía vigente; no pisa cambios posteriores ni revierte creaciones mediante borrado.

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
