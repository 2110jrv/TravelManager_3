# Codex Cloud y activación MCP con el proyecto existente

Preparación TM3-CLOUD-SETUP-043 / TM3-SANDBOX-045. Raíz Cloud:
`/workspace/TravelManager_3`. Referencia revisada:
`codex/tm3-conexion-segura-035`, SHA
`365040710a35dba29d16ca2602074599fd42db94`.

## Estado y alternativa sin proyecto adicional

`cslludzuejkhsydqiabx` es producción. No se han aplicado migraciones,
creado usuarios/PIN, cambiado contraseñas, modificado Google Calendar ni
publicado una función. Las pruebas SQL/MCP usan PGlite desechable y datos
sintéticos. No se necesita una cuenta Supabase para repetirlas.

La alternativa es alojar `av2-remote-content` como Edge Function en ese mismo
proyecto, conservando Auth, los usuarios y la Agenda actuales. Esto comparte
base de datos con producción: no equivale a un sandbox aislado. No activar
hasta cumplir los pasos siguientes. Primero usar consentimiento de solo
lectura y únicamente pins sintéticos aprobados en `av2_remote_public_places`;
los pins existentes permanecen fuera de esa lista. No habilitar escrituras
ni aprobar pins reales durante la aceptación inicial.

## Intervenciones imprescindibles antes de activar

1. El propietario/administrador obtiene un respaldo cifrado y verifica su
   restauración, inventario de migraciones, conteos y hashes de contenido.
   Guardar el respaldo fuera del repositorio. Revisar el impacto sobre el
   esquema real; las pruebas PGlite no sustituyen esta verificación.
2. Aprobar expresamente el SHA y el plan de cambios. Comparar el SQL ya
   aplicado con las migraciones `20261018190000_av2_remote_content.sql`,
   `20261018200000_av2_remote_content_history.sql` y
   `20261018210000_av2_split_pin_notes.sql`. Aplicar solo lo que falte tras
   revisión, en orden, sin `supabase db push` global. Si hay versiones
   anteriores distintas, preparar una migración aditiva separada; no editar
   ni reejecutar a ciegas migraciones aplicadas. Verificar texto original,
   UUID/poi_code, notas y permisos después de cada cambio. Crear fixtures
   sintéticos solo con autorización y aprobarlos individualmente.
3. En el gestor de secretos de **Supabase**, configurar
   `AV2_REMOTE_ENCRYPTION_KEY` (32 bytes aleatorios en base64). La función usa
   además `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` proporcionados por el servidor. No copiarlos
   al navegador, al chat ni al script de instalación Cloud. No rotar los
   secretos existentes. El administrador puede desplegar desde su sesión
   Supabase; Codex no necesita recibir su token para la preparación local.
4. Autorizar el despliegue exclusivo de `av2-remote-content` según
   `supabase/config.toml`. Aunque su gateway usa `verify_jwt=false`, el
   handler exige `auth.getUser()` y verifica concesión/dispositivo para
   operaciones. Comprobar metadata pública, 401 sin Bearer y denegación de
   pins no aprobados antes de conectar un cliente.
5. Si la cuenta ChatGPT permite MCP personalizado, crear la conexión OAuth
   y obtener su callback exacto. Registrar un cliente dedicado en Supabase
   OAuth Server, sin comodines, con Authorization Code y PKCE S256.
   Verificar metadata real y publicar/revisar `v2/oauth.html` en el mismo
   origen que Agenda. Cualquier cambio de Site URL/Authorization Path debe
   preservar el acceso Google existente y requiere revisión previa.
   Client secret, si corresponde, solo en la configuración segura de la app.
6. El propietario inicia sesión en Agenda y concede solo lectura. Desde
   ChatGPT probar `tools/list`, lectura del pin sintético, rechazo del pin
   no aprobado y revocación. La aceptación de escrituras requiere otra
   autorización y pruebas de conflicto/historial/rollback en el pin
   sintético. No ejecutar las suites live existentes, que pueden escribir
   sobre el proyecto real. No cambiar Google Calendar.

Endpoint previsto, aún no validado como desplegado:
`https://cslludzuejkhsydqiabx.supabase.co/functions/v1/av2-remote-content`.
Metadata del recurso: añadir `/.well-known/oauth-protected-resource`.

## Dominios y credenciales

