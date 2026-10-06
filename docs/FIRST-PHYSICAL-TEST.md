# Primera prueba física — PC Casa + un Android

## PC Casa
1. Mantén abierto el servidor privado. URL: http://127.0.0.1:5004/v2/
2. En el Chrome de PC Casa ya autorizado, entra con **2110jrv@gmail.com** mediante **Más → Conectar Google**. Espera el regreso a Agenda Viajera.
3. **Más → Dispositivos → Seguridad → Crear clave administrativa**. Jonathan elige la clave; no compartirla en el chat. PC Casa debe aparecer protegida como ROOT.
4. Revisa Italia 2026, Inicio PRE-VIAJE, itinerario/Labels, presupuesto USD y monedas originales, gastos y Documentos. Configurar presupuesto es opcional para esta prueba.

## Primer Android (solo uno)
1. Conecta por USB a PC Casa, activa Depuración USB y acepta la autorización del equipo. En Chrome de PC abre **chrome://inspect/#devices**, activa **Discover USB devices**, abre **Port forwarding**, configura puerto **5004** → **localhost:5004** y activa el reenvío. Mantén el cable y el servidor conectados durante login/sync. Alternativa si ADB ya está disponible: `adb reverse tcp:5004 tcp:5004`.
2. PC: **Más → Dispositivos → Agregar dispositivo**. Escanea el QR/enlace temporal con Chrome Android. URL base exacta: **http://127.0.0.1:5004/v2/**. El enlace añade una invitación privada de un solo uso; no compartirla. No sirve abrir una IP LAN HTTP para instalar esta PWA.
3. Android: **Conectar Google**, completar acceso, volver a la PWA y pulsar **Registrar este teléfono** en Dispositivos. Debe quedar DEVICE, nunca ROOT. PC confirma su aparición; nombrarlo «Android 1».
4. En Chrome Android, menú **⋮ → Instalar aplicación / Añadir a pantalla de inicio**; abrir la instalada. No cambiar entre localhost y 127.0.0.1: cada origen tiene almacenamiento independiente.
5. **Más → Sincronizar ahora**. En Documentos, **Actualizar Drive**, seleccionar y descargar los archivos reales que quieras offline; luego **Más → Preparar offline → Verificar y descargar**. Si Drive está vacío, comprobar el estado vacío: todavía no hay archivos que descargar.
6. Activa modo avión: abre itinerario, presupuesto, gastos y los documentos descargados; crea un gasto de prueba reconocible. Cierra/reabre la PWA; debe conservarlo y mostrar cambios pendientes. Desactiva modo avión, reconecta USB si hace falta y sincroniza: comprobar el mismo gasto en PC, una sola vez, conservando moneda y vínculos. Después elimina el gasto de prueba.
7. Ver dispositivos no pide clave. Una administración sensible desde Android sí la pide. PC Casa no debe ofrecerse para revocación. No añadir los otros tres teléfonos hasta aprobar este.

Reenvío USB privado: [documentación Chrome](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) y [Android](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server).
