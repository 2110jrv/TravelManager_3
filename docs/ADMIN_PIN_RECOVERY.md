# Recuperación local del PIN ADMIN

Desde `C:\Codex\TravelManager_3` ejecuta:

```text
npm run admin:set-pin
```

La herramienta solicita el PIN oculto, lo confirma y usa la Edge Function real para asignarlo y verificar la sesión ADMIN. Nunca compartas el PIN. Esta herramienta es exclusivamente local y no expone `service_role` al navegador.