Para desarrollo local basta el preset de gestores de paquetes y GitHub ya
habilitado. El navegador de pruebas bloquea tráfico externo; las rutas de
Supabase/Google son simuladas. No se añadió acceso de producción al entorno.

La conexión real necesita `cslludzuejkhsydqiabx.supabase.co`; el origen web
actual es `2110jrv.github.io`. Despliegue mediante CLI, si se delega después,
puede requerir `api.supabase.com` y autenticación Supabase limitada al proyecto.
Añadir solo destinos observados como necesarios. El callback ChatGPT debe
ser el exacto mostrado por la cuenta, no un dominio supuesto. No hace falta
ningún permiso nuevo de Google Calendar para las herramientas de contenido.

Los secretos de servidor anteriores permanecen en Supabase; no hay secretos
Cloud imprescindibles para las pruebas locales. La sesión OAuth de ChatGPT
se obtiene por consentimiento, nunca pegando tokens en el chat.

## Arranque y pruebas locales

Usar el checkout existente; cada tarea Cloud ya está aislada y no necesita
worktrees. Node 24 y Chromium del sistema están disponibles en esta instancia.
`npm ci --cache /workspace/.npm-cache`, `npm run build:v2`,
`npm run test:v2` y `npm run test:v2:remote-content` preparan y validan V2.
La configuración local ignorada `.playwright/cloud.config.mjs` selecciona
Chromium del sistema y bloquea red externa. Los perfiles sintéticos se
crean bajo `.av2-private`; no copiar allí credenciales ni adjuntos privados.
`npm run start:v2` sirve el desarrollo en loopback, puerto 5004. Validar
internamente GET `/v2/`; no publicar enlaces de preview en onboarding.

Guardar/publicar el entorno Cloud conserva archivos y dependencias, no
procesos ni una conexión MCP activa. Reiniciar servicios en cada tarea.
La publicación Cloud no autoriza despliegues de la aplicación en producción.

## Validación de esta instancia

- `npm ci`: completado sin cambios en declaraciones ni lockfile.
- `npm run build:v2`: aprobado (sintaxis, imports, PWA y bundle).
- `npm run test:v2`: 120 aprobadas, 1 omitida, 0 fallidas.
- `npm run test:v2:remote-content`: 14/14 aprobadas.
- `node --test --test-concurrency=2 tests/av2-*.test.mjs`: 204 aprobadas,
  1 omitida, 0 fallidas; incluye las pruebas de contenido anteriores.
- Suite Chromium inicial: 28 aprobadas, 15 fallidas de 43. Dos casos fallaron
  por ausencia del directorio local de perfiles. Tras crearlo y configurar
  los lanzamientos persistentes con Chromium del sistema, su repetición dio
  1 aprobada (persistencia PIN) y 1 fallida (fixture mapa: esperaba 2 eventos,
  obtuvo 0). Balance por caso tras la corrección: 29 aprobadas, 14 fallidas.
- Fallos restantes: presupuesto/FX y refresco COST; cinco escenarios de mapa
  y documentos bloqueados por el fixture de login/eventos; texto offline
  antiguo; proveedor Google/total; caducidad de transferencia; dos escenarios
  de gaps; shell que requiere snapshot Calendar; actualización de service
  worker. La comparación se basa en los fallos registrados, no demuestra
  que cada discrepancia sea solo un problema de fixture. No se modificó
  código ni tests para ocultarlas. Revisar en una tarea de corrección.
- Navegador sobre servidor normal, puerto 5004: pantalla PIN visible y
  `/v2/local-calendar` devuelve 404. Sin autenticación ni datos reales.
- `npm audit`: 0 vulnerabilidades de dependencias del proyecto.
- CLI Supabase opcional: la versión actual no pudo inicializar su directorio
  de usuario de solo lectura; no se requiere para el flujo local preparado.
  No se afirma validación de despliegue ni conexión OAuth real.

Logs locales ignorados: `.playwright/cloud-node.log`,
`.playwright/cloud-browser.log` y `.playwright/cloud-restart.log`.

## Continuación TM3-CLOUD-CONTINUACION-047

Las cifras anteriores son el baseline de onboarding, no la validación final.
La continuación autoriza corregir código y pruebas en esta rama, sin desplegarlo.

### Causas verificadas de los 14 fallos

| Casos del baseline | Causa y corrección |
| --- | --- |
| Presupuesto/FX | Restaurar el estado de pantalla anulaba la apertura de tasas. Ahora se actualiza el estado del panel antes de capturarlo. Las referencias muestran Caché al quedar offline. |
| Refresco de COST | Faltaba registrar los listeners de `CalendarRefresh`; se conectaron en ambos modos de autenticación. El fixture también necesitaba responder `event_cities`. Las pruebas verifican lectura simulada, no escrituras Calendar. |
| Cinco casos de mapa/documentos | El fixture devolvía una respuesta de token en lugar de `{rows:[]}` para ciudades; el contrato estricto rechazaba importar Calendar. El escenario de edición también carecía de un permiso `av2_schedule_access` explícito. Se completaron ambos fixtures sin omitir controles de acceso. |
| Ubicación denegada, dentro del grupo anterior | El adaptador GPS perdía el código de permiso denegado. Se conserva `code=1`; la prueba verifica liberar la suscripción de ubicación. El mock ahora responde a la API compartida de GPS. |
| Persistencia offline | Expectativa antigua del texto de conexión; se mantiene la comprobación de identidad, datos y funcionamiento offline. |
| Renovación Google | Fixture de ciudades incompleto y textos de conexión anteriores. Conserva las aserciones de renovación, cola y protección de credenciales. |
| Transferencia | Faltaba consultar periódicamente el estado. Ahora se consulta solo con la pantalla de transferencia visible; consumir sigue requiriendo acción explícita. |
| Dos casos de gaps | Expectativas antiguas: los gaps usan la hora final registrada y el texto `libres`. Se verifican 2 h 8 min, 1 h 55 min y 5 min exactos. |
| Shell móvil | Buscaba estadísticas en Inicio tras rediseñarse esa pantalla. Ahora obtiene el saldo de referencia en Presupuesto, conservando recibos, IndexedDB y comprobaciones offline. No requiere copiar un snapshot privado. |
| Actualización de service worker | `skipWaiting()` activaba actualizaciones sin consentimiento. Ahora esperan confirmación; el botón de actualización también quedaba bajo el header y se corrigió su capa. La prueba espera la recarga antes de consultar el nuevo controlador y comprueba que notas e identidad sobreviven y no elimina cachés legacy. |

Al avanzar el escenario de mapa apareció además que el botón global Actualizar
medía 36 px y violaba el mínimo de 44 px ya exigido por la prueba. Se corrigió
su tamaño. Ninguna corrección cambia usuarios, contraseñas ni datos remotos.

### Migraciones: aplicación condicionada, no ejecutada

`scripts/av2-mcp-preflight.sql` es un inventario de solo lectura: columnas,
RLS, grants, huellas de funciones, triggers y huellas/conteos de pins y
registros existentes. No es un respaldo ni demuestra el estado de producción
hasta ejecutarse en una sesión SQL administrativa autorizada.

Las tres migraciones candidatas no son todas idempotentes. La primera crea
tablas, funciones y triggers, y registra indicadores privados en una tabla
nueva; la segunda sustituye funciones de historial/rollback; la tercera añade
`notes` nullable a una tabla existente, crea la allowlist vacía y cambia
funciones de acceso/escritura. Por tanto afectan al esquema y pueden adquirir
locks, aunque no pretendan reescribir contenido existente. No se puede
prometer impacto cero ni determinar cuáles faltan sin inventario real.

Procedimiento después de verificar el respaldo restaurable y recibir permiso:

1. Administrador exporta esquema, datos y roles necesarios con herramientas
   Supabase/PostgreSQL, guarda SHA-256 del respaldo y lo restaura en PostgreSQL
   desechable compatible. Verifica extensiones, Auth, RLS, conteos y contenido;
   el ensayo PGlite de fixtures no es esa restauración. No copiar secretos al repo.
2. Ejecuta el preflight y consulta la tabla `supabase_migrations.schema_migrations`
   si el inventario confirma que existe. Compara también definiciones y columnas:
   la presencia del número de migración no demuestra que su SQL coincida.
3. Aprueba exactamente los SQL faltantes y sus hashes. Si existe una versión
   anterior o parcial, detenerse y preparar una migración correctiva aditiva en
   otra revisión; no borrar tablas ni repetir `CREATE` sobre un esquema existente.
4. En ventana acordada, ejecutar solo los cambios aprobados en una transacción,
   con `lock_timeout` corto y `statement_timeout` acordado. Comprobar dentro de
   la transacción las huellas/conteos originales, `notes IS NULL` en filas
   anteriores y allowlist vacía; ante discrepancia, ROLLBACK. No usar `db push`
   global ni ejecutar scripts de importación o configuración de PIN.
5. Solo después del COMMIT verificado se autoriza por separado la Edge Function.
   No hacer rollback borrando columnas si ya contienen notas nuevas; recuperar
   desde el respaldo verificado o realizar corrección revisada según el incidente.

El test local ensaya las tres migraciones en una transacción sobre el baseline
V2 sintético, compara todas sus tablas preexistentes y comprueba ROLLBACK de
filas y esquema. La autenticación real Supabase y las extensiones del proyecto
requieren verificación posterior sobre el respaldo restaurado.

### Aceptación inicial MCP preparada

`npm run test:v2:remote-content` incluye un escenario del handler MCP conectado
a RPC SQL reales de PGlite, con identidad/concesión OAuth simuladas, un pin
sintético aprobado y otro sin aprobar. Comprueba herramientas solo de lectura,
lectura del pin permitido, exclusión del no aprobado, 403 al escribir y tras
revocar, y ausencia de cambios en las filas e historial. Otro escenario ensaya
rollback de migraciones. Esto no es una conexión real ChatGPT/Supabase.

Para la aceptación remota, el propietario debe autorizar crear un pin sintético
sin información personal y habilitar solo su UUID en `av2_remote_public_places`.
Desde ChatGPT: `tools/list`, `list_places`, `get_place_description` sobre ese UUID,
comprobar que un pin sin aprobar no se expone, revocar el grant desde Agenda y
comprobar que nuevas lecturas fallen. No conceder escritura, no usar pins reales
para el ensayo y no pegar tokens ni identificadores privados en el chat.

### Publicación y acciones de la cuenta

El agente puede guardar automáticamente el borrador de configuración y preparar
archivos, dependencias y commits de la rama de trabajo. Guardar un borrador no
lo aplica ni publica. El usuario revisa/guarda los ajustes y pulsa Publicar en
la interfaz del entorno Cloud; después debe validarse una tarea nueva.
No existe aquí una herramienta autorizada para publicar ese snapshot.

La conexión MCP personalizada, el callback exacto, el consentimiento y cualquier
client secret se gestionan en las interfaces seguras de ChatGPT y Supabase.
La cuenta/administrador debe permitir MCP personalizado. No se solicitarán
secretos por chat. Desplegar código MCP o aplicar SQL en producción sigue
bloqueado hasta el respaldo restaurable verificado y la autorización específica.

### SQL revisados: huellas SHA-256

Las huellas fijan los archivos revisados, no certifican el estado de producción.

- `20261018190000_av2_remote_content.sql`: `d7096a06e5e3e08b7035b322a9ceec2ec8c462880fe8fa923324e1014220c47c`
- `20261018200000_av2_remote_content_history.sql`: `17338cf1139ebea3e80a7afcaa1507a8d2438cad538cb515451ea7c43eac53bf`
- `20261018210000_av2_split_pin_notes.sql`: `c21913c6503c43248b611abbce160c8553655d98e3c45487073ec85e05d1a20b`

### Resultado final de TM3-CLOUD-CONTINUACION-048

- Build V2 aprobado.
- Suite completa de navegador: **43/43 aprobadas**, con Chromium del sistema,
  mocks y tráfico externo bloqueado. El escenario de teclado del mapa también
  pasó tres repeticiones consecutivas: usa la interacción del locator y espera
  el centrado animado, evitando carreras con renderizados de fondo.
- Suite Node/PGlite ampliada: **207 aprobadas, 1 omitida, 0 fallidas**.
  La omitida depende del snapshot privado opcional; no se copió a Cloud.
- Suite MCP: **16/16 aprobadas**, incluidas aceptación inicial de solo lectura
  y ensayo transaccional de migraciones. Auth/OAuth se simulan localmente.
- Arranque normal revalidado: PIN visible y snapshot Calendar devuelve 404.
- `git diff --check` aprobado. Dependencias, lockfile y SQL de migraciones
  existentes permanecen sin cambios.

Evidencia local ignorada: `.playwright/cloud-048-verified-browser.log`,
`.playwright/cloud-048-verified-node.log`, `.playwright/cloud-048-mcp-final.log`
y `.playwright/cloud-048-build.log`. Estas pruebas no publican el entorno,
no prueban restauración en una tarea nueva y no conectan ChatGPT a producción.
